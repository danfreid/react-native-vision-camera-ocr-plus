import Foundation
import UIKit
import React
import Vision

@objc(DocumentRecognizerModule)
class DocumentRecognizerModule: NSObject {
    
    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    @objc(processDualImages:rightUri:withResolver:withRejecter:)
    func processDualImages(_ leftUri: String, rightUri: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let leftImage = UIImage(contentsOfFile: leftUri),
              let rightImage = UIImage(contentsOfFile: rightUri),
              let leftCGImage = leftImage.cgImage,
              let rightCGImage = rightImage.cgImage else {
            reject("Error", "Can't load images", nil)
            return
        }
        
        let group = DispatchGroup()
        var leftRows: [[String]] = []
        var rightRows: [[String]] = []
        var error: Error?
        
        group.enter()
        extractTableRows(cgImage: leftCGImage, imageSize: leftImage.size) { rows, err in
            leftRows = rows
            error = err
            group.leave()
        }
        
        group.enter()
        extractTableRows(cgImage: rightCGImage, imageSize: rightImage.size) { rows, err in
            rightRows = rows
            if error == nil { error = err }
            group.leave()
        }
        
        group.notify(queue: .main) {
            if let error = error {
                reject("Error", error.localizedDescription, error)
                return
            }
            
            let csv = self.combineToCSV(leftRows: leftRows, rightRows: rightRows)
            resolve(["csv": csv])
        }
    }
    
    @objc(process:searchTerms:withResolver:withRejecter:)
    func process(_ uri: String, searchTerms: [String], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let image = UIImage(contentsOfFile: uri) else {
            reject("Error", "Can't find photo at path: \(uri)", nil)
            return
        }
        
        guard let cgImage = image.cgImage else {
            reject("Error", "Can't convert image to CGImage", nil)
            return
        }
        
        let imageSize = image.size
        processWithTextRecognition(cgImage: cgImage, imageSize: imageSize, searchTerms: searchTerms, resolve: resolve, reject: reject)
    }
    
