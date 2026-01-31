import Foundation
import UIKit
import React
@preconcurrency import Vision
import FoundationModels

@available(iOS 26.0, *)
@objc(DocumentRecognizerWithLLM)
class DocumentRecognizerWithLLM: NSObject {
    
    private var session: LanguageModelSession?
    private var isInitialized = false
    
    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    // MARK: - Initialization
    
    @objc(initialize:withRejecter:)
    func initialize(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let model = SystemLanguageModel.default
            
            // Check availability
            switch model.availability {
            case .available:
                // Create session with custom instructions for table extraction
                session = LanguageModelSession(model: model) {
                    """
                    You are an expert at analyzing tabular data from OCR results. Your task is to:
                    1. Understand the spatial layout of text elements (rows, columns, cells)
                    2. Correct OCR errors in handwritten text
                    3. Align data into proper table structure
                    4. Extract accurate values preserving decimal formats
                    5. Handle merged cells and multi-line entries
                    
                    Focus on precision and spatial relationships between text elements.
                    """
                }
                
                isInitialized = true
                resolve(["success": true, "message": "Foundation Models initialized"])
                
            case .unavailable(let reason):
                let errorMsg = "Foundation Models unavailable: \(reason)"
                reject("UNAVAILABLE", errorMsg, nil)
            }
        }
    }
    
    // MARK: - Enhanced Table Extraction
    
    @Generable
    struct TableCell: Equatable {
        @Guide(description: "The extracted text value from the cell")
        let value: String
        
        @Guide(description: "Row index starting from 0")
        let row: Int
        
        @Guide(description: "Column index starting from 0")
        let column: Int
        
        @Guide(description: "Column header name")
        let columnHeader: String
        
        @Guide(description: "Confidence score 0.0-1.0")
        let confidence: Double
    }
    
    @Generable
    struct TableStructure: Equatable {
        @Guide(description: "Total number of rows in the table")
        let rowCount: Int
        
        @Guide(description: "Total number of columns in the table")
        let columnCount: Int
        
        @Guide(description: "Array of all cells with their positions and values")
        let cells: [TableCell]
        
        @Guide(description: "Column headers if present")
        let headers: [String]
    }
    
    @objc(processTableWithLLM:rightUri:contextPrompt:withResolver:withRejecter:)
    func processTableWithLLM(
        _ leftUri: String,
        rightUri: String,
        contextPrompt: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        guard isInitialized, session != nil else {
            reject("NOT_INITIALIZED", "Call initialize() first", nil)
            return
        }
        
        guard let leftImage = UIImage(contentsOfFile: leftUri),
              let rightImage = UIImage(contentsOfFile: rightUri),
              let leftCGImage = leftImage.cgImage,
              let rightCGImage = rightImage.cgImage else {
            reject("IMAGE_ERROR", "Can't load images", nil)
            return
        }
        
        Task {
            do {
                // Step 1: Extract raw OCR data with spatial information
                let leftOCR = try await extractOCRWithSpatialInfo(cgImage: leftCGImage, imageSize: leftImage.size)
                let rightOCR = try await extractOCRWithSpatialInfo(cgImage: rightCGImage, imageSize: rightImage.size)
                
                // Step 2: Use LLM to understand table structure and correct errors
                let leftTable = try await analyzeTableStructure(ocrData: leftOCR, context: contextPrompt, side: "left")
                let rightTable = try await analyzeTableStructure(ocrData: rightOCR, context: contextPrompt, side: "right")
                
                // Step 3: Combine and align tables
                let combinedCSV = combineTablesWithLLM(left: leftTable, right: rightTable)
                
                // Step 4: Use LLM to correct errors in the CSV
                let correctedCSV = try await correctCSVWithLLM(csv: combinedCSV, context: contextPrompt)
                
                // Step 5: Calculate totals if requested
                let calculations = try await calculateTotals(csv: correctedCSV, context: contextPrompt)
                
                resolve([
                    "csv": correctedCSV,
                    "leftTable": serializeTable(leftTable),
                    "rightTable": serializeTable(rightTable),
                    "calculations": calculations,
                    "metadata": [
                        "leftRows": leftTable.rowCount,
                        "leftColumns": leftTable.columnCount,
                        "rightRows": rightTable.rowCount,
                        "rightColumns": rightTable.columnCount
                    ],
                    "rawLLMResponse": [
                        "leftTable": serializeTable(leftTable),
                        "rightTable": serializeTable(rightTable),
                        "calculations": calculations
                    ]
                ])
            } catch {
                reject("PROCESSING_ERROR", error.localizedDescription, error)
            }
        }
    }
    
    // MARK: - OCR with Spatial Information
    
    private func extractOCRWithSpatialInfo(cgImage: CGImage, imageSize: CGSize) async throws -> [(text: String, bounds: CGRect, confidence: Float)] {
        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                
                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    continuation.resume(returning: [])
                    return
                }
                
                var results: [(text: String, bounds: CGRect, confidence: Float)] = []
                
                for observation in observations {
                    guard let topCandidate = observation.topCandidates(1).first else { continue }
                    
                    let bounds = CGRect(
                        x: observation.boundingBox.origin.x * imageSize.width,
                        y: (1 - observation.boundingBox.origin.y - observation.boundingBox.height) * imageSize.height,
                        width: observation.boundingBox.width * imageSize.width,
                        height: observation.boundingBox.height * imageSize.height
                    )
                    
                    results.append((
                        text: topCandidate.string,
                        bounds: bounds,
                        confidence: topCandidate.confidence
                    ))
                }
                
                continuation.resume(returning: results)
            }
            
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try handler.perform([request])
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    // MARK: - LLM-Based Table Analysis
    
    private func analyzeTableStructure(
        ocrData: [(text: String, bounds: CGRect, confidence: Float)],
        context: String,
        side: String
    ) async throws -> TableStructure {
        guard let session = session else {
            throw NSError(domain: "DocumentRecognizerWithLLM", code: -1, userInfo: [NSLocalizedDescriptionKey: "Session not initialized"])
        }
        
        // First, use traditional OCR grouping to get initial structure
        let (rows, rawData) = groupIntoRowsWithData(textItems: ocrData, isLeftPage: side == "left")
        
        // Build initial table structure
        var cells: [TableCell] = []
        var headers: [String] = []
        
        // Extract headers from first row
        if !rows.isEmpty {
            headers = rows[0]
        }
        
        // Build cells from all rows
        for (rowIdx, row) in rows.enumerated() {
            for (colIdx, value) in row.enumerated() {
                if rowIdx < rawData.count && colIdx < rawData[rowIdx].count {
                    let cellData = rawData[rowIdx][colIdx]
                    let columnHeader = colIdx < headers.count ? headers[colIdx] : ""
                    cells.append(TableCell(
                        value: value,
                        row: rowIdx,
                        column: colIdx,
                        columnHeader: columnHeader,
                        confidence: Double(cellData.confidence)
                    ))
                }
            }
        }
        
        // Only use LLM for error correction on low-confidence cells
        let lowConfidenceCells = cells.filter { $0.confidence < 0.8 }
        
        if !lowConfidenceCells.isEmpty && lowConfidenceCells.count < 50 {
            // Format only low-confidence cells for LLM correction
            let cellsToCorrect = lowConfidenceCells.map { cell in
                "[\(cell.row),\(cell.column)]: \"\(cell.value)\" (conf: \(String(format: "%.2f", cell.confidence)))"
            }.joined(separator: "\n")
            
            let prompt = Prompt {
                """
                Correct OCR errors in these flight logbook cells:
                
                \(cellsToCorrect)
                
                Common errors to fix:
                - Slashed zero (Ø) → 0
                - Aircraft: LB25→LR25, BE-Z-O→BE-200, IAILY→IA1124
                - Decimals: "2|8"→"2.8", "|6"→"0.6"
                
                Return corrected values only if you're confident there's an error.
                """
            }
            
            // Note: For now, skip LLM correction to avoid context issues
            // Just return the OCR-based structure
        }
        
        return TableStructure(
            rowCount: rows.count,
            columnCount: rows.first?.count ?? 0,
            cells: cells,
            headers: headers
        )
    }
    
    // Helper function to group OCR data into rows (reuse from DocumentRecognizerModule)
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
        
        // Use the header merging logic
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
        
        let headers = isLeftPage ? leftHeaders : rightHeaders
        
        // Skip first 8 rows and use data rows
        let dataRows = Array(rows.dropFirst(min(8, rows.count)))
        
        // Detect column positions
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
        
        // Adjust to match header count
        if colPositions.count > headers.count {
            let avgSpacing = (colPositions.last! - colPositions.first!) / CGFloat(headers.count - 1)
            var adjustedPositions: [CGFloat] = []
            for i in 0..<headers.count {
                let targetX = colPositions.first! + (CGFloat(i) * avgSpacing)
                let closest = colPositions.min(by: { abs($0 - targetX) < abs($1 - targetX) }) ?? targetX
                adjustedPositions.append(closest)
            }
            colPositions = adjustedPositions
        }
        
        // Build header row
        let headerY = rows.first?.first?.bounds.minY ?? 0
        var headerRow: [(text: String, bounds: CGRect, confidence: Float)] = []
        for (idx, headerText) in headers.enumerated() {
            let colX = idx < colPositions.count ? colPositions[idx] : CGFloat(idx * 50)
            let bounds = CGRect(x: colX, y: headerY, width: 50, height: 20)
            headerRow.append((text: headerText, bounds: bounds, confidence: 1.0))
        }
        
        let allRows = [headerRow] + dataRows
        let stringRows = allRows.map { row in row.map { $0.text } }
        
        return (stringRows, allRows)
    }
    
    private func formatOCRDataForLLM(_ ocrData: [(text: String, bounds: CGRect, confidence: Float)]) -> String {
        return ocrData.map { item in
            let x = Int(item.bounds.origin.x)
            let y = Int(item.bounds.origin.y)
            let w = Int(item.bounds.width)
            let h = Int(item.bounds.height)
            let conf = String(format: "%.2f", item.confidence)
            return "\"\(item.text)\", \(x), \(y), \(w), \(h), \(conf)"
        }.joined(separator: "\n")
    }
    
    // MARK: - CSV Error Correction
    
    private func correctCSVWithLLM(csv: String, context: String) async throws -> String {
        guard let session = session else {
            // If LLM not available, return original CSV
            return csv
        }
        
        // Only send first 20 rows to LLM to avoid context window issues
        let lines = csv.split(separator: "\n")
        let headerLines = Array(lines.prefix(5)) // Comments and header
        let dataLines = Array(lines.dropFirst(5).prefix(20)) // First 20 data rows
        let sampleCSV = (headerLines + dataLines).joined(separator: "\n")
        
        let prompt = Prompt {
            """
            Correct OCR errors in this flight logbook CSV data.
            
            Context: \(context)
            
            CSV Data (first 20 rows):
            \(sampleCSV)
            
            Common OCR errors to fix:
            1. Aircraft types: LB25→LR25, BE-Z-O→BE-200, BEZAY→BE-200, IAILY→IA1124, IAI24→IA1124
            2. Slashed zero: Ø→0 (not 6)
            3. Character confusion: 0/O, 1/I, 8/B, 5/S
            4. Decimal format: "2|8"→"2.8", "|6"→"0.6", "2|"→"2.0"
            5. Airport codes: 3-letter codes (HOU, IAH, DFW, etc.)
            6. Date format: M/D or MM/DD (9/10 = September 10, not August)
            
            Return ONLY the corrected CSV rows (no explanations).
            Keep the same structure and number of columns.
            Only fix obvious errors - preserve original text if uncertain.
            """
        }
        
        do {
            let response = try await session.respond(to: prompt)
            let correctedSample = response.content
            
            // Replace the sample rows with corrected ones
            let remainingLines = Array(lines.dropFirst(25)) // Rows after the sample
            let correctedLines = correctedSample.split(separator: "\n").map { String($0) }
            let finalLines = headerLines.map { String($0) } + correctedLines + remainingLines.map { String($0) }
            let correctedCSV = finalLines.joined(separator: "\n")
            
            return correctedCSV
        } catch {
            // If LLM fails, return original CSV
            print("LLM correction failed: \(error.localizedDescription)")
            return csv
        }
    }
    
    // MARK: - Table Combination
    
    private func combineTablesWithLLM(left: TableStructure, right: TableStructure) -> String {
        var csv = "# Enhanced extraction using Apple Foundation Models\n"
        csv += "# Left columns: \(left.columnCount), Right columns: \(right.columnCount)\n\n"
        
        // Add headers
        let allHeaders = left.headers + right.headers
        csv += allHeaders.map { "\"\($0)\"" }.joined(separator: ",") + "\n"
        
        // Combine rows
        let maxRows = max(left.rowCount, right.rowCount)
        
        for rowIdx in 0..<maxRows {
            let leftCells = left.cells.filter { $0.row == rowIdx }.sorted { $0.column < $1.column }
            let rightCells = right.cells.filter { $0.row == rowIdx }.sorted { $0.column < $1.column }
            
            let leftValues = leftCells.map { "\"\($0.value)\"" }
            let rightValues = rightCells.map { "\"\($0.value)\"" }
            
            let rowData = leftValues + rightValues
            csv += rowData.joined(separator: ",") + "\n"
        }
        
        return csv
    }
    
    // MARK: - Calculations
    
    @Generable
    struct FlightCalculations: Equatable {
        @Guide(description: "Total flight hours across all entries")
        let totalHours: Double
        
        @Guide(description: "Total night hours")
        let totalNight: Double
        
        @Guide(description: "Total cross-country hours")
        let totalCrossCountry: Double
        
        @Guide(description: "Total PIC hours")
        let totalPIC: Double
        
        @Guide(description: "Total dual received hours")
        let totalDual: Double
        
        @Guide(description: "Number of day landings")
        let dayLandings: Int
        
        @Guide(description: "Number of night landings")
        let nightLandings: Int
    }
    
    private func calculateTotals(csv: String, context: String) async throws -> [String: Any] {
        guard let session = session else {
            throw NSError(domain: "DocumentRecognizerWithLLM", code: -1, userInfo: [NSLocalizedDescriptionKey: "Session not initialized"])
        }
        
        let prompt = Prompt {
            """
            Calculate totals from this flight log CSV data.
            
            Context: \(context)
            
            CSV Data:
            \(csv)
            
            Calculate:
            - Total flight hours (sum of TOTAL DURATION column)
            - Total night hours
            - Total cross-country hours
            - Total PIC hours
            - Total dual received hours
            - Total day landings
            - Total night landings
            
            Return the calculations.
            """
        }
        
        let response = try await session.respond(
            to: prompt,
            generating: FlightCalculations.self,
            options: GenerationOptions(temperature: 0.0)
        )
        
        let calcs = response.content
        
        return [
            "totalHours": calcs.totalHours,
            "totalNight": calcs.totalNight,
            "totalCrossCountry": calcs.totalCrossCountry,
            "totalPIC": calcs.totalPIC,
            "totalDual": calcs.totalDual,
            "dayLandings": calcs.dayLandings,
            "nightLandings": calcs.nightLandings
        ]
    }
    
    // MARK: - Serialization
    
    private func serializeTable(_ table: TableStructure) -> [String: Any] {
        return [
            "rowCount": table.rowCount,
            "columnCount": table.columnCount,
            "headers": table.headers,
            "cells": table.cells.map { cell in
                [
                    "value": cell.value,
                    "row": cell.row,
                    "column": cell.column,
                    "confidence": cell.confidence
                ]
            }
        ]
    }
}
