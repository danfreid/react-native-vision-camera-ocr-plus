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
        var leftResult: (rows: [[String]], rawData: [[(text: String, bounds: CGRect, confidence: Float)]]) = ([], [])
        var rightResult: (rows: [[String]], rawData: [[(text: String, bounds: CGRect, confidence: Float)]]) = ([], [])
        var leftRectangles: [[String: Any]] = []
        var rightRectangles: [[String: Any]] = []
        var error: Error?
        
        group.enter()
        extractTableRowsWithData(cgImage: leftCGImage, imageSize: leftImage.size, isLeftPage: true) { rows, rawData, err in
            leftResult = (rows, rawData)
            error = err
            group.leave()
        }
        
        group.enter()
        extractTableRowsWithData(cgImage: rightCGImage, imageSize: rightImage.size, isLeftPage: false) { rows, rawData, err in
            rightResult = (rows, rawData)
            if error == nil { error = err }
            group.leave()
        }
        
        group.enter()
        detectRectangles(cgImage: leftCGImage, imageSize: leftImage.size) { rects in
            leftRectangles = rects
            group.leave()
        }
        
        group.enter()
        detectRectangles(cgImage: rightCGImage, imageSize: rightImage.size) { rects in
            rightRectangles = rects
            group.leave()
        }
        
        group.notify(queue: .main) {
            if let error = error {
                reject("Error", error.localizedDescription, error)
                return
            }
            
            let csv = self.combineToCSV(leftRows: leftResult.rows, rightRows: rightResult.rows)
            let dateColumn = self.extractDateColumn(rawData: leftResult.rawData)
            
            // Build comprehensive cell data with bounding boxes
            let leftCellData = self.buildCellData(rawData: leftResult.rawData, side: "left")
            let rightCellData = self.buildCellData(rawData: rightResult.rawData, side: "right")
            
            // Build detailed table structure
            let leftTableStructure = self.buildTableStructure(rows: leftResult.rows, rawData: leftResult.rawData)
            let rightTableStructure = self.buildTableStructure(rows: rightResult.rows, rawData: rightResult.rawData)
            
            // Build metadata
            let leftRowCount = leftResult.rows.count
            let leftColCount = leftResult.rows.first?.count ?? 0
            let rightRowCount = rightResult.rows.count
            let rightColCount = rightResult.rows.first?.count ?? 0
            let totalCells = leftCellData.count + rightCellData.count
            let processingDate = ISO8601DateFormatter().string(from: Date())
            
            // Build result dictionary
            let resultDict: [String: Any] = [
                "csv": csv,
                "dateColumn": dateColumn,
                "rectangles": [
                    "left": leftRectangles,
                    "right": rightRectangles
                ],
                "leftTable": leftTableStructure,
                "rightTable": rightTableStructure,
                "cellData": [
                    "left": leftCellData,
                    "right": rightCellData
                ],
                "metadata": [
                    "leftRows": leftRowCount,
                    "leftColumns": leftColCount,
                    "rightRows": rightRowCount,
                    "rightColumns": rightColCount,
                    "totalCells": totalCells,
                    "processingDate": processingDate
                ]
            ]
            
            resolve(resultDict)
        }
    }
    
    private func buildCellData(rawData: [[(text: String, bounds: CGRect, confidence: Float)]], side: String) -> [[String: Any]] {
        var cellData: [[String: Any]] = []
        
        for (rowIdx, row) in rawData.enumerated() {
            for (colIdx, cell) in row.enumerated() {
                cellData.append([
                    "side": side,
                    "row": rowIdx,
                    "column": colIdx,
                    "value": cell.text,
                    "confidence": cell.confidence,
                    "boundingBox": [
                        "x": cell.bounds.origin.x,
                        "y": cell.bounds.origin.y,
                        "width": cell.bounds.width,
                        "height": cell.bounds.height,
                        "left": cell.bounds.minX,
                        "top": cell.bounds.minY,
                        "right": cell.bounds.maxX,
                        "bottom": cell.bounds.maxY
                    ]
                ])
            }
        }
        
        return cellData
    }
    
    private func buildTableStructure(rows: [[String]], rawData: [[(text: String, bounds: CGRect, confidence: Float)]]) -> [String: Any] {
        let rowCount = rows.count
        let columnCount = rows.first?.count ?? 0
        
        var columns: [[String: Any]] = []
        for colIdx in 0..<columnCount {
            var columnCells: [[String: Any]] = []
            var columnBounds: CGRect?
            
            for (rowIdx, row) in rows.enumerated() {
                if colIdx < row.count {
                    let value = row[colIdx]
                    
                    // Find corresponding cell in rawData
                    if rowIdx < rawData.count && colIdx < rawData[rowIdx].count {
                        let cellData = rawData[rowIdx][colIdx]
                        
                        columnCells.append([
                            "row": rowIdx,
                            "column": colIdx,
                            "value": value,
                            "confidence": cellData.confidence,
                            "boundingBox": [
                                "x": cellData.bounds.origin.x,
                                "y": cellData.bounds.origin.y,
                                "width": cellData.bounds.width,
                                "height": cellData.bounds.height
                            ]
                        ])
                        
                        if columnBounds == nil {
                            columnBounds = cellData.bounds
                        } else {
                            columnBounds = columnBounds!.union(cellData.bounds)
                        }
                    }
                }
            }
            
            if let bounds = columnBounds {
                columns.append([
                    "columnIndex": colIdx,
                    "cells": columnCells,
                    "boundingBox": [
                        "x": bounds.origin.x,
                        "y": bounds.origin.y,
                        "width": bounds.width,
                        "height": bounds.height
                    ]
                ])
            }
        }
        
        return [
            "rowCount": rowCount,
            "columnCount": columnCount,
            "columns": columns
        ]
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
    
    private func extractTableRows(cgImage: CGImage, imageSize: CGSize, isLeftPage: Bool, completion: @escaping ([[String]], Error?) -> Void) {
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
            
            let rows = self.groupIntoRows(textItems: textItems, isLeftPage: isLeftPage)
            completion(rows, nil)
        }
        
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            try? handler.perform([request])
        }
    }
    
    private func extractTableRowsWithData(cgImage: CGImage, imageSize: CGSize, isLeftPage: Bool, completion: @escaping ([[String]], [[(text: String, bounds: CGRect, confidence: Float)]], Error?) -> Void) {
        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                completion([], [], error)
                return
            }
            
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                completion([], [], nil)
                return
            }
            
            var textItems: [(text: String, bounds: CGRect, confidence: Float)] = []
            for observation in observations {
                guard let topCandidate = observation.topCandidates(1).first else { continue }
                let bounds = CGRect(
                    x: observation.boundingBox.origin.x * imageSize.width,
                    y: (1 - observation.boundingBox.origin.y - observation.boundingBox.height) * imageSize.height,
                    width: observation.boundingBox.width * imageSize.width,
                    height: observation.boundingBox.height * imageSize.height
                )
                textItems.append((text: topCandidate.string, bounds: bounds, confidence: topCandidate.confidence))
            }
            
            let (rows, rawData) = self.groupIntoRowsWithData(textItems: textItems, isLeftPage: isLeftPage)
            completion(rows, rawData, nil)
        }
        
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            try? handler.perform([request])
        }
    }
    
    private func groupIntoRows(textItems: [(text: String, bounds: CGRect)], isLeftPage: Bool) -> [[String]] {
        guard !textItems.isEmpty else { return [] }
        
        let avgHeight = textItems.map { $0.bounds.height }.reduce(0, +) / CGFloat(textItems.count)
        let rowThreshold = max(avgHeight * 0.6, 10)
        
        let sorted = textItems.sorted { a, b in
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
        
        rows = mergeHeaders(rows: rows, isLeftPage: isLeftPage)
        return alignColumns(rows: rows)
    }
    
    private func groupIntoRowsWithData(textItems: [(text: String, bounds: CGRect, confidence: Float)], isLeftPage: Bool) -> ([[String]], [[(text: String, bounds: CGRect, confidence: Float)]]) {
        guard !textItems.isEmpty else { return ([], []) }
        
        let avgHeight = textItems.map { $0.bounds.height }.reduce(0, +) / CGFloat(textItems.count)
        let rowThreshold = max(avgHeight * 0.6, 10)
        
        let sorted = textItems.sorted { a, b in
            let yDiff = abs(a.bounds.midY - b.bounds.midY)
            if yDiff < rowThreshold { return a.bounds.minX < b.bounds.minX }
            return a.bounds.minY < b.bounds.minY
        }
        
        var rows: [[(text: String, bounds: CGRect, confidence: Float)]] = []
        var currentRow: [(text: String, bounds: CGRect, confidence: Float)] = []
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
        
        rows = mergeHeadersWithData(rows: rows, isLeftPage: isLeftPage)
        let stringRows = alignColumns(rows: rows.map { $0.map { (text: $0.text, bounds: $0.bounds) } })
        return (stringRows, rows)
    }
    
    private func mergeHeaders(rows: [[(text: String, bounds: CGRect)]], isLeftPage: Bool) -> [[(text: String, bounds: CGRect)]] {
        guard rows.count > 2 else { return rows }
        
        let leftHeaders = [
            "DATE", "AIRCRAFT MAKE AND MODEL", "AIRCRAFT IDENT", "FROM", "TO",
            "TOTAL DURATION OF FLIGHT", "AIRPLANE SINGLE- ENGINE LAND", "AIRPLANE SINGLE- ENGINE SEA",
            "AIRPLANE MULTI- ENGINE LAND", "NEBASET", "ROTORCRAFT HELICOPTER",
            "GLIDER", "TURBOPROP", "D A Y", "N I G H T"
        ]
        
        let rightHeaders = [
            "NIGHT", "ACTUAL INSTRUMENT", "SIMULATED INSTRUMENT (HOOD)",
            "APP NO. TYPE", "FLIGHT SIMULATOR", "CROSS COUNTRY", "SOLO",
            "PILOT IN COMMAND", "SECOND IN COMMAND", "DUAL RECEIVED",
            "AS FLIGHT INSTRUCTOR", "REMARKS AND ENDORSEMENTS"
        ]
        
        // Use headers based on which page we're processing
        let headers = isLeftPage ? leftHeaders : rightHeaders
        
        // Skip the first 8 rows (original header rows) and use data rows
        let dataRows = Array(rows.dropFirst(8))
        guard !dataRows.isEmpty else { return rows }
        
        // Detect column positions from data rows
        var colPositions: [CGFloat] = []
        for row in dataRows.prefix(5) {
            for item in row {
                let x = item.bounds.minX
                if !colPositions.contains(where: { abs($0 - x) < 30 }) {
                    colPositions.append(x)
                }
            }
        }
        colPositions.sort()
        
        // Create header row with exact number of columns matching our header array
        var mergedHeader: [(text: String, bounds: CGRect)] = []
        let headerY = rows[0][0].bounds.minY
        let numColumns = headers.count
        
        // If we have more detected columns than headers, merge nearby columns
        if colPositions.count > numColumns {
            // Group column positions into the expected number of columns
            let avgSpacing = (colPositions.last! - colPositions.first!) / CGFloat(numColumns - 1)
            var adjustedPositions: [CGFloat] = []
            
            for i in 0..<numColumns {
                let targetX = colPositions.first! + (CGFloat(i) * avgSpacing)
                // Find closest actual column position
                let closest = colPositions.min(by: { abs($0 - targetX) < abs($1 - targetX) }) ?? targetX
                adjustedPositions.append(closest)
            }
            colPositions = adjustedPositions
        }
        
        // Create header with our predefined headers
        for (idx, headerText) in headers.enumerated() {
            let colX = idx < colPositions.count ? colPositions[idx] : (colPositions.last ?? 0) + CGFloat(idx * 50)
            let bounds = CGRect(x: colX, y: headerY, width: 50, height: 20)
            mergedHeader.append((text: headerText, bounds: bounds))
        }
        
        return [mergedHeader] + dataRows
    }
    
    private func mergeHeadersWithData(rows: [[(text: String, bounds: CGRect, confidence: Float)]], isLeftPage: Bool) -> [[(text: String, bounds: CGRect, confidence: Float)]] {
        guard rows.count > 2 else { return rows }
        
        let leftHeaders = [
            "DATE", "AIRCRAFT MAKE AND MODEL", "AIRCRAFT IDENT", "FROM", "TO",
            "TOTAL DURATION OF FLIGHT", "AIRPLANE SINGLE- ENGINE LAND", "AIRPLANE SINGLE- ENGINE SEA",
            "AIRPLANE MULTI- ENGINE LAND", "NEBASET", "ROTORCRAFT HELICOPTER",
            "GLIDER", "TURBOPROP", "D A Y", "N I G H T"
        ]
        
        let rightHeaders = [
            "NIGHT", "ACTUAL INSTRUMENT", "SIMULATED INSTRUMENT (HOOD)",
            "APP NO. TYPE", "FLIGHT SIMULATOR", "CROSS COUNTRY", "SOLO",
            "PILOT IN COMMAND", "SECOND IN COMMAND", "DUAL RECEIVED",
            "AS FLIGHT INSTRUCTOR", "REMARKS AND ENDORSEMENTS"
        ]
        
        // Use headers based on which page we're processing
        let headers = isLeftPage ? leftHeaders : rightHeaders
        
        // Skip the first 8 rows (original header rows) and use data rows
        let dataRows = Array(rows.dropFirst(8))
        guard !dataRows.isEmpty else { return rows }
        
        // Detect column positions from data rows
        var colPositions: [CGFloat] = []
        for row in dataRows.prefix(5) {
            for item in row {
                let x = item.bounds.minX
                if !colPositions.contains(where: { abs($0 - x) < 30 }) {
                    colPositions.append(x)
                }
            }
        }
        colPositions.sort()
        
        // Create header row with exact number of columns matching our header array
        var mergedHeader: [(text: String, bounds: CGRect, confidence: Float)] = []
        let headerY = rows[0][0].bounds.minY
        let numColumns = headers.count
        
        // If we have more detected columns than headers, merge nearby columns
        if colPositions.count > numColumns {
            // Group column positions into the expected number of columns
            let avgSpacing = (colPositions.last! - colPositions.first!) / CGFloat(numColumns - 1)
            var adjustedPositions: [CGFloat] = []
            
            for i in 0..<numColumns {
                let targetX = colPositions.first! + (CGFloat(i) * avgSpacing)
                // Find closest actual column position
                let closest = colPositions.min(by: { abs($0 - targetX) < abs($1 - targetX) }) ?? targetX
                adjustedPositions.append(closest)
            }
            colPositions = adjustedPositions
        }
        
        // Create header with our predefined headers
        for (idx, headerText) in headers.enumerated() {
            let colX = idx < colPositions.count ? colPositions[idx] : (colPositions.last ?? 0) + CGFloat(idx * 50)
            let bounds = CGRect(x: colX, y: headerY, width: 50, height: 20)
            mergedHeader.append((text: headerText, bounds: bounds, confidence: 1.0))
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
        
        // Add comprehensive metadata header
        csv += "# ========================================\n"
        csv += "# Dual Table OCR Results\n"
        csv += "# Using DocumentRecognizerModule.processDualImages\n"
        csv += "# ========================================\n"
        csv += "# Left page columns: \(leftRows.first?.count ?? 0)\n"
        csv += "# Right page columns: \(rightRows.first?.count ?? 0)\n"
        csv += "# Total rows: \(maxRows)\n"
        csv += "# Processing date: \(Date())\n"
        csv += "# ========================================\n\n"
        
        for i in 0..<maxRows {
            let leftCols = i < leftRows.count ? leftRows[i] : []
            let rightCols = i < rightRows.count ? rightRows[i] : []
            let combined = leftCols + rightCols
            let line = combined.map { "\"\($0)\"" }.joined(separator: ",")
            csv += line + "\n"
        }
        
        return csv
    }
    
    private func extractDateColumn(rawData: [[(text: String, bounds: CGRect, confidence: Float)]]) -> [String: Any] {
        guard rawData.count > 1 else {
            return [
                "columnName": "",
                "columnBounds": [:],
                "cells": []
            ]
        }
        
        let headerRow = rawData[0]
        guard let dateHeader = headerRow.first(where: { $0.text.uppercased().contains("DATE") }) else {
            // DATE column not found, return empty structure
            return [
                "columnName": "",
                "columnBounds": [:],
                "cells": []
            ]
        }
        
        let dateX = dateHeader.bounds.minX
        let dateWidth = dateHeader.bounds.width
        let leftBoundary = dateX
        let rightBoundary = dateX + dateWidth
        
        let dataRows = Array(rawData.dropFirst())
        let topBoundary = dataRows.first?.first?.bounds.minY ?? dateHeader.bounds.maxY
        let bottomBoundary = dataRows.last?.last?.bounds.maxY ?? topBoundary
        
        let columnBounds: [String: Any] = [
            "left": leftBoundary,
            "right": rightBoundary,
            "top": topBoundary,
            "bottom": bottomBoundary,
            "width": rightBoundary - leftBoundary,
            "height": bottomBoundary - topBoundary
        ]
        
        var cells: [[String: Any]] = []
        cells.append([
            "value": dateHeader.text,
            "boundingBox": [
                "left": dateHeader.bounds.minX,
                "right": dateHeader.bounds.maxX,
                "top": dateHeader.bounds.minY,
                "bottom": dateHeader.bounds.maxY
            ],
            "confidence": dateHeader.confidence,
            "isHeader": true
        ])
        
        for row in dataRows {
            for cell in row {
                let cellX = cell.bounds.minX
                if abs(cellX - dateX) < 20 {
                    cells.append([
                        "value": cell.text,
                        "boundingBox": [
                            "left": cell.bounds.minX,
                            "right": cell.bounds.maxX,
                            "top": cell.bounds.minY,
                            "bottom": cell.bounds.maxY
                        ],
                        "confidence": cell.confidence,
                        "isHeader": false
                    ])
                    break
                }
            }
        }
        
        return [
            "columnName": dateHeader.text,
            "columnBounds": columnBounds,
            "cells": cells
        ]
    }
    
    private func detectRectangles(cgImage: CGImage, imageSize: CGSize, completion: @escaping ([[String: Any]]) -> Void) {
        let request = VNDetectRectanglesRequest { request, error in
            guard error == nil,
                  let observations = request.results as? [VNRectangleObservation] else {
                completion([])
                return
            }
            
            var rectangles: [[String: Any]] = []
            for observation in observations {
                let topLeft = CGPoint(
                    x: observation.topLeft.x * imageSize.width,
                    y: (1 - observation.topLeft.y) * imageSize.height
                )
                let topRight = CGPoint(
                    x: observation.topRight.x * imageSize.width,
                    y: (1 - observation.topRight.y) * imageSize.height
                )
                let bottomLeft = CGPoint(
                    x: observation.bottomLeft.x * imageSize.width,
                    y: (1 - observation.bottomLeft.y) * imageSize.height
                )
                let bottomRight = CGPoint(
                    x: observation.bottomRight.x * imageSize.width,
                    y: (1 - observation.bottomRight.y) * imageSize.height
                )
                
                rectangles.append([
                    "topLeft": ["x": topLeft.x, "y": topLeft.y],
                    "topRight": ["x": topRight.x, "y": topRight.y],
                    "bottomLeft": ["x": bottomLeft.x, "y": bottomLeft.y],
                    "bottomRight": ["x": bottomRight.x, "y": bottomRight.y],
                    "confidence": observation.confidence
                ])
            }
            
            completion(rectangles)
        }
        
        request.minimumAspectRatio = 0.1
        request.maximumAspectRatio = 1.0
        request.minimumSize = 0.01
        request.maximumObservations = 100
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            try? handler.perform([request])
        }
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
}
