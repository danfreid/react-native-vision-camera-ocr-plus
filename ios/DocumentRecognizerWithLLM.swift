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
                
                // Step 4: Calculate totals if requested
                let calculations = try await calculateTotals(csv: combinedCSV, context: contextPrompt)
                
                resolve([
                    "csv": combinedCSV,
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
        
        // Format OCR data for LLM
        let ocrDescription = formatOCRDataForLLM(ocrData)
        
        let prompt = Prompt {
            """
            Analyze this OCR data from the \(side) page of a flight logbook table.
            
            Context: \(context)
            
            OCR Data (text, x, y, width, height, confidence):
            \(ocrDescription)
            
            Task:
            1. Identify the table structure (rows and columns)
            2. Group text elements into cells based on spatial proximity
            3. Correct common OCR errors in handwritten text:
               - Slashed zeros (Ø) should be 0, not 6
               - Distinguish between 0/O, 1/I, 8/B, 5/S
               - Fix aircraft codes: LB25→LR25, BE-Z-O→BE-200, IAILY→IA1124
            4. Handle decimal formats: "2|8" means 2.8, "|6" means 0.6
            5. Preserve empty cells as empty strings
            6. Extract column headers from the top rows
            
            Return the structured table data.
            """
        }
        
        let response = try await session.respond(
            to: prompt,
            generating: TableStructure.self,
            options: GenerationOptions(
                temperature: 0.1,  // Low temperature for precision
                maximumResponseTokens: 2000
            )
        )
        
        return response.content
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