    private func processWithTextRecognition(cgImage: CGImage, imageSize: CGSize, searchTerms: [String], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let request = VNRecognizeTextRequest { [weak self] request, error in
            guard let self = self else { return }
            
            if let error = error {
                reject("Error", "Text recognition failed: \(error.localizedDescription)", error)
                return
            }
            
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                resolve(["tables": [], "rawText": "", "matchedCells": [], "cellConfidences": [], "paragraphs": [], "detectedData": []])
                return
            }
            
            var allText = ""
            var textItems: [(text: String, bounds: CGRect, confidence: Float)] = []
            
            for observation in observations {
                guard let topCandidate = observation.topCandidates(1).first else { continue }
                let text = topCandidate.string
                allText += text + " "
                
                let bounds = CGRect(
                    x: observation.boundingBox.origin.x * imageSize.width,
                    y: (1 - observation.boundingBox.origin.y - observation.boundingBox.height) * imageSize.height,
                    width: observation.boundingBox.width * imageSize.width,
                    height: observation.boundingBox.height * imageSize.height
                )
                textItems.append((text: text, bounds: bounds, confidence: topCandidate.confidence))
            }
            
            let tableResult = self.inferTableStructure(textItems: textItems, rawText: allText)
            let matchedCells = self.searchInTables(searchTerms: searchTerms, tables: tableResult["tables"] as? [[String: Any]] ?? [])
            
            var result = tableResult
            result["matchedCells"] = matchedCells
            result["paragraphs"] = []
            result["detectedData"] = []
            
            resolve(result)
        }
        
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
            } catch {
                reject("Error", "Failed to perform text recognition: \(error.localizedDescription)", error)
            }
        }
    }
    
    private func extractTableRows(cgImage: CGImage, imageSize: CGSize, completion: @escaping ([[String]], Error?) -> Void) {
        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                completion([], error)
                return
            }
            
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                completion([], nil)
                return
            }
            
            var textItems: [(text: String, bounds: CGRect)] = []
            for observation in observations {
                guard let text = observation.topCandidates(1).first?.string else { continue }
                let bounds = CGRect(
                    x: observation.boundingBox.origin.x * imageSize.width,
                    y: (1 - observation.boundingBox.origin.y - observation.boundingBox.height) * imageSize.height,
                    width: observation.boundingBox.width * imageSize.width,
                    height: observation.boundingBox.height * imageSize.height
                )
                textItems.append((text: text, bounds: bounds))
            }
            
            let rows = self.groupIntoRows(textItems: textItems)
            completion(rows, nil)
        }
        
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            try? handler.perform([request])
        }
    }
    
    private func groupIntoRows(textItems: [(text: String, bounds: CGRect)]) -> [[String]] {
        guard !textItems.isEmpty else { return [] }
        
        let avgHeight = textItems.map { $0.bounds.height }.reduce(0, +) / CGFloat(textItems.count)
        let rowThreshold = max(avgHeight * 0.6, 10)
        
        var sorted = textItems.sorted { a, b in
            let yDiff = abs(a.bounds.midY - b.bounds.midY)
            if yDiff < rowThreshold { return a.bounds.minX < b.bounds.minX }
            return a.bounds.minY < b.bounds.minY
        }
        
        var rows: [[(text: String, bounds: CGRect)]] = []
        var currentRow: [(text: String, bounds: CGRect)] = []
        var lastY: CGFloat = -1000
        
        for item in sorted {
            if abs(item.bounds.midY - lastY) > rowThreshold {
                if !currentRow.isEmpty {
                    rows.append(currentRow.sorted { $0.bounds.minX < $1.bounds.minX })
                }
                currentRow = [item]
            } else {
                currentRow.append(item)
            }
            lastY = item.bounds.midY
        }
        if !currentRow.isEmpty {
            rows.append(currentRow.sorted { $0.bounds.minX < $1.bounds.minX })
        }
        
        rows = mergeHeaders(rows: rows)
        return alignColumns(rows: rows)
    }
    
    private func mergeHeaders(rows: [[(text: String, bounds: CGRect)]]) -> [[(text: String, bounds: CGRect)]] {
        guard rows.count > 2 else { return rows }
        
        let avgRowSize = Double(rows.map { $0.count }.reduce(0, +)) / Double(rows.count)
        var headerEndIdx = 0
        
        for (idx, row) in rows.prefix(8).enumerated() {
            if Double(row.count) > avgRowSize * 1.1 {
                headerEndIdx = idx
            } else {
                break
            }
        }
        
        if headerEndIdx == 0 { return rows }
        
        let headerRows = Array(rows[0...headerEndIdx])
        let dataRows = Array(rows[(headerEndIdx + 1)...])
        
        var allX: [CGFloat] = []
        for row in dataRows.prefix(5) {
            for item in row {
                allX.append(item.bounds.minX)
            }
        }
        allX.sort()
        
        var colBoundaries: [CGFloat] = []
        var lastX: CGFloat = -1000
        let xThreshold: CGFloat = 15
        
        for x in allX {
            if abs(x - lastX) > xThreshold {
                colBoundaries.append(x)
                lastX = x
            }
        }
        
        var mergedHeader: [(text: String, bounds: CGRect)] = []
        for colX in colBoundaries {
            var cells: [(text: String, bounds: CGRect)] = []
            for headerRow in headerRows {
                for item in headerRow {
                    if abs(item.bounds.minX - colX) < xThreshold * 1.5 {
                        cells.append(item)
                    }
                }
            }
            if !cells.isEmpty {
                let text = cells.map { $0.text }.joined(separator: " ")
                let bounds = cells.reduce(cells[0].bounds) { $0.union($1.bounds) }
                mergedHeader.append((text: text, bounds: bounds))
            }
        }
        
        return [mergedHeader] + dataRows
    }
            if abs(x - lastX) > xThreshold {
                colBoundaries.append(x)
                lastX = x
            }
        }
        
        var mergedHeader: [(text: String, bounds: CGRect)] = []
        for colX in colBoundaries {
            var cells: [(text: String, bounds: CGRect)] = []
            for headerRow in headerRows {
                for item in headerRow {
                    if abs(item.bounds.minX - colX) < xThreshold {
                        cells.append(item)
                    }
                }
            }
            if !cells.isEmpty {
                let text = cells.map { $0.text }.joined(separator: " ")
                let bounds = cells.reduce(cells[0].bounds) { $0.union($1.bounds) }
                mergedHeader.append((text: text, bounds: bounds))
            }
        }
        
        return [mergedHeader] + dataRows
    }
    
    private func alignColumns(rows: [[(text: String, bounds: CGRect)]]) -> [[String]] {
        guard !rows.isEmpty else { return [] }
        
        var allX: [CGFloat] = []
        for row in rows.dropFirst() {
            for item in row {
                allX.append(item.bounds.minX)
            }
        }
        allX.sort()
        
        var colBoundaries: [CGFloat] = []
        var lastX: CGFloat = -1000
        let xThreshold: CGFloat = 15
        
        for x in allX {
            if abs(x - lastX) > xThreshold {
                colBoundaries.append(x)
                lastX = x
            }
        }
        
        var result: [[String]] = []
        for row in rows {
            var alignedRow: [String] = []
            for colX in colBoundaries {
                var found = ""
                for item in row {
                    if abs(item.bounds.minX - colX) < xThreshold * 1.5 {
                        found = item.text
                        break
                    }
                }
                alignedRow.append(found)
            }
            result.append(alignedRow)
        }
        
        return result
    }
    
    private func combineToCSV(leftRows: [[String]], rightRows: [[String]]) -> String {
        var csv = ""
        let maxRows = max(leftRows.count, rightRows.count)
        
        for i in 0..<maxRows {
            let leftCols = i < leftRows.count ? leftRows[i] : []
            let rightCols = i < rightRows.count ? rightRows[i] : []
            let combined = leftCols + rightCols
            let line = combined.map { "\"\($0)\"" }.joined(separator: ",")
            csv += line + "\n"
        }
        
        return csv
    }
    
    private func inferTableStructure(textItems: [(text: String, bounds: CGRect, confidence: Float)], rawText: String) -> [String: Any] {
        guard !textItems.isEmpty else {
            return ["tables": [], "rawText": "", "cellConfidences": []]
        }
        
        let avgHeight = textItems.map { $0.bounds.height }.reduce(0, +) / CGFloat(textItems.count)
        let rowThreshold = max(avgHeight * 0.6, 10)
        
        var sortedItems = textItems
        sortedItems.sort { a, b in
            let yDiff = abs(a.bounds.midY - b.bounds.midY)
            if yDiff < rowThreshold { return a.bounds.minX < b.bounds.minX }
            return a.bounds.minY < b.bounds.minY
        }
        
        var rows: [[(text: String, bounds: CGRect, confidence: Float)]] = []
        var currentRow: [(text: String, bounds: CGRect, confidence: Float)] = []
        var lastY: CGFloat = -1000
        
        for item in sortedItems {
            if abs(item.bounds.midY - lastY) > rowThreshold {
                if !currentRow.isEmpty {
                    rows.append(currentRow.sorted { $0.bounds.minX < $1.bounds.minX })
                }
                currentRow = [item]
            } else {
                currentRow.append(item)
            }
            lastY = item.bounds.midY
        }
        if !currentRow.isEmpty {
            rows.append(currentRow.sorted { $0.bounds.minX < $1.bounds.minX })
        }
        
        guard rows.count > 1 else {
            return ["tables": [], "rawText": rawText.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines), "cellConfidences": []]
        }
        
        rows = mergeHeadersAndAlignColumns(rows: rows, rowThreshold: rowThreshold)
        
        let maxColumns = rows.map { $0.count }.max() ?? 0
        
        guard maxColumns > 1 else {
            return ["tables": [], "rawText": rawText.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines), "cellConfidences": []]
        }
        
        var cells: [[String: Any]] = []
        var cellConfidences: [[String: Any]] = []
        var columnBounds: [Int: CGRect] = [:]
        var tableBounds: CGRect = CGRect.zero
        
        for (rowIdx, row) in rows.enumerated() {
            for (colIdx, item) in row.enumerated() {
                cells.append([
                    "text": item.text,
                    "boundingBox": [
                        "xMin": item.bounds.origin.x,
                        "yMin": item.bounds.origin.y,
                        "xMax": item.bounds.maxX,
                        "yMax": item.bounds.maxY
                    ],
                    "rowIndex": rowIdx,
                    "columnIndex": colIdx,
                    "confidence": item.confidence
                ])
                
                cellConfidences.append([
                    "rowIndex": rowIdx,
                    "columnIndex": colIdx,
                    "text": item.text,
                    "confidence": item.confidence
                ])
                
                if columnBounds[colIdx] == nil {
                    columnBounds[colIdx] = item.bounds
                } else {
                    columnBounds[colIdx] = columnBounds[colIdx]!.union(item.bounds)
                }
                
                if tableBounds == CGRect.zero {
                    tableBounds = item.bounds
                } else {
                    tableBounds = tableBounds.union(item.bounds)
                }
            }
        }
        
        var columnsArray: [[String: Any]] = []
        for colIdx in columnBounds.keys.sorted() {
            let bounds = columnBounds[colIdx]!
            let colCells = cells.filter { ($0["columnIndex"] as? Int) == colIdx }
            columnsArray.append([
                "boundingBox": [
                    "xMin": bounds.origin.x,
                    "yMin": bounds.origin.y,
                    "xMax": bounds.maxX,
                    "yMax": bounds.maxY
                ],
                "columnIndex": colIdx,
                "cells": colCells
            ])
        }
        
        return [
            "tables": [[
                "boundingBox": [
                    "xMin": tableBounds.origin.x,
                    "yMin": tableBounds.origin.y,
                    "xMax": tableBounds.maxX,
                    "yMax": tableBounds.maxY
                ],
                "columns": columnsArray,
                "rowCount": rows.count,
                "columnCount": maxColumns
            ]],
            "rawText": rawText.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines),
            "cellConfidences": cellConfidences
        ]
    }
    
    private func searchInTables(searchTerms: [String], tables: [[String: Any]]) -> [[String: Any]] {
        var matchedCells: [[String: Any]] = []
        
        for (tableIdx, table) in tables.enumerated() {
            guard let columns = table["columns"] as? [[String: Any]] else { continue }
            
            for column in columns {
                guard let cells = column["cells"] as? [[String: Any]] else { continue }
                
                for cell in cells {
                    guard let cellText = cell["text"] as? String else { continue }
                    let cellTextUpper = cellText.uppercased()
                    
                    for searchTerm in searchTerms {
                        if cellTextUpper.contains(searchTerm.uppercased()) {
                            var matchedCell = cell
                            matchedCell["searchTerm"] = searchTerm
                            matchedCell["tableIndex"] = tableIdx
                            matchedCell["textBoundingBox"] = cell["boundingBox"]
                            matchedCell["expandedBoundingBox"] = cell["boundingBox"]
                            matchedCells.append(matchedCell)
                        }
                    }
                }
            }
        }
        
        return matchedCells
    }
    
    private func mergeHeadersAndAlignColumns(rows: [[(text: String, bounds: CGRect, confidence: Float)]], rowThreshold: CGFloat) -> [[(text: String, bounds: CGRect, confidence: Float)]] {
        guard rows.count > 2 else { return rows }
        
        var headerEndIdx = 0
        let avgRowSize = Double(rows.map { $0.count }.reduce(0, +)) / Double(rows.count)
        
        for (idx, row) in rows.prefix(5).enumerated() {
            if Double(row.count) > avgRowSize * 1.2 {
                headerEndIdx = idx
            } else {
                break
            }
        }
        
        if headerEndIdx == 0 { return rows }
        
        let headerRows = Array(rows[0...headerEndIdx])
        let dataRows = Array(rows[(headerEndIdx + 1)...])
        
        var allXPositions: [CGFloat] = []
        for row in rows {
            for item in row {
                allXPositions.append(item.bounds.minX)
            }
        }
        allXPositions.sort()
        
        var columnBoundaries: [CGFloat] = []
        var lastX: CGFloat = -1000
        let xThreshold: CGFloat = 20
        
        for x in allXPositions {
            if abs(x - lastX) > xThreshold {
                columnBoundaries.append(x)
                lastX = x
            }
        }
        
        var mergedHeader: [(text: String, bounds: CGRect, confidence: Float)] = []
        for colBoundary in columnBoundaries {
            var cellsInColumn: [(text: String, bounds: CGRect, confidence: Float)] = []
            
            for headerRow in headerRows {
                for item in headerRow {
                    if abs(item.bounds.minX - colBoundary) < xThreshold {
                        cellsInColumn.append(item)
                    }
                }
            }
            
            if !cellsInColumn.isEmpty {
                let mergedText = cellsInColumn.map { $0.text }.joined(separator: " ")
                let mergedBounds = cellsInColumn.reduce(cellsInColumn[0].bounds) { $0.union($1.bounds) }
                let avgConfidence = cellsInColumn.map { $0.confidence }.reduce(0, +) / Float(cellsInColumn.count)
                mergedHeader.append((text: mergedText, bounds: mergedBounds, confidence: avgConfidence))
            }
        }
        
        var alignedDataRows: [[(text: String, bounds: CGRect, confidence: Float)]] = []
        for dataRow in dataRows {
            var alignedRow: [(text: String, bounds: CGRect, confidence: Float)] = []
            
            for colBoundary in columnBoundaries {
                var found = false
                for item in dataRow {
                    if abs(item.bounds.minX - colBoundary) < xThreshold * 2 {
                        alignedRow.append(item)
                        found = true
                        break
                    }
                }
                if !found {
                    let emptyBounds = CGRect(x: colBoundary, y: dataRow.first?.bounds.minY ?? 0, width: 10, height: dataRow.first?.bounds.height ?? 10)
                    alignedRow.append((text: "", bounds: emptyBounds, confidence: 0.0))
                }
            }
            
            alignedDataRows.append(alignedRow)
        }
        
        return [mergedHeader] + alignedDataRows
    }
}s(searchTerm.uppercased()) {
                            var matchedCell = cell
                            matchedCell["searchTerm"] = searchTerm
                            matchedCell["tableIndex"] = tableIdx
                            matchedCell["textBoundingBox"] = cell["boundingBox"]
                            matchedCell["expandedBoundingBox"] = cell["boundingBox"]
                            matchedCells.append(matchedCell)
                        }
                    }
                }
            }
        }
        
        return matchedCells
    }
    
    private func mergeHeadersAndAlignColumns(rows: [[(text: String, bounds: CGRect, confidence: Float)]], rowThreshold: CGFloat) -> [[(text: String, bounds: CGRect, confidence: Float)]] {
        guard rows.count > 2 else { return rows }
        
        var headerEndIdx = 0
        let avgRowSize = Double(rows.map { $0.count }.reduce(0, +)) / Double(rows.count)
        
        for (idx, row) in rows.prefix(5).enumerated() {
            if Double(row.count) > avgRowSize * 1.2 {
                headerEndIdx = idx
            } else {
                break
            }
        }
        
        if headerEndIdx == 0 { return rows }
        
        let headerRows = Array(rows[0...headerEndIdx])
        let dataRows = Array(rows[(headerEndIdx + 1)...])
        
        var allXPositions: [CGFloat] = []
        for row in rows {
            for item in row {
                allXPositions.append(item.bounds.minX)
            }
        }
        allXPositions.sort()
        
        var columnBoundaries: [CGFloat] = []
        var lastX: CGFloat = -1000
        let xThreshold: CGFloat = 20
        
        for x in allXPositions {
            if abs(x - lastX) > xThreshold {
                columnBoundaries.append(x)
                lastX = x
            }
        }
        
        var mergedHeader: [(text: String, bounds: CGRect, confidence: Float)] = []
        for colBoundary in columnBoundaries {
            var cellsInColumn: [(text: String, bounds: CGRect, confidence: Float)] = []
            
            for headerRow in headerRows {
                for item in headerRow {
                    if abs(item.bounds.minX - colBoundary) < xThreshold {
                        cellsInColumn.append(item)
                    }
                }
            }
            
            if !cellsInColumn.isEmpty {
                let mergedText = cellsInColumn.map { $0.text }.joined(separator: " ")
                let mergedBounds = cellsInColumn.reduce(cellsInColumn[0].bounds) { $0.union($1.bounds) }
                let avgConfidence = cellsInColumn.map { $0.confidence }.reduce(0, +) / Float(cellsInColumn.count)
                mergedHeader.append((text: mergedText, bounds: mergedBounds, confidence: avgConfidence))
            }
        }
        
        var alignedDataRows: [[(text: String, bounds: CGRect, confidence: Float)]] = []
        for dataRow in dataRows {
            var alignedRow: [(text: String, bounds: CGRect, confidence: Float)] = []
            
            for colBoundary in columnBoundaries {
                var found = false
                for item in dataRow {
                    if abs(item.bounds.minX - colBoundary) < xThreshold * 2 {
                        alignedRow.append(item)
                        found = true
                        break
                    }
                }
                if !found {
                    let emptyBounds = CGRect(x: colBoundary, y: dataRow.first?.bounds.minY ?? 0, width: 10, height: dataRow.first?.bounds.height ?? 10)
                    alignedRow.append((text: "", bounds: emptyBounds, confidence: 0.0))
                }
            }
            
            alignedDataRows.append(alignedRow)
        }
        
        return [mergedHeader] + alignedDataRows
    }
}
