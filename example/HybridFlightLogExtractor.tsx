import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  AppState,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { initLlama, LlamaContext } from 'llama.rn';
import { File, Paths, Directory } from 'expo-file-system/next';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { DocumentRecognizer } from 'react-native-vision-camera-ocr';

// Model definitions
interface ModelConfig {
  id: string;
  name: string;
  size: string;
  modelFile: string;
  mmprojFile: string;
  modelUrl: string;
  mmprojUrl: string;
}

const HF_BASE_URL = 'https://huggingface.co/unsloth';

const MODELS: ModelConfig[] = [
  {
    id: 'qwen3-vl-2b',
    name: 'Qwen3-VL 2B',
    size: '~1.5GB',
    modelFile: 'Qwen3-VL-2B-Instruct-Q4_K_M.gguf',
    mmprojFile: 'mmproj-Qwen3-VL-2B-F16.gguf',
    modelUrl: `${HF_BASE_URL}/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3-VL-2B-Instruct-Q4_K_M.gguf`,
    mmprojUrl: `${HF_BASE_URL}/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-F16.gguf`,
  },
];


// Helper function to extract a text column (like DATE, AIRCRAFT MAKE, etc.)
async function extractTextColumn(
  columnName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  leftImage: string,
  pixelThreshold: number = 1200,
  llamaContext?: LlamaContext | null,
  requestId?: string,
  columnGrouping?: string
) {
  const ROW_SPACING = 36.25;
  const CROP_Y = 96;
  
  console.log(`[Process] Extracting ${columnName} column...`);
  console.log(`  Column: x=${x}, y=${y}, width=${width}`);

  // For DATE column: Skip Vision OCR and column LLM, go straight to per-cell LLM
  const skipColumnProcessing = (columnName === 'DATE');
  
  let croppedColumn: any = null;
  let columnBbox: any = null;
  let columnOCR: any = { tables: [] };
  let llmColumnResult: string[] = [];

  if (!skipColumnProcessing) {
    // Crop the entire column for Vision OCR (start slightly above first data cell to include grid lines)
    const cropX = x - 5; // Expand left to include left grid line
    const cropWidth = width + 20; // Expand right to include right grid line (10 pixels on each side)
    
    const lastRowY = y + (13 * ROW_SPACING);
    const columnHeight = (lastRowY + height + 10) - CROP_Y;
    
    columnBbox = {
      originX: cropX,
      originY: CROP_Y, // Start at Y=96 like DATE column
      width: cropWidth,
      height: columnHeight,
    };

    croppedColumn = await ImageManipulator.manipulateAsync(
      leftImage,
      [{ crop: columnBbox }],
      { compress: 1, format: ImageManipulator.SaveFormat.PNG }
    );

    // Run Vision OCR on the cropped column
    columnOCR = await DocumentRecognizer({
      uri: croppedColumn.uri,
      searchCells: [],
    });

    console.log(`  Vision detected: ${columnOCR.tables?.length || 0} tables`);

    // ========== LLM OCR ON FULL COLUMN ==========
    if (llamaContext) {
      console.log(`  Running LLM OCR on full column...`);
      try {
        // const llmColumnPrompt = `This image shows a single column with 14 rows of handwritten text. Read each row separately from top to bottom. Each row may contain different text - do not assume rows are the same. Return a JSON array with exactly 14 strings, one for each row. Format: ["row1","row2","row3",...,"row14"], without Markdown or newlines.`;
        // const llmColumnPrompt = `This image shows 2 columns with 14 rows of handwritten text. Read each row separately from top to bottom. Each row may contain different text - do not assume rows are the same. Return a JSON array with exactly 14 rows, without Markdown or newlines.`;
          // "B/16  L225  N308A5  H",
          // "9/11  LB 25  N308A5  H",
          // "9/17  BE246  N206A5  H",
          // "9/18  E-200  N206A5  H",
          // "9/21  BE-200  N206A5  H",
          // "9/22  BE-210  N206A5  H",
          // "9/23  BE-200  N206A5  H",
          // "9/24  BE-200  N206A5  H",
          // "9/24  BE-200  N206A5  H",
          // "9/24  IAI124  N206A5  H",
          // "9/25  IAI124  N206A5  H",
          // "9/26  L225  N308A5  H",
          // "9/10  L225  N308A5  H",
          // "9/17  LR25  N308A5  H"
        // const llmColumnPrompt = `This image shows 2 columns (A,B), each with 14 rows of handwritten text. Return a JSON array with all 14 rows.`;
        // const llmColumnPrompt = `This image shows 14 rows of handwritten text. Return a JSON array with all 14 rows.`;
        // const llmColumnPrompt = `This image shows 2-4 columns with 14 rows of handwritten text. Read each row separately from top to bottom. Each row may contain different text - do not assume rows are the same. Return a JSON array with exactly 14 rows, without Markdown or newlines.`;
        // const llmColumnPrompt = `This image shows 2-20 columns with 14 rows of handwritten text. Read each row separately from top to bottom. Each row may contain different text - do not assume rows are the same. Return a JSON array with exactly 14 rows of CSV values, without Markdown or newlines.`;
        const llmColumnPrompt = `This image shows ${columnGrouping} columns with 14 rows of handwritten text. Read each row separately from top to bottom. Each row may contain different text - do not assume rows are the same. Return a JSON array with exactly 14 rows of CSV values, without Markdown or newlines.`;

        console.log(`  LLM Column Prompt (first 200 chars): ${llmColumnPrompt.substring(0, 200)}...`);

        console.log(`  LLM Column: Calling completion API for ${columnName}...`);
        const llmColumnResponse = await llamaContext.completion(
          {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: croppedColumn.uri } },
                  { type: 'text', text: llmColumnPrompt },
                ],
              },
            ],
            n_predict: 500,
            temperature: 0.0,
            stop: [']', '\n\n', '```'],
          },
          (_data) => {
            // Progress callback
          }
        );

        console.log(`  LLM Column: Response received`);
        
        let llmColumnText = llmColumnResponse.text || '';
        console.log(`  LLM Column Response Text (first 1800 chars): ${llmColumnText.substring(0, 1800)}`);
        
        // Strip markdown code blocks if present
        llmColumnText = llmColumnText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        llmColumnText = llmColumnText.trim();
        
        // Try to parse JSON array from response
        try {
          const jsonMatch = llmColumnText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            // Check if it's a nested array (each row is an array)
            if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
              // Convert nested arrays to strings by joining with spaces
              llmColumnResult = parsed.map((row: any[]) => row.join(' '));
            } else {
              llmColumnResult = parsed;
            }
            console.log(`  LLM Column Parsed: ${llmColumnResult.length} values`);
            console.log(`  LLM Column Values: ${JSON.stringify(llmColumnResult)}`);
          } else {
            console.log(`  LLM Column: No JSON array found in response`);
          }
        } catch (parseError: any) {
          console.log(`  LLM Column Parse Error: ${parseError.message}`);
        }
      } catch (error: any) {
        console.log(`  LLM Column Error: ${error?.message || 'Unknown error'}`);
      }
    } else {
      console.log(`  LLM OCR skipped: No LLM context available`);
    }
  } else {
    console.log(`  Skipping Vision OCR and column LLM for ${columnName} - will use per-cell LLM only`);
  }

  const extractions: any[] = [];

  // Extract each of the 14 rows
  for (let i = 0; i < 14; i++) {
    const rowNum = i + 1;
    const cellY = y + (i * ROW_SPACING);

    try {
      // Crop the cell
      const cellBbox = {
        originX: x,
        originY: cellY,
        width: width,
        height: height,
      };

      const croppedCell = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: cellBbox }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      // Analyze pixels
      let fileSize = 0;
      try {
        const imageInfo = await LegacyFileSystem.getInfoAsync(croppedCell.uri);
        if (imageInfo.exists) {
          fileSize = (imageInfo as any).size || 0;
        }
      } catch (error: any) {
        // Ignore
      }

      // Try to match Vision text by Y position (skip for DATE column)
      let visionText = '';
      let visionRow = -1;
      let visionColumn = -1;
      let visionConfidence = 0;
      let matchedByVision = false;

      if (!skipColumnProcessing) {
        const cellYInCroppedImage = cellY - CROP_Y; // Offset from start of cropped image

        if (columnOCR.tables && columnOCR.tables.length > 0) {
          const table = columnOCR.tables[0];
          for (const column of table.columns || []) {
            for (const cell of column.cells || []) {
              if (cell.boundingBox && cell.text && cell.text.trim()) {
                const visionCellY = cell.boundingBox.yMin;
                const yDiff = Math.abs(visionCellY - cellYInCroppedImage);
                
                if (yDiff < 20) { // 20px threshold like DATE
                  visionText = cell.text.trim();
                  visionRow = cell.rowIndex;
                  visionColumn = cell.columnIndex;
                  visionConfidence = cell.confidence || 0;
                  matchedByVision = true;
                  break;
                }
              }
            }
            if (matchedByVision) break;
          }
        }
      }

      // Determine if cell has content (Vision OR pixel analysis)
      // For DATE column, use pixel analysis only
      const pixelFallback = !matchedByVision && fileSize > pixelThreshold;
      const hasContent = matchedByVision || pixelFallback;
      
      const detectionMethod = matchedByVision ? 'Vision' : (pixelFallback ? 'Pixels' : 'None');

      // Get LLM column result for this row
      const llmColumnValue = llmColumnResult[i] || '';

      extractions.push({
        row: rowNum,
        column: columnName,
        text: visionText,
        visionText: visionText,
        llmColumnValue: llmColumnValue,
        hasContent: hasContent,
        fileSize: fileSize,
        confidence: visionConfidence,
        matchedByPosition: matchedByVision,
        hasContentByPixels: pixelFallback,
        detectionMethod: detectionMethod,
        boundingBox: { x: x, y: cellY, width: width, height: height },
        croppedImageUri: croppedCell.uri,
        visionRow: visionRow,
        visionColumn: visionColumn,
      });
    } catch (error: any) {
      extractions.push({
        row: rowNum,
        column: columnName,
        hasContent: false,
        error: error.message,
      });
    }
  }

  console.log(`  ${columnName}: ${extractions.filter((c: any) => c.hasContent).length}/14 cells with content`);

  // ========== HYBRID CORRECTION: Map LLM's compacted values to correct positions ==========
  // Skip for DATE column since we're not using column LLM
  if (llmColumnResult.length > 0 && !skipColumnProcessing) {
    console.log(`  [Hybrid] Mapping LLM compacted values to correct positions...`);
    console.log(`  [Hybrid] LLM returned ${llmColumnResult.length} values (compacted, no empties)`);
    console.log(`  [Hybrid] LLM values: ${JSON.stringify(llmColumnResult)}`);
    
    const correctedLlmResult: string[] = [];
    let llmValueIndex = 0;
    
    for (let i = 0; i < 14; i++) {
      const cell = extractions[i];
      
      if (!cell.hasContent) {
        correctedLlmResult.push('');
      } else {
        if (llmValueIndex < llmColumnResult.length) {
          const llmValue = llmColumnResult[llmValueIndex] || '';
          correctedLlmResult.push(llmValue);
          llmValueIndex++;
        } else {
          console.log(`  [Hybrid] Warning: Row ${i + 1} has content but no LLM value available`);
          correctedLlmResult.push('');
        }
      }
    }
    
    console.log(`  [Hybrid] Corrected LLM: ${JSON.stringify(correctedLlmResult)}`);
    console.log(`  [Hybrid] Pixel detection: ${extractions.map((c: any) => c.hasContent ? '✓' : '✗').join(' ')}`);
    console.log(`  [Hybrid] Used ${llmValueIndex} of ${llmColumnResult.length} LLM values`);
    
    // Update extractions with corrected LLM values
    extractions.forEach((cell: any, idx: number) => {
      cell.llmColumnValue = correctedLlmResult[idx] || '';
    });
    
    llmColumnResult = correctedLlmResult;
  } else if (skipColumnProcessing) {
    console.log(`  [Hybrid] Skipping hybrid correction for ${columnName} - using per-cell LLM only`);
  } else {
    console.log(`  [Hybrid] No LLM values returned, skipping correction`);
  }

  // ========== PER-CELL LLM VERIFICATION (DATE COLUMN ONLY) ==========
  if (columnName === 'DATE' && llamaContext) {
    console.log(`  [Per-Cell] Running per-cell LLM on all DATE cells with content...`);
    
    // For DATE column, run per-cell LLM on ALL cells that have content
    const cellsToVerify: number[] = [];
    for (let i = 0; i < 14; i++) {
      const cell = extractions[i];
      if (cell.hasContent) {
        cellsToVerify.push(i);
      }
    }
    
    // Run per-cell LLM on all cells with content
    for (const idx of cellsToVerify) {
      const cell = extractions[idx];
      try {
        const perCellPrompt = `Read this handwritten date. Format is month/day (M/D or M/DD).
The FIRST number before the "/" is the MONTH.
The SECOND number after the "/" is the DAY.
Look carefully at the first digit - is it 8 (two circles stacked) or 9 (circle with tail)?
Answer with just the date in M/D format:`;
        const perCellResponse = await llamaContext.completion(
          {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: cell.croppedImageUri } },
                  { type: 'text', text: perCellPrompt },
                ],
              },
            ],
            n_predict: 15,
            temperature: 0.1,
            stop: ['\n', '```'],
          },
          (_data) => {}
        );

        let perCellText = (perCellResponse.text || '').trim();
        // Clean up response
        perCellText = perCellText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        perCellText = perCellText.replace(/["\[\]]/g, ''); // Remove quotes and brackets
        
        // Update with per-cell result
        cell.llmPerCellValue = perCellText;
        cell.llmColumnValue = perCellText; // Use per-cell as the final value
        llmColumnResult[idx] = perCellText;
      } catch (error: any) {
        console.log(`  [Per-Cell] Row ${cell.row}: Error - ${error.message}`);
      }
    }

    console.log(`  [Per-Cell] Final values before post-processing: ${JSON.stringify(llmColumnResult)}`);
    
    // ========== POST-PROCESSING: Detect month rollovers ==========
    let correctionsCount = 0;
    let currentMonth = null; // Track the current month as we go
    
    for (let i = 0; i < 14; i++) {
      const currDate = llmColumnResult[i];
      
      if (currDate) {
        const currMatch = currDate.match(/^(\d+)\/(\d+)$/);
        
        if (currMatch) {
          let currMonth = parseInt(currMatch[1]);
          const currDay = parseInt(currMatch[2]);
          
          // First date - establish baseline
          if (i === 0) {
            currentMonth = currMonth;
          } else {
            const prevDate = llmColumnResult[i - 1];
            const prevMatch = prevDate.match(/^(\d+)\/(\d+)$/);
            
            if (prevMatch && currentMonth !== null) {
              const prevDay = parseInt(prevMatch[2]);
              
              // If day drops by more than 15 (e.g., 25 → 5), month rolled over
              if (currDay < prevDay && (prevDay - currDay) > 15) {
                currentMonth = currentMonth + 1;
                const correctedDate = `${currentMonth}/${currDay}`;
                llmColumnResult[i] = correctedDate;
                extractions[i].llmColumnValue = correctedDate;
                correctionsCount++;
              }
              // If model read wrong month but we know we're in a later month
              else if (currMonth < currentMonth) {
                const correctedDate = `${currentMonth}/${currDay}`;
                llmColumnResult[i] = correctedDate;
                extractions[i].llmColumnValue = correctedDate;
                correctionsCount++;
              }
            }
          }
        }
      }
    }
    console.log(`  [Per-Cell] Final values after post-processing: ${JSON.stringify(llmColumnResult)}`);
  }

  // ========== SKIP PER-CELL LLM FOR AIRCRAFT MAKE AND MODEL ==========
  if (columnName === 'AIRCRAFT MAKE AND MODEL') {
    console.log(`  [Per-Cell] Skipping per-cell LLM for AIRCRAFT MAKE - using column results only`);
    console.log(`  [Per-Cell] Final AIRCRAFT MAKE values (column): ${JSON.stringify(llmColumnResult)}`);
  }

  // ========== PER-CELL LLM VERIFICATION (AIRCRAFT IDENT COLUMN) ==========
  if (columnName === 'AIRCRAFT IDENT' && llamaContext) {
    console.log(`  [Per-Cell] Running per-cell LLM on all AIRCRAFT IDENT cells with content...`);
    
    for (let i = 0; i < 14; i++) {
      const cell = extractions[i];
      if (cell.hasContent) {
        try {
          const perCellResponse = await llamaContext.completion(
            {
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: cell.croppedImageUri } },
                    { type: 'text', text: 'Read the text from this handwritten cell. Answer with just the text.' },
                  ],
                },
              ],
              n_predict: 20,
              temperature: 0.1,
              stop: ['\n', '```'],
            },
            (_data) => {}
          );

          let perCellText = (perCellResponse.text || '').trim().replace(/```json\s*/g, '').replace(/```\s*/g, '').replace(/["\[\]]/g, '');
          cell.llmPerCellValue = perCellText;
          llmColumnResult[i] = perCellText;
        } catch (error: any) {
          console.log(`  [Per-Cell] Row ${cell.row}: Error - ${error.message}`);
        }
      }
    }

    console.log(`  [Per-Cell] Final AIRCRAFT IDENT values: ${JSON.stringify(llmColumnResult)}`);
  }

  return {
    extractions,
    croppedColumnUri: croppedColumn?.uri || null,
    columnBbox,
    ocrResult: {
      tablesCount: columnOCR.tables?.length || 0,
      rowCount: columnOCR.tables?.[0]?.rowCount || 0,
      columnCount: columnOCR.tables?.[0]?.columnCount || 0,
      rawText: columnOCR.rawText,
    },
    llmColumnResult: llmColumnResult,
  };
}

// Helper function to extract a flight duration column
async function extractFlightDurationColumn(
  columnName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  leftImage: string,
  pixelThreshold: number = 5800,
  llamaContext?: LlamaContext | null,
  requestId?: string
) {
  const ROW_SPACING = 36.25;
  const CROP_Y = 96;
  
  // Sub-columns (estimate: ~65% for hours, ~35% for tenths)
  const sub1Width = Math.floor(width * 0.65);
  const sub2Width = width - sub1Width - 1;
  const sub1X = x;
  const sub2X = x + sub1Width + 1;

  console.log(`[Process] Extracting ${columnName} column...`);
  console.log(`  Full column: x=${x}, y=${y}, width=${width}`);

  // Crop the entire column for Vision OCR
  const cropX = x - 7;
  const cropWidth = width + 20;
  const lastRowY = y + (13 * ROW_SPACING);
  const columnHeight = (lastRowY + height + 10) - CROP_Y;
  
  const columnBbox = {
    originX: cropX,
    originY: CROP_Y,
    width: cropWidth,
    height: columnHeight,
  };

  const croppedColumn = await ImageManipulator.manipulateAsync(
    leftImage,
    [{ crop: columnBbox }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );

  // Run Vision OCR on the cropped column
  const columnOCR = await DocumentRecognizer({
    uri: croppedColumn.uri,
    searchCells: [],
  });

  console.log(`  Vision detected: ${columnOCR.tables?.length || 0} tables`);

  // ========== LLM OCR ON FULL COLUMN ==========
  let llmColumnResult: string[] = [];
  if (llamaContext) {
    console.log(`  Running LLM OCR on full column...`);
    try {
      // Simple prompt without examples to avoid context contamination
      const llmColumnPrompt = `[Request: ${requestId || 'default'}] Extract all 14 flight duration values from this column image. Each cell has two sub-columns: hours (left) and tenths (right). Format each as "hours.tenths" (e.g., "2.8", "4.2", "0.6"). If a cell is empty, use empty string "". Return ONLY a JSON array of 14 strings, one per row, in order from top to bottom.`;
      
      console.log(`  LLM Column: Calling completion API for ${columnName}...`);
      const llmColumnResponse = await llamaContext.completion(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: croppedColumn.uri } },
                { type: 'text', text: llmColumnPrompt },
              ],
            },
          ],
          n_predict: 200,
          temperature: 0.1,
        },
        (_data) => {
          // Progress callback
        }
      );

      console.log(`  LLM Column: Response received`);
      console.log(`  LLM Column: Response object:`, JSON.stringify(llmColumnResponse, null, 2));
      
      const llmColumnText = llmColumnResponse.text || '';
      console.log(`  LLM Column Response Text: ${llmColumnText}`);
      
      // Try to parse JSON array from response
      try {
        const jsonMatch = llmColumnText.match(/\[.*\]/s);
        if (jsonMatch) {
          llmColumnResult = JSON.parse(jsonMatch[0]);
          console.log(`  LLM Column Parsed: ${llmColumnResult.length} values`);
        } else {
          console.log(`  LLM Column: No JSON array found in response`);
        }
      } catch (parseError: any) {
        console.log(`  LLM Column Parse Error: ${parseError.message}`);
      }
    } catch (error: any) {
      console.log(`  LLM Column Error: ${error?.message || 'Unknown error'}`);
      console.log(`  LLM Column Error Stack:`, error?.stack);
      console.log(`  LLM Column Error Object:`, JSON.stringify(error, null, 2));
    }
  } else {
    console.log(`  LLM OCR skipped: No LLM context available`);
  }

  const extractions: any[] = [];

  // Extract each of the 14 rows
  for (let i = 0; i < 14; i++) {
    const rowNum = i + 1;
    const cellY = y + (i * ROW_SPACING);

    try {
      // Crop the full cell
      const fullCellBbox = {
        originX: x,
        originY: cellY,
        width: width,
        height: height,
      };

      const croppedFullCell = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: fullCellBbox }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      // Analyze pixels
      let fileSize = 0;
      try {
        const imageInfo = await LegacyFileSystem.getInfoAsync(croppedFullCell.uri);
        if (imageInfo.exists) {
          fileSize = (imageInfo as any).size || 0;
        }
      } catch (error: any) {
        // Ignore
      }

      // Crop sub-columns INDIVIDUALLY
      const croppedSub1 = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: { originX: sub1X, originY: cellY, width: sub1Width, height: height } }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      const croppedSub2 = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: { originX: sub2X, originY: cellY, width: sub2Width, height: height } }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      // FIRST: Try OCR on the FULL cell (both sub-columns together)
      let fullCellText = '';
      try {
        const fullCellOCR = await DocumentRecognizer({
          uri: croppedFullCell.uri,
          searchCells: [],
        });
        if (fullCellOCR.rawText && fullCellOCR.rawText.trim()) {
          fullCellText = fullCellOCR.rawText.trim();
        }
      } catch (error: any) {
        // Ignore
      }

      // Parse the full cell text to extract hours and tenths
      let hours = '';
      let tenths = '';
      
      if (fullCellText) {
        // Remove all non-digit characters except spaces
        const cleaned = fullCellText.replace(/[^0-9\s]/g, '');
        const digits = cleaned.split(/\s+/).filter(d => d.length > 0);
        
        if (digits.length === 2) {
          // Two separate digits: "2 4" -> 2.4
          hours = digits[0];
          tenths = digits[1];
        } else if (digits.length === 1) {
          const singleDigit = digits[0];
          if (singleDigit.length === 2) {
            // Two digits together: "24" -> 2.4
            hours = singleDigit[0];
            tenths = singleDigit[1];
          } else if (singleDigit.length === 1) {
            // Single digit - could be hours or tenths
            // For now, assume it's the tenths (more common to miss the hours)
            hours = '';
            tenths = singleDigit;
          }
        }
      }

      // Run OCR on sub-columns as fallback (only if full cell didn't work)
      let sub1Text = '';
      let sub2Text = '';
      
      if (!hours && !tenths) {
        try {
          const sub1OCR = await DocumentRecognizer({
            uri: croppedSub1.uri,
            searchCells: [],
          });
          if (sub1OCR.rawText && sub1OCR.rawText.trim()) {
            const rawText = sub1OCR.rawText.trim();
            sub1Text = rawText.replace(/[^0-9]/g, '');
            if (sub1Text) {
              hours = sub1Text;
            }
          }
        } catch (error: any) {
          // Ignore
        }

        try {
          const sub2OCR = await DocumentRecognizer({
            uri: croppedSub2.uri,
            searchCells: [],
          });
          if (sub2OCR.rawText && sub2OCR.rawText.trim()) {
            const rawText = sub2OCR.rawText.trim();
            sub2Text = rawText.replace(/[^0-9]/g, '');
            if (sub2Text) {
              tenths = sub2Text;
            }
          }
        } catch (error: any) {
          // Ignore
        }
      }

      // Combine into vision text
      let visionText = '';
      if (hours || tenths) {
        visionText = `${hours || '0'}.${tenths || '0'}`;
      }

      // Get LLM column result for this row (from full column extraction)
      const llmColumnValue = llmColumnResult[i] || '';

      // Store full cell text for analysis
      const fullCellRaw = fullCellText;

      // Determine if cell has content
      const hasContent = (hours.length > 0 || tenths.length > 0) || fileSize > pixelThreshold;
      const detectionMethod = (hours || tenths) ? 'Vision OCR' : (fileSize > pixelThreshold ? 'Pixel Fallback' : 'None');

      extractions.push({
        row: rowNum,
        column: columnName,
        hasContent: hasContent,
        fileSize: fileSize,
        visionText: visionText,
        fullCellText: fullCellRaw,
        sub1Text: hours,
        sub2Text: tenths,
        llmColumnValue: llmColumnValue,
        visionRow: -1,
        visionColumn: -1,
        visionConfidence: 0,
        matchedByVision: (hours.length > 0 || tenths.length > 0),
        cellHasVisionText: (hours.length > 0 || tenths.length > 0),
        detectionMethod: detectionMethod,
        boundingBox: { x: x, y: cellY, width: width, height: height },
        croppedImageUri: croppedFullCell.uri,
        croppedSub1Uri: croppedSub1.uri,
        croppedSub2Uri: croppedSub2.uri,
      });
    } catch (error: any) {
      extractions.push({
        row: rowNum,
        column: columnName,
        hasContent: false,
        error: error.message,
      });
    }
  }

  console.log(`  ${columnName}: ${extractions.filter((c: any) => c.hasContent).length}/14 cells with content`);

  // ========== HYBRID CORRECTION: Map LLM's compacted values to correct positions ==========
  if (llmColumnResult.length > 0) {
    console.log(`  [Hybrid] Mapping LLM compacted values to correct positions...`);
    console.log(`  [Hybrid] LLM returned ${llmColumnResult.length} values (compacted, no empties)`);
    console.log(`  [Hybrid] LLM values: ${JSON.stringify(llmColumnResult)}`);
    
    // Strategy: LLM returns only non-empty values in a compacted list.
    // Use pixel/Vision detection to know which rows have content, then map LLM values to those positions.
    // Example: If rows are [EMPTY, EMPTY, HAS, HAS, EMPTY, HAS] and LLM returns ["2.1", "3.2", "0.7"]
    // Result should be ["", "", "2.1", "3.2", "", "0.7"]
    
    const correctedLlmResult: string[] = [];
    let llmValueIndex = 0; // Index into the compacted LLM values array
    
    for (let i = 0; i < 14; i++) {
      const cell = extractions[i];
      
      if (!cell.hasContent) {
        // Pixel detection says empty - insert empty string
        correctedLlmResult.push('');
      } else {
        // Pixel detection says content - take next LLM value
        if (llmValueIndex < llmColumnResult.length) {
          const llmValue = llmColumnResult[llmValueIndex] || '';
          correctedLlmResult.push(llmValue);
          llmValueIndex++;
        } else {
          // Ran out of LLM values - this shouldn't happen but handle gracefully
          console.log(`  [Hybrid] Warning: Row ${i + 1} has content but no LLM value available`);
          correctedLlmResult.push('');
        }
      }
    }
    
    console.log(`  [Hybrid] Corrected LLM: ${JSON.stringify(correctedLlmResult)}`);
    console.log(`  [Hybrid] Pixel detection: ${extractions.map((c: any) => c.hasContent ? '✓' : '✗').join(' ')}`);
    console.log(`  [Hybrid] Used ${llmValueIndex} of ${llmColumnResult.length} LLM values`);
    
    // Replace with corrected version
    llmColumnResult = correctedLlmResult;
    
    // Update extractions with corrected LLM values
    extractions.forEach((cell: any, idx: number) => {
      cell.llmColumnValue = correctedLlmResult[idx] || '';
    });
  } else {
    console.log(`  [Hybrid] No LLM values returned, skipping correction`);
  }

  return {
    extractions,
    croppedColumnUri: croppedColumn.uri,
    columnBbox,
    ocrResult: {
      tablesCount: columnOCR.tables?.length || 0,
      rowCount: columnOCR.tables?.[0]?.rowCount || 0,
      columnCount: columnOCR.tables?.[0]?.columnCount || 0,
      rawText: columnOCR.rawText,
    },
    llmColumnResult: llmColumnResult,
  };
}

export default function HybridFlightLogExtractor() {
  // UI Display Control - set to true to show detailed column images
  const SHOW_ALL_COLUMNS = true; // Set to true to see all column details
  const SHOW_TOTAL_DURATION = true; // Always show TOTAL DURATION for debugging
  const SHOW_TURBOJET = true; // Show TURBOJET (sparse column with gaps)
  const SHOW_TURBOPROP = true; // Show TURBOPROP (starts empty, has values in middle)
  
  const [leftImage, setLeftImage] = useState<string | null>(null);
  const [rightImage, setRightImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [result2, setResult2] = useState<any>(null);
  const [modelReady, setModelReady] = useState(false);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelConfig | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [backgroundWarning, setBackgroundWarning] = useState(false);
  const contextRef = useRef<LlamaContext | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    checkAndLoadModel();

    // Monitor app state changes
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' && processingRef.current) {
        console.log('[Background] App moved to background during processing');
        setBackgroundWarning(true);
      } else if (nextAppState === 'active' && processingRef.current) {
        console.log(
          '[Background] App returned to foreground, processing continues'
        );
        setBackgroundWarning(false);
      }
    });

    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAndLoadModel = async () => {
    try {
      setStatus('Checking models...');

      const modelsDir = new Directory(Paths.document, 'models');

      // Create directory only if it doesn't exist
      if (!modelsDir.exists) {
        await modelsDir.create();
      }

      // Check which models are downloaded
      const downloaded: string[] = [];
      for (const model of MODELS) {
        const modelFile = new File(modelsDir, model.modelFile);
        const mmprojFile = new File(modelsDir, model.mmprojFile);
        if (modelFile.exists && mmprojFile.exists) {
          downloaded.push(model.id);
        }
      }
      setDownloadedModels(downloaded);

      if (downloaded.length > 0) {
        // Auto-load first downloaded model
        const firstModel = MODELS.find((m) => downloaded.includes(m.id));
        if (firstModel) {
          setSelectedModel(firstModel);
          await loadModel(firstModel);
        }
      } else {
        setStatus('No model found. Tap ⚙️ to download.');
      }
    } catch (error: any) {
      console.error('Model check error:', error);
      setStatus(`Error: ${error.message}`);
    }
  };

  const loadModel = async (model: ModelConfig) => {
    try {
      setStatus(`Loading ${model.name}...`);
      console.log(`[Model] Loading ${model.name} (${model.id})...`);

      const modelsDir = new Directory(Paths.document, 'models');
      const modelFile = new File(modelsDir, model.modelFile);
      const mmprojFile = new File(modelsDir, model.mmprojFile);

      if (!modelFile.exists || !mmprojFile.exists) {
        const errorMsg = 'Model files not found';
        console.error(`[Model] ${errorMsg}`);
        setStatus(errorMsg);
        Alert.alert('Error', errorMsg);
        return;
      }

      console.log(`[Model] Model file: ${modelFile.uri}`);
      console.log(`[Model] Mmproj file: ${mmprojFile.uri}`);
      console.log(`[Model] Model size: ${modelFile.size} bytes`);
      console.log(`[Model] Mmproj size: ${mmprojFile.size} bytes`);

      // Release old context if exists
      if (contextRef.current) {
        console.log('[Model] Releasing old context...');
        await contextRef.current.release();
        contextRef.current = null;
      }

      const context = await initLlama({
        model: modelFile.uri,
        use_mlock: true,
        n_ctx: 8192,
        n_gpu_layers: 99,
      });

      console.log('[Model] Model initialized, loading multimodal...');

      await context.initMultimodal({
        path: mmprojFile.uri,
      });

      console.log('[Model] Multimodal initialized successfully');

      contextRef.current = context;
      setSelectedModel(model);
      setModelReady(true);
      setStatus('Model ready');
      console.log(`[Model] ${model.name} loaded and ready`);
    } catch (error: any) {
      console.error('[Model] Load error:', error);
      console.error('[Model] Error details:', JSON.stringify(error, null, 2));
      const errorMsg = `Failed to load model: ${error.message || 'Unknown error'}`;
      setStatus(errorMsg);
      Alert.alert('Model Load Failed', errorMsg);
    }
  };

  const downloadFile = async (
    url: string,
    filename: string
  ): Promise<boolean> => {
    try {
      const modelsDir = new Directory(Paths.document, 'models');

      // Create directory only if it doesn't exist
      if (!modelsDir.exists) {
        await modelsDir.create();
      }

      const downloadResumable = LegacyFileSystem.createDownloadResumable(
        url,
        `${LegacyFileSystem.documentDirectory}models/${filename}`,
        {},
        (downloadProgressData) => {
          const currentProgress =
            downloadProgressData.totalBytesWritten /
            downloadProgressData.totalBytesExpectedToWrite;
          setDownloadProgress(currentProgress);
        }
      );

      const downloadResult = await downloadResumable.downloadAsync();

      if (downloadResult?.uri) {
        const downloadedFile = new File(modelsDir, filename);
        if (
          downloadedFile.exists &&
          downloadedFile.size &&
          downloadedFile.size > 1000
        ) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Download error:', error);
      return false;
    }
  };

  const downloadModel = async (model: ModelConfig) => {
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      setStatus(`Downloading ${model.name} model...`);
      const modelSuccess = await downloadFile(model.modelUrl, model.modelFile);

      if (!modelSuccess) {
        setIsDownloading(false);
        Alert.alert('Download Failed', 'Failed to download model file.');
        return;
      }

      setStatus(`Downloading ${model.name} vision encoder...`);
      const mmprojSuccess = await downloadFile(
        model.mmprojUrl,
        model.mmprojFile
      );

      if (!mmprojSuccess) {
        setIsDownloading(false);
        Alert.alert('Download Failed', 'Failed to download vision encoder.');
        return;
      }

      // Download complete
      setIsDownloading(false);
      setDownloadedModels((prev) => [...prev, model.id]);

      // Load the model
      await loadModel(model);
    } catch (error: any) {
      setIsDownloading(false);
      Alert.alert('Error', error.message);
    }
  };

  const deleteModel = async (model: ModelConfig) => {
    Alert.alert(
      'Delete Model',
      `Delete ${model.name}? This will free up ${model.size} of storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Unload if active
              if (selectedModel?.id === model.id && contextRef.current) {
                await contextRef.current.release();
                contextRef.current = null;
                setSelectedModel(null);
                setModelReady(false);
              }

              // Delete files
              const modelsDir = new Directory(Paths.document, 'models');
              const modelFile = new File(modelsDir, model.modelFile);
              const mmprojFile = new File(modelsDir, model.mmprojFile);

              if (modelFile.exists) modelFile.delete();
              if (mmprojFile.exists) mmprojFile.delete();

              setDownloadedModels((prev) =>
                prev.filter((id) => id !== model.id)
              );

              Alert.alert('Deleted', `${model.name} has been removed.`);
            } catch (error: any) {
              Alert.alert('Error', `Failed to delete: ${error.message}`);
            }
          },
        },
      ]
    );
  };

  const pickImage = async (side: 'left' | 'right') => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!pickerResult.canceled) {
        // Don't resize - use original dimensions to match coordinate system
        if (side === 'left') {
          setLeftImage(pickerResult.assets[0].uri);
        } else {
          setRightImage(pickerResult.assets[0].uri);
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const processImages = async () => {
    if (!leftImage || !rightImage || !contextRef.current) {
      Alert.alert(
        'Error',
        'Please select both images and ensure model is loaded'
      );
      return;
    }

    setIsProcessing(true);
    processingRef.current = true;
    setProgress(0);
    setResult(null);
    setResult2(null);
    setBackgroundWarning(false);

    // Generate unique request ID for cache busting
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log(`[Process] Starting extraction with Request ID: ${requestId}`);

    try {
      // ========== EXTRACT DATE COLUMN ==========
      console.log('[Process] Step 1: Extracting DATE column...');
      setStatus('Extracting DATE column...');
      setProgress(85);

      const dateResult = await extractTextColumn('DATE', 16, 101, 48, 34, leftImage, 1200, contextRef.current, requestId, '2-3');
      const dateExtractions = dateResult.extractions;
      const cellPresenceMap = dateExtractions;

      // Create a simple dateHeader object for display purposes
      const dateHeader = { 
        value: 'DATE', 
        row: 0, 
        column: 0, 
        boundingBox: { x: 16, y: 65, width: 56, height: 34 } 
      };

      // Create dummy data for other text columns (not yet implemented)
      // const aircraftMakeExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      // const aircraftIdentExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      // const fromToExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      const selExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      const sesExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      const melExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      const heliExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      const gliderExtractions = Array.from({length: 14}, (_, i) => ({ row: i + 1, hasContent: false }));
      
      // Create dummy result objects for commented out columns
      // const aircraftMakeResult = { extractions: aircraftMakeExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };
      // const aircraftIdentResult = { extractions: aircraftIdentExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };
      // const fromToResult = { extractions: fromToExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };
      const selResult = { extractions: selExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };
      const sesResult = { extractions: sesExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };
      const melResult = { extractions: melExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };
      const heliResult = { extractions: heliExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };
      const gliderResult = { extractions: gliderExtractions, croppedColumnUri: '', columnBbox: {}, ocrResult: {} };

      // ========== EXTRACT TEXT COLUMNS ==========
      console.log('[Process] Step 2: Extracting other text columns...');
      setStatus('Extracting text columns...');

      // Extract 3 text columns using helper function (similar to DATE)
      // All are non-shaded and should have values in all rows
      // const aircraftMakeResult = await extractTextColumn('AIRCRAFT MAKE AND MODEL', 74, 101, 55, 34, leftImage, 1200, contextRef.current, requestId);
      // const aircraftMakeResult = await extractTextColumn('AIRCRAFT MAKE AND MODEL', 16, 101, 165, 34, leftImage, 1200, contextRef.current, requestId);  //Pretty good
      //const aircraftMakeResult = await extractTextColumn('AIRCRAFT MAKE AND MODEL', 16, 101, 165, 34, leftImage, 1200, contextRef.current, requestId);
      const aircraftMakeIdentResult = await extractTextColumn('AIRCRAFT MAKE AND MODEL', 16, 101, 165, 34, leftImage, 1200, contextRef.current, requestId,'2-6'); // Use for make and ident
      const fromToResult = await extractTextColumn('FROM-TO', 188, 101, 165, 34, leftImage, 1200, contextRef.current, requestId, '2-5'); // gets from-to and duration...but variable columns  with 2-5 columsn

      // Split aircraftMakeIdentResult into make and ident
      const aircraftMakeExtractions = aircraftMakeIdentResult.extractions.map((cell: any) => {
        const parts = (cell.llmColumnValue || '').split(/\s+/);
        return { ...cell, llmColumnValue: parts[1] || '' };
      });
      
      const aircraftIdentExtractions = aircraftMakeIdentResult.extractions.map((cell: any) => {
        const parts = (cell.llmColumnValue || '').split(/\s+/);
        return { ...cell, llmColumnValue: parts[2] || '' };
      });

      const aircraftMakeResult = { ...aircraftMakeIdentResult, extractions: aircraftMakeExtractions };
      const aircraftIdentResult = { ...aircraftMakeIdentResult, extractions: aircraftIdentExtractions };
      const fromToExtractions = fromToResult.extractions;

      // ========== EXTRACT TOTAL DURATION COLUMN ==========
      console.log('[Process] Step 3: Extracting TOTAL DURATION column...');
      setStatus('Extracting TOTAL DURATION column...');
      setProgress(88);

      const totalResult = await extractFlightDurationColumn('TOTAL DURATION', 292, 100, 66, 34, leftImage, 5500, contextRef.current, requestId); // Shaded, all have content
      const totalExtractions = totalResult.extractions;

      // ========== EXTRACT TURBOJET AND TURBOPROP COLUMNS ==========
      console.log('[Process] Step 7: Extracting TURBOJET and TURBOPROP columns...');
      setStatus('Extracting TURBOJET and TURBOPROP columns...');
      setProgress(92);

      const turbojetResult = await extractFlightDurationColumn('TURBOJET', 566, 101, 67, 34, leftImage, 5800, contextRef.current, requestId);
      const turbojetExtractions = turbojetResult.extractions;

      const turbopropResult = await extractFlightDurationColumn('TURBOPROP', 776, 101, 67, 34, leftImage, 3000, contextRef.current, requestId); // White background - much lower threshold
      const turbopropExtractions = turbopropResult.extractions;

      /*
      // Other flight duration columns - commented out for now
      const selResult = await extractFlightDurationColumn('SINGLE-ENGINE LAND', 360, 101, 65, 34, leftImage, 5800);
      const sesResult = await extractFlightDurationColumn('SINGLE-ENGINE SEA', 428, 101, 65, 34, leftImage, 10000); // Shaded, all empty - very high threshold
      const melResult = await extractFlightDurationColumn('MULTI-ENGINE LAND', 496, 101, 67, 34, leftImage, 3000); // Non-shaded, all have content - very low threshold
      const heliResult = await extractFlightDurationColumn('ROTORCRAFT HELICOPTER', 636, 101, 67, 34, leftImage, 5800); // Non-shaded
      const gliderResult = await extractFlightDurationColumn('GLIDER', 706, 101, 68, 34, leftImage, 10000); // Shaded, all empty - very high threshold

      const selExtractions = selResult.extractions;
      const sesExtractions = sesResult.extractions;
      const melExtractions = melResult.extractions;
      const heliExtractions = heliResult.extractions;
      const gliderExtractions = gliderResult.extractions;
      */

      // Dummy data already created above

      setProgress(95);
      setStatus('Finalizing results...');

      // Cell presence map already created above as dummy data

      setProgress(100);
      setStatus(`Complete! Extracted ${dateExtractions.length} DATE, 3 text columns, ${turbojetExtractions.length} TURBOJET, ${turbopropExtractions.length} TURBOPROP, and 6 flight duration columns`);
      console.log('[Process] Column extraction complete!');
      console.log(`[Process] DATE: ${cellPresenceMap.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] AIRCRAFT MAKE: ${aircraftMakeExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] AIRCRAFT IDENT: ${aircraftIdentExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] FROM-TO: ${fromToExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] TURBOJET: ${turbojetExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] TURBOPROP: ${turbopropExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] SINGLE-ENGINE LAND: ${selExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] SINGLE-ENGINE SEA: ${sesExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] MULTI-ENGINE LAND: ${melExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] ROTORCRAFT HELICOPTER: ${heliExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] GLIDER: ${gliderExtractions.filter((c: any) => c.hasContent).length}/14 cells`);

      // ========== DETAILED LOGGING FOR TOTAL DURATION ONLY ==========
      console.log('\n========== TOTAL DURATION COLUMN DETAILS ==========');
      console.log(`[Process] TOTAL DURATION: ${totalExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[LLM] Column-level extraction: ${totalResult.llmColumnResult?.length || 0} values`);
      if (totalResult.llmColumnResult && totalResult.llmColumnResult.length > 0) {
        console.log(`[LLM] Column values: ${JSON.stringify(totalResult.llmColumnResult)}`);
      }
      console.log('\n--- Per-Row Comparison ---');
      totalExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}`);
        console.log(`    Vision Detection: ${cell.detectionMethod}`);
        console.log(`    Vision Full Cell: "${cell.fullCellText || ''}"`);
        console.log(`    Vision Parsed: hours="${cell.sub1Text || ''}", tenths="${cell.sub2Text || ''}"`);
        console.log(`    Vision Combined: "${cell.visionText || ''}"`);
        console.log(`    LLM Column: "${cell.llmColumnValue || ''}"`);
        console.log(`    File Size: ${cell.fileSize} bytes`);
        
        // Compare results
        const visionValue = cell.visionText || '';
        const llmColumnValue = cell.llmColumnValue || '';
        
        if (visionValue && llmColumnValue && visionValue !== llmColumnValue) {
          console.log(`    ⚠️  MISMATCH: Vision="${visionValue}" vs LLM Column="${llmColumnValue}"`);
        }
        if (visionValue && llmColumnValue && visionValue !== llmColumnValue) {
          console.log(`    ⚠️  MISMATCH: Vision="${visionValue}" vs LLM Column="${llmColumnValue}"`);
        }
      });
      console.log('===================================================\n');

      // ========== DETAILED LOGGING FOR TURBOJET ==========
      console.log('\n========== TURBOJET COLUMN DETAILS ==========');
      console.log(`[Process] TURBOJET: ${turbojetExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[LLM] Column-level extraction: ${turbojetResult.llmColumnResult?.length || 0} values`);
      if (turbojetResult.llmColumnResult && turbojetResult.llmColumnResult.length > 0) {
        console.log(`[LLM] Column values: ${JSON.stringify(turbojetResult.llmColumnResult)}`);
      }
      console.log('\n--- Per-Row Comparison ---');
      turbojetExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}`);
        console.log(`    Vision: "${cell.visionText || ''}"`);
        console.log(`    LLM Column: "${cell.llmColumnValue || ''}"`);
        console.log(`    File Size: ${cell.fileSize} bytes`);
        
        const visionValue = cell.visionText || '';
        const llmColumnValue = cell.llmColumnValue || '';
        
        if (visionValue && llmColumnValue && visionValue !== llmColumnValue) {
          console.log(`    ⚠️  MISMATCH: Vision="${visionValue}" vs LLM Column="${llmColumnValue}"`);
        }
      });
      console.log('=============================================\n');

      // ========== DETAILED LOGGING FOR TURBOPROP ==========
      console.log('\n========== TURBOPROP COLUMN DETAILS ==========');
      console.log(`[Process] TURBOPROP: ${turbopropExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[LLM] Column-level extraction: ${turbopropResult.llmColumnResult?.length || 0} values`);
      if (turbopropResult.llmColumnResult && turbopropResult.llmColumnResult.length > 0) {
        console.log(`[LLM] Column values: ${JSON.stringify(turbopropResult.llmColumnResult)}`);
      }
      console.log('\n--- Per-Row Comparison ---');
      turbopropExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}`);
        console.log(`    Vision: "${cell.visionText || ''}"`);
        console.log(`    LLM Column: "${cell.llmColumnValue || ''}"`);
        console.log(`    File Size: ${cell.fileSize} bytes`);
        
        const visionValue = cell.visionText || '';
        const llmColumnValue = cell.llmColumnValue || '';
        
        if (visionValue && llmColumnValue && visionValue !== llmColumnValue) {
          console.log(`    ⚠️  MISMATCH: Vision="${visionValue}" vs LLM Column="${llmColumnValue}"`);
        }
      });
      console.log('==============================================\n');

      // ========== DETAILED LOGGING FOR AIRCRAFT IDENT ==========
      console.log('\n========== AIRCRAFT IDENT COLUMN DETAILS ==========');
      console.log(`[Process] AIRCRAFT IDENT: ${aircraftIdentExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[LLM] Column-level extraction: ${aircraftIdentResult.llmColumnResult?.length || 0} values`);
      if (aircraftIdentResult.llmColumnResult && aircraftIdentResult.llmColumnResult.length > 0) {
        console.log(`[LLM] Column values: ${JSON.stringify(aircraftIdentResult.llmColumnResult)}`);
      }
      console.log('\n--- Per-Row Comparison ---');
      aircraftIdentExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}`);
        console.log(`    Vision: "${cell.text || ''}"`);
        console.log(`    LLM Column: "${cell.llmColumnValue || ''}"`);
        console.log(`    LLM Per-Cell: "${cell.llmPerCellValue || ''}"`);
        console.log(`    Detection: ${cell.detectionMethod}`);
        
        const visionValue = cell.text || '';
        const llmValue = cell.llmPerCellValue || cell.llmColumnValue || '';
        
        if (visionValue && llmValue && visionValue !== llmValue) {
          console.log(`    ⚠️  MISMATCH: Vision="${visionValue}" vs LLM="${llmValue}"`);
        }
      });
      console.log('==============================================\n');

      // Hide detailed logging for other columns
      // Uncomment below to see details for all columns
      /*
      console.log('========== CELL PRESENCE MAP ==========');
      console.log('This map tells the LLM which cells have content vs which are empty:');
      console.log('\nDATE Column:');
      cellPresenceMap.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (detected by: ${cell.detectionMethod})`);
      });
      console.log('\nAIRCRAFT MAKE AND MODEL Column:');
      aircraftMakeExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod}) Vision: "${cell.text}"`);
      });
      console.log('\nAIRCRAFT IDENT Column:');
      aircraftIdentExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod}) Vision: "${cell.text}"`);
      });
      console.log('\nFROM-TO Column:');
      fromToExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod}) Vision: "${cell.text}"`);
      });
      console.log('\nTURBOJET Column:');
      turbojetExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (Full: ${cell.hasContentByPixels}, Sub1: ${cell.sub1HasContent}, Sub2: ${cell.sub2HasContent})`);
      });
      console.log('\nTURBOPROP Column:');
      turbopropExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nSINGLE-ENGINE LAND Column:');
      selExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nSINGLE-ENGINE SEA Column:');
      sesExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nMULTI-ENGINE LAND Column:');
      melExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      */
      console.log('\nROTORCRAFT HELICOPTER Column:');
      heliExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nGLIDER Column:');
      gliderExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('=======================================\n');

      // Set results for display
      setResult2({
        ocrData: {
          dateColumnIndex: 0,
          dateHeader: dateHeader,
          dateCells: dateExtractions,
          cellPresenceMap: cellPresenceMap,
          croppedColumnUri: dateResult.croppedColumnUri,
          columnBbox: dateResult.columnBbox,
          columnOCRResult: {
            tablesCount: dateResult.ocrResult.tablesCount || 0,
            rowCount: dateResult.ocrResult.rowCount || 0,
            columnCount: dateResult.ocrResult.columnCount || 0,
            cellConfidencesCount: 0,
            rawText: dateResult.ocrResult.rawText || '',
          },
          // Add AIRCRAFT MAKE column data
          aircraftMakeCells: aircraftMakeExtractions,
          croppedAircraftMakeColumnUri: aircraftMakeResult.croppedColumnUri,
          aircraftMakeColumnBbox: aircraftMakeResult.columnBbox,
          aircraftMakeOCRResult: aircraftMakeResult.ocrResult,
          // Add AIRCRAFT IDENT column data
          aircraftIdentCells: aircraftIdentExtractions,
          croppedAircraftIdentColumnUri: aircraftIdentResult.croppedColumnUri,
          aircraftIdentColumnBbox: aircraftIdentResult.columnBbox,
          aircraftIdentOCRResult: aircraftIdentResult.ocrResult,
          // Add FROM-TO column data
          fromToCells: fromToExtractions,
          croppedFromToColumnUri: fromToResult.croppedColumnUri,
          fromToColumnBbox: fromToResult.columnBbox,
          fromToOCRResult: fromToResult.ocrResult,
          // Add TURBOJET column data
          turbojetCells: turbojetExtractions,
          croppedTurbojetColumnUri: turbojetResult.croppedColumnUri,
          turbojetColumnBbox: turbojetResult.columnBbox,
          turbojetOCRResult: turbojetResult.ocrResult,
          // Add TURBOPROP column data
          turbopropCells: turbopropExtractions,
          croppedTurbopropColumnUri: turbopropResult.croppedColumnUri,
          turbopropColumnBbox: turbopropResult.columnBbox,
          turbopropOCRResult: turbopropResult.ocrResult,
          // Add TOTAL DURATION column data
          totalCells: totalExtractions,
          croppedTOTALColumnUri: totalResult.croppedColumnUri,
          totalColumnBbox: totalResult.columnBbox,
          totalOCRResult: totalResult.ocrResult,
          // Add SINGLE-ENGINE LAND column data
          selCells: selExtractions,
          croppedSELColumnUri: selResult.croppedColumnUri,
          selColumnBbox: selResult.columnBbox,
          selOCRResult: selResult.ocrResult,
          // Add SINGLE-ENGINE SEA column data
          sesCells: sesExtractions,
          croppedSESColumnUri: sesResult.croppedColumnUri,
          sesColumnBbox: sesResult.columnBbox,
          sesOCRResult: sesResult.ocrResult,
          // Add MULTI-ENGINE LAND column data
          melCells: melExtractions,
          croppedMELColumnUri: melResult.croppedColumnUri,
          melColumnBbox: melResult.columnBbox,
          melOCRResult: melResult.ocrResult,
          // Add ROTORCRAFT HELICOPTER column data
          heliCells: heliExtractions,
          croppedHELIColumnUri: heliResult.croppedColumnUri,
          heliColumnBbox: heliResult.columnBbox,
          heliOCRResult: heliResult.ocrResult,
          // Add GLIDER column data
          gliderCells: gliderExtractions,
          croppedGLIDERColumnUri: gliderResult.croppedColumnUri,
          gliderColumnBbox: gliderResult.columnBbox,
          gliderOCRResult: gliderResult.ocrResult,
        },
        extractedFlights: dateExtractions,
        cellPresenceMap: cellPresenceMap,
        turbojetPresenceMap: turbojetExtractions.map((c: any) => ({
          row: c.row,
          hasContent: c.hasContent,
          detectionMethod: c.detectionMethod,
          visionText: c.visionText,
          sub1HasContent: c.sub1HasContent,
          sub2HasContent: c.sub2HasContent,
        })),
        turbopropPresenceMap: turbopropExtractions.map((c: any) => ({
          row: c.row,
          hasContent: c.hasContent,
          detectionMethod: c.detectionMethod,
          visionText: c.visionText,
          sub1HasContent: c.sub1HasContent,
          sub2HasContent: c.sub2HasContent,
        })),
        selPresenceMap: selExtractions.map((c: any) => ({
          row: c.row,
          hasContent: c.hasContent,
          detectionMethod: c.detectionMethod,
          visionText: c.visionText,
          sub1HasContent: c.sub1HasContent,
          sub2HasContent: c.sub2HasContent,
        })),
        rawLLMOutput: 
          `DATE Column:\n` +
          cellPresenceMap.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''} ${c.llmColumnValue ? `LLM: "${c.llmColumnValue}"` : ''}`
          ).join('\n') +
          `\n\nAIRCRAFT MAKE Column:\n` +
          aircraftMakeExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.text ? `Vision: "${c.text}"` : ''} ${c.llmColumnValue ? `LLM: "${c.llmColumnValue}"` : ''}`
          ).join('\n') +
          `\n\nAIRCRAFT IDENT Column:\n` +
          aircraftIdentExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.text ? `Vision: "${c.text}"` : ''} ${c.llmColumnValue ? `LLM: "${c.llmColumnValue}"` : ''}`
          ).join('\n') +
          `\n\nFROM-TO Column:\n` +
          fromToExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.text ? `Vision: "${c.text}"` : ''} ${c.llmColumnValue ? `LLM: "${c.llmColumnValue}"` : ''}`
          ).join('\n') +
          `\n\nTURBOJET Column:\n` +
          turbojetExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''} ${c.llmColumnValue ? `LLM: "${c.llmColumnValue}"` : ''}`
          ).join('\n') +
          `\n\nTURBOPROP Column:\n` +
          turbopropExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''} ${c.llmColumnValue ? `LLM: "${c.llmColumnValue}"` : ''}`
          ).join('\n') +
          `\n\nSINGLE-ENGINE LAND Column:\n` +
          selExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''} ${c.llmColumnValue ? `LLM: "${c.llmColumnValue}"` : ''}`
          ).join('\n'),
        csv: 'Row,Date,Aircraft_Make_Model,Aircraft_Ident,From_To,Total_Duration,Single_Engine_Land,Single_Engine_Sea,Multi_Engine_Land,Turbojet,Turboprop,Rotorcraft_Helicopter,Glider\n' + 
          dateExtractions.map((d: any, idx: number) => {
            const make = aircraftMakeExtractions[idx];
            const ident = aircraftIdentExtractions[idx];
            const fromTo = fromToExtractions[idx];
            const total = totalExtractions[idx];
            const sel = selExtractions[idx];
            const ses = sesExtractions[idx];
            const mel = melExtractions[idx];
            const tj = turbojetExtractions[idx];
            const tp = turbopropExtractions[idx];
            const heli = heliExtractions[idx];
            const glider = gliderExtractions[idx];
            
            // Helper function to get FINAL value (LLM column result if available, otherwise Vision/text)
            const getFinalValue = (cell: any) => {
              if (!cell.hasContent) return '';
              // For columns with per-cell LLM, prefer per-cell over column
              if (cell.llmPerCellValue !== undefined && cell.llmPerCellValue !== null) {
                return cell.llmPerCellValue;
              }
              // For duration columns, prefer LLM column result
              if (cell.llmColumnValue !== undefined && cell.llmColumnValue !== null) {
                return cell.llmColumnValue;
              }
              // For text columns, use Vision text
              const text = cell.text || cell.visionText || '';
              return text.trim();
            };
            
            return `${d.row},` +
              `"${getFinalValue(d)}",` +
              `"${getFinalValue(make)}",` +
              `"${getFinalValue(ident)}",` +
              `"${getFinalValue(fromTo)}",` +
              `"${getFinalValue(total)}",` +
              `"${getFinalValue(sel)}",` +
              `"${getFinalValue(ses)}",` +
              `"${getFinalValue(mel)}",` +
              `"${getFinalValue(tj)}",` +
              `"${getFinalValue(tp)}",` +
              `"${getFinalValue(heli)}",` +
              `"${getFinalValue(glider)}"`;
          }).join('\n'),
      });

      // Return immediately - we have what we need
      return;
    } catch (error: any) {
      console.error('[Process] ERROR:', error);
      Alert.alert('Error', error.message);
      setStatus('Error occurred');
    } finally {
      setIsProcessing(false);
      processingRef.current = false;
      setBackgroundWarning(false);
    }
  };

  const parseModelOutput = (text: string): any[] => {
    try {
      // Remove markdown code fences if present
      let cleanedText = text.trim();
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '');
      }
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```\s*/, '');
      }
      if (cleanedText.endsWith('```')) {
        cleanedText = cleanedText.replace(/\s*```$/, '');
      }

      const jsonMatch = cleanedText.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
    return [];
  };

  const shareResults = async () => {
    if (!result2 || !result2.csv) return;

    try {
      const file = new File(Paths.cache, `flight-log-${Date.now()}.csv`);
      await file.write(result2.csv);
      await Sharing.shareAsync(file.uri);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const shareDetailedResults = async () => {
    if (!result2) return;

    try {
      // Create comprehensive report
      let report = '========== DATE COLUMN EXTRACTION REPORT ==========\n\n';

      report += '=== SUMMARY ===\n';
      report += `Extraction Date: ${new Date().toLocaleString()}\n`;
      report += `Date Cells Extracted: ${result2.extractedFlights.length}\n\n`;

      report += '=== DATE CELLS ===\n';
      result2.ocrData.dateCells.forEach((cell: any, idx: number) => {
        report += `${idx + 1}. Row ${cell.row}: "${cell.text}"\n`;
        report += `   Bbox: (${cell.boundingBox.x}, ${cell.boundingBox.y}, ${cell.boundingBox.width}, ${cell.boundingBox.height})\n`;
        if (cell.croppedImageUri) {
          report += `   Image: ${cell.croppedImageUri}\n`;
        }
        if (cell.error) {
          report += `   Error: ${cell.error}\n`;
        }
      });
      report += '\n';

      report += '=== DATE CELLS (JSON) ===\n';
      report += JSON.stringify(result2.ocrData.dateCells, null, 2) + '\n\n';

      report += '=== CSV FORMAT ===\n';
      report += result2.csv + '\n\n';

      report += '========== END REPORT ==========\n';

      // Save to file and share
      const file = new File(Paths.cache, `date-column-${Date.now()}.txt`);
      await file.write(report);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        dialogTitle: 'Share DATE Column Report',
      });
    } catch (error: any) {
      console.error('[Share] Error:', error);
      Alert.alert('Error', error.message);
    }
  };

  const convertToCSV = (flights: any[]): string => {
    const headers = [
      'DATE',
      'AIRCRAFT',
      'IDENT',
      'ROUTE',
      'TOTAL',
      'SEL',
      'SES',
      'MEL',
      'TURBOJET',
      'HELI',
      'GLIDER',
      'TURBOPROP',
      'CUSTOM3',
      'DAY_LDG',
      'NIGHT_LDG',
      'NIGHT',
      'INST',
      'SIM_INST',
      'APPROACHES',
      'APP_TYPE',
      'FLIGHT_SIM',
      'XC',
      'SOLO',
      'PIC',
      'SIC',
      'DUAL',
      'CFI',
      'REMARKS',
    ];

    let csv = headers.join(',') + '\n';

    flights.forEach((flight) => {
      const row = headers.map((h) => {
        const key = h.toLowerCase().replace(/_/g, '');
        // Handle nested structure with reasoning (e.g., {value: "...", confidence: 0.9, reasoning: "..."})
        const fieldData = flight[key];
        if (
          fieldData &&
          typeof fieldData === 'object' &&
          'value' in fieldData
        ) {
          // Extract value from nested structure
          const val = fieldData.value;
          // Escape commas and quotes in CSV
          if (
            typeof val === 'string' &&
            (val.includes(',') || val.includes('"'))
          ) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val ?? '';
        }
        // Handle simple value
        const val = fieldData;
        if (
          typeof val === 'string' &&
          (val.includes(',') || val.includes('"'))
        ) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val ?? '';
      });
      csv += row.join(',') + '\n';
    });

    return csv;
  };

  const convertExtractedDataToCSV = (ocrData: any): string => {
    // Helper function to parse duration from two sub-columns into decimal format
    const parseDuration = (cell: any, rowNum: number, columnName: string): string => {
      if (!cell || !cell.hasContent) {
        return '';
      }

      // Try to parse the vision text if available
      let text = cell.visionText || cell.text || '';
      
      console.log(`[CSV] Row ${rowNum} ${columnName}: visionText="${cell.visionText}", text="${cell.text}"`);
      
      if (text.trim()) {
        // Remove common OCR artifacts
        text = text.replace(/[|\s]/g, '');
        
        // Check if it's already in decimal format (e.g., "2.8", "4.2")
        if (/^\d+\.\d+$/.test(text)) {
          console.log(`  -> Already decimal: ${text}`);
          return text;
        }
        
        // Check if it's a single digit (could be hours or tenths)
        if (/^\d$/.test(text)) {
          // Single digit - need to determine if it's hours or tenths
          // For now, assume it's hours if >= 1, tenths if 0
          const digit = parseInt(text);
          if (digit === 0) {
            console.log(`  -> Single digit 0: 0.0`);
            return '0.0';
          } else {
            console.log(`  -> Single digit ${digit}: ${digit}.0`);
            return `${digit}.0`;
          }
        }
        
        // Check if it's two digits without separator (e.g., "28" = 2.8)
        if (/^\d{2}$/.test(text)) {
          const hours = text[0];
          const tenths = text[1];
          const result = `${hours}.${tenths}`;
          console.log(`  -> Two digits: ${text} = ${result}`);
          return result;
        }
        
        // Try to extract hours and tenths from various formats
        // Format: "2 8", "2|8", "28", etc.
        const match = text.match(/(\d+)[^\d]*(\d+)/);
        if (match) {
          const hours = match[1];
          const tenths = match[2];
          const result = `${hours}.${tenths}`;
          console.log(`  -> Parsed: ${text} = ${result}`);
          return result;
        }
        
        console.log(`  -> Could not parse: "${text}"`);
      }
      
      // Cell has content but no parseable OCR - use default
      console.log(`  -> Using default: 0.0`);
      return '0.0';
    };

    // Helper function to get value with defaults
    const getValue = (cell: any, columnType: string): string => {
      // If cell has no content, return empty string
      if (!cell || !cell.hasContent) {
        return '';
      }
      
      // If we have OCR text, use it
      if (cell.text && cell.text.trim()) {
        return cell.text.trim();
      }
      
      if (cell.visionText && cell.visionText.trim()) {
        return cell.visionText.trim();
      }
      
      // Cell has content but no OCR - use defaults
      switch (columnType) {
        case 'DATE':
          return '1/1';
        case 'AIRCRAFT_MAKE':
          return 'MODEL';
        case 'AIRCRAFT_IDENT':
          return 'IDENT';
        case 'FROM_TO':
          return 'FROM-TO';
        case 'DURATION':
          return '0.0';
        default:
          return '';
      }
    };

    const headers = [
      'Row',
      'Date',
      'Aircraft_Make_Model',
      'Aircraft_Ident',
      'From_To',
      'Total_Duration',
      'Single_Engine_Land',
      'Single_Engine_Sea',
      'Multi_Engine_Land',
      'Turbojet',
      'Turboprop',
      'Rotorcraft_Helicopter',
      'Glider',
    ];

    let csv = headers.join(',') + '\n';

    // Generate 14 rows
    for (let i = 0; i < 14; i++) {
      const rowNum = i + 1;
      
      const dateCell = ocrData.dateCells?.[i];
      const aircraftMakeCell = ocrData.aircraftMakeCells?.[i];
      const aircraftIdentCell = ocrData.aircraftIdentCells?.[i];
      const fromToCell = ocrData.fromToCells?.[i];
      const totalCell = ocrData.totalCells?.[i];
      const selCell = ocrData.selCells?.[i];
      const sesCell = ocrData.sesCells?.[i];
      const melCell = ocrData.melCells?.[i];
      const turbojetCell = ocrData.turbojetCells?.[i];
      const turbopropCell = ocrData.turbopropCells?.[i];
      const heliCell = ocrData.heliCells?.[i];
      const gliderCell = ocrData.gliderCells?.[i];

      const row = [
        rowNum,
        getValue(dateCell, 'DATE'),
        getValue(aircraftMakeCell, 'AIRCRAFT_MAKE'),
        getValue(aircraftIdentCell, 'AIRCRAFT_IDENT'),
        getValue(fromToCell, 'FROM_TO'),
        parseDuration(totalCell, rowNum, 'TOTAL DURATION'),
        parseDuration(selCell, rowNum, 'SINGLE-ENGINE LAND'),
        parseDuration(sesCell, rowNum, 'SINGLE-ENGINE SEA'),
        parseDuration(melCell, rowNum, 'MULTI-ENGINE LAND'),
        parseDuration(turbojetCell, rowNum, 'TURBOJET'),
        parseDuration(turbopropCell, rowNum, 'TURBOPROP'),
        parseDuration(heliCell, rowNum, 'ROTORCRAFT HELICOPTER'),
        parseDuration(gliderCell, rowNum, 'GLIDER'),
      ];

      csv += row.join(',') + '\n';
    }

    return csv;
  };

  const parseAndLogCSV = (flights: any[], promptLabel: string): string => {
    const csv = convertToCSV(flights);
    console.log(`========== CSV OUTPUT (${promptLabel}) ==========`);
    console.log(csv);
    console.log('==============================================\n');
    return csv;
  };

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Hybrid Flight Log Extractor</Text>
          <TouchableOpacity onPress={() => setShowModelPicker(true)}>
            <Text style={styles.settingsButton}>⚙️</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>Vision OCR + Qwen3-VL</Text>
        <Text style={styles.status}>{status}</Text>
      </View>

      {backgroundWarning && (
        <View style={styles.backgroundWarning}>
          <Text style={styles.backgroundWarningText}>
            ⚠️ App is in background. Processing may be slower or paused. Keep
            app in foreground for best performance.
          </Text>
        </View>
      )}

      {!modelReady && (
        <View style={styles.modelWarning}>
          <Text style={styles.warningText}>
            ⚠️ Model not loaded. Tap ⚙️ to download Qwen3-VL-2B model.
          </Text>
        </View>
      )}

      <View style={styles.imageSection}>
        <View style={styles.imageContainer}>
          <Text style={styles.imageLabel}>Left Page</Text>
          {leftImage ? (
            <Image source={{ uri: leftImage }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderText}>No image</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.button}
            onPress={() => pickImage('left')}
          >
            <Text style={styles.buttonText}>
              {leftImage ? 'Change' : 'Select'} Left
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.imageContainer}>
          <Text style={styles.imageLabel}>Right Page</Text>
          {rightImage ? (
            <Image source={{ uri: rightImage }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderText}>No image</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.button}
            onPress={() => pickImage('right')}
          >
            <Text style={styles.buttonText}>
              {rightImage ? 'Change' : 'Select'} Right
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {isProcessing && (
        <View style={styles.progressSection}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.progressText}>{Math.round(progress)}%</Text>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.processButton,
          (!leftImage || !rightImage || !modelReady || isProcessing) &&
            styles.buttonDisabled,
        ]}
        onPress={processImages}
        disabled={!leftImage || !rightImage || !modelReady || isProcessing}
      >
        <Text style={styles.processButtonText}>
          {isProcessing ? 'Processing...' : 'Extract Flight Data'}
        </Text>
      </TouchableOpacity>

      {(result || result2) && (
        <View style={styles.resultsSection}>
          <Text style={styles.resultsTitle}>Results</Text>

          <View style={styles.statsCard}>
            {result && (
              <>
                <Text style={styles.statsText}>
                  Prompt 1 (Current): {result.extractedFlights.length} flights
                </Text>
                <Text style={styles.statsText}>
                  OCR cells detected: {result.ocrData.metadata.totalCells}
                </Text>
              </>
            )}
            {result2 && (
              <Text style={styles.statsText}>
                {result ? 'Prompt 2 (Alternative)' : 'DATE Column'}: {result2.extractedFlights.length} cells
              </Text>
            )}
          </View>

          {result && (
            <>
              <Text style={styles.sectionTitle}>
                📋 Prompt 1: Current System Prompt
              </Text>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  Extracted Flights (first 3):
                </Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>
                    {JSON.stringify(result.extractedFlights, null, 2)}
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>Raw LLM Output:</Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>{result.rawLLMOutput}</Text>
                </ScrollView>
              </View>

              {result.csv && (
                <View style={styles.dataPreview}>
                  <Text style={styles.previewTitle}>
                    CSV Format (14 rows - Final Results):
                  </Text>
                  <ScrollView style={styles.previewScroll}>
                    <Text style={styles.previewText}>
                      {result.csv}
                    </Text>
                  </ScrollView>
                </View>
              )}
            </>
          )}

          {result2 && (
            <>
              <Text style={styles.sectionTitle}>
                📋 DATE Column Cells (14 Rows)
              </Text>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  Extracted Text Items ({result2.extractedFlights.length}):
                </Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>
                    {JSON.stringify(
                      result2.extractedFlights,
                      null,
                      2
                    )}
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>Raw LLM Output:</Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>{result2.rawLLMOutput}</Text>
                </ScrollView>
              </View>

              {result2.csv && (
                <View style={styles.dataPreview}>
                  <Text style={styles.previewTitle}>
                    CSV Format (14 rows - Final Results):
                  </Text>
                  <ScrollView style={styles.previewScroll}>
                    <Text style={styles.previewText}>
                      {result2.csv}
                    </Text>
                  </ScrollView>
                </View>
              )}

              {/* Display cropped DATE column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  DATE Column (cropped with grid lines):
                </Text>
                {result2.ocrData.croppedColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.columnOCRResult.rowCount} rows x {result2.ocrData.columnOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Tables: {result2.ocrData.columnOCRResult.tablesCount}, Cells: {result2.ocrData.columnOCRResult.cellConfidencesCount}
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped AIRCRAFT MAKE column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT MAKE AND MODEL Column:
                </Text>
                {result2.ocrData.croppedAircraftMakeColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedAircraftMakeColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.aircraftMakeOCRResult.rowCount} rows x {result2.ocrData.aircraftMakeOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.ocrData.aircraftMakeCells?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped AIRCRAFT IDENT column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT IDENT Column:
                </Text>
                {result2.ocrData.croppedAircraftIdentColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedAircraftIdentColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.aircraftIdentOCRResult.rowCount} rows x {result2.ocrData.aircraftIdentOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.ocrData.aircraftIdentCells?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped FROM-TO column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  FROM-TO Column:
                </Text>
                {result2.ocrData.croppedFromToColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedFromToColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.fromToOCRResult.rowCount} rows x {result2.ocrData.fromToOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.ocrData.fromToCells?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped TURBOJET column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOJET Column (2 sub-columns):
                </Text>
                {result2.ocrData.croppedTurbojetColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedTurbojetColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.turbojetOCRResult.rowCount} rows x {result2.ocrData.turbojetOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.turbojetPresenceMap?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display DATE cell images */}
              {SHOW_ALL_COLUMNS && (
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  DATE Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.dateCells.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {(cell.confidence * 100).toFixed(0)}%)
                          {'\n'}Pixels: {cell.hasContentByPixels ? '✓' : '✗'} ({cell.darkPixelPercentage?.toFixed(0) || 0}%)
                          {'\n'}Detection: {cell.matchedByPosition ? 'Vision' : (cell.hasContentByPixels ? 'Pixels' : 'None')}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox.x}, {cell.boundingBox.y}, {cell.boundingBox.width}, {cell.boundingBox.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              )}

              {/* Display AIRCRAFT MAKE cell images */}
              {SHOW_ALL_COLUMNS && (
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT MAKE AND MODEL Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.aircraftMakeCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {((cell.confidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Detection: {cell.detectionMethod}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              )}

              {/* Display AIRCRAFT IDENT cell images */}
              {SHOW_ALL_COLUMNS && (
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT IDENT Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.aircraftIdentCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {((cell.confidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Detection: {cell.detectionMethod}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              )}

              {/* Display FROM-TO cell images */}
              {SHOW_ALL_COLUMNS && (
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  FROM-TO Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.fromToCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {((cell.confidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Detection: {cell.detectionMethod}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              )}

              {/* Display TURBOJET cell images */}
              {SHOW_ALL_COLUMNS && (
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOJET Cell Images (14 cells, 2 sub-columns each):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.turbojetCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Detection: {cell.detectionMethod || 'None'}
                          {'\n'}Vision: "{cell.visionText || ''}" (conf: {((cell.visionConfidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Cell OCR: {cell.cellHasVisionText ? '✓' : '✗'}
                          {'\n'}Pixels: Full={cell.hasContentByPixels ? '✓' : '✗'} ({cell.fileSize}b), Sub1={cell.sub1HasContent ? '✓' : '✗'} ({cell.sub1FileSize}b), Sub2={cell.sub2HasContent ? '✓' : '✗'} ({cell.sub2FileSize}b)
                        </Text>
                        <Text style={styles.cellImageLabel}>Full Cell:</Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <View style={{flexDirection: 'row', gap: 5}}>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub1:</Text>
                            {cell.croppedSub1Uri && (
                              <Image
                                source={{ uri: cell.croppedSub1Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub2:</Text>
                            {cell.croppedSub2Uri && (
                              <Image
                                source={{ uri: cell.croppedSub2Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                        </View>
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              )}

              {/* Display cropped TURBOPROP column image */}
              {SHOW_TURBOPROP && (
              <>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOPROP Column (2 sub-columns):
                </Text>
                {result2.ocrData.croppedTurbopropColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedTurbopropColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.turbopropOCRResult.rowCount} rows x {result2.ocrData.turbopropOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.turbopropPresenceMap?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display TURBOPROP cell images */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOPROP Cell Images (14 cells, 2 sub-columns each):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.turbopropCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Detection: {cell.detectionMethod || 'None'}
                          {'\n'}Vision: "{cell.visionText || ''}" (conf: {((cell.visionConfidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Cell OCR: {cell.cellHasVisionText ? '✓' : '✗'}
                          {'\n'}Pixels: Full={cell.hasContentByPixels ? '✓' : '✗'} ({cell.fileSize}b), Sub1={cell.sub1HasContent ? '✓' : '✗'} ({cell.sub1FileSize}b), Sub2={cell.sub2HasContent ? '✓' : '✗'} ({cell.sub2FileSize}b)
                        </Text>
                        <Text style={styles.cellImageLabel}>Full Cell:</Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <View style={{flexDirection: 'row', gap: 5}}>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub1:</Text>
                            {cell.croppedSub1Uri && (
                              <Image
                                source={{ uri: cell.croppedSub1Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub2:</Text>
                            {cell.croppedSub2Uri && (
                              <Image
                                source={{ uri: cell.croppedSub2Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                        </View>
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              </>
              )}

              {/* Display TOTAL DURATION column and cells */}
              {SHOW_TOTAL_DURATION && (
              <>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>TOTAL DURATION Column:</Text>
                {result2.ocrData.croppedTOTALColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedTOTALColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.totalCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>TOTAL DURATION Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.totalCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        <Text style={styles.cellImageVision}>Vision: "{cell.visionText || ''}"</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              </>
              )}

              {/* Display SINGLE-ENGINE LAND column and cells */}
              {SHOW_ALL_COLUMNS && (
              <>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE LAND Column:</Text>
                {result2.ocrData.croppedSELColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedSELColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.selCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE LAND Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.selCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display SINGLE-ENGINE SEA column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE SEA Column:</Text>
                {result2.ocrData.croppedSESColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedSESColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.sesCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE SEA Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.sesCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display MULTI-ENGINE LAND column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>MULTI-ENGINE LAND Column:</Text>
                {result2.ocrData.croppedMELColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedMELColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.melCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>MULTI-ENGINE LAND Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.melCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display ROTORCRAFT HELICOPTER column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>ROTORCRAFT HELICOPTER Column:</Text>
                {result2.ocrData.croppedHELIColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedHELIColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.heliCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>ROTORCRAFT HELICOPTER Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.heliCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display GLIDER column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>GLIDER Column:</Text>
                {result2.ocrData.croppedGLIDERColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedGLIDERColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.gliderCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>GLIDER Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.gliderCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              </>
              )}

              <View style={styles.shareButtonsRow}>
                <TouchableOpacity
                  style={[styles.shareButton, styles.shareButtonHalf]}
                  onPress={shareResults}
                >
                  <Text style={styles.shareButtonText}>📤 CSV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.shareButton, styles.shareButtonHalf]}
                  onPress={shareDetailedResults}
                >
                  <Text style={styles.shareButtonText}>📋 Full Report</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* Model Picker Modal */}
      <Modal visible={showModelPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Model</Text>

            {MODELS.map((model) => {
              const isDownloaded = downloadedModels.includes(model.id);
              const isSelected = selectedModel?.id === model.id;
              const isCurrentlyDownloading = isDownloading && !isDownloaded;

              return (
                <View
                  key={model.id}
                  style={[
                    styles.modelOption,
                    isSelected && styles.modelOptionSelected,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.modelOptionMain}
                    onPress={async () => {
                      if (isCurrentlyDownloading) return;
                      setShowModelPicker(false);
                      if (isDownloaded) {
                        await loadModel(model);
                      } else {
                        await downloadModel(model);
                      }
                    }}
                  >
                    <View style={styles.modelInfo}>
                      <Text style={styles.modelName}>{model.name}</Text>
                      <Text style={styles.modelSize}>{model.size}</Text>
                    </View>
                    <Text style={styles.modelStatus}>
                      {isCurrentlyDownloading
                        ? `Downloading... ${Math.round(downloadProgress * 100)}%`
                        : isSelected
                          ? '✓ Active'
                          : isDownloaded
                            ? 'Downloaded'
                            : 'Tap to download'}
                    </Text>
                  </TouchableOpacity>
                  {isDownloaded && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => {
                        setShowModelPicker(false);
                        deleteModel(model);
                      }}
                    >
                      <Text style={styles.deleteButtonText}>🗑️</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowModelPicker(false)}
            >
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#2a2a2a',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  settingsButton: {
    fontSize: 28,
    color: 'white',
  },
  subtitle: {
    fontSize: 14,
    color: '#4CAF50',
    marginBottom: 8,
  },
  status: {
    fontSize: 12,
    color: '#999',
  },
  modelWarning: {
    margin: 20,
    padding: 16,
    backgroundColor: '#ff9800',
    borderRadius: 8,
  },
  warningText: {
    color: 'white',
    fontSize: 14,
  },
  backgroundWarning: {
    margin: 20,
    marginTop: 0,
    padding: 16,
    backgroundColor: '#FF5722',
    borderRadius: 8,
  },
  backgroundWarningText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  imageSection: {
    flexDirection: 'row',
    padding: 20,
    gap: 16,
  },
  imageContainer: {
    flex: 1,
  },
  imageLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#333',
    marginBottom: 12,
  },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#555',
    borderStyle: 'dashed',
  },
  placeholderText: {
    color: '#666',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  progressSection: {
    padding: 20,
    alignItems: 'center',
  },
  progressText: {
    color: 'white',
    fontSize: 18,
    marginTop: 12,
  },
  processButton: {
    margin: 20,
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#666',
  },
  processButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resultsSection: {
    padding: 20,
  },
  resultsTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF9800',
    marginTop: 20,
    marginBottom: 12,
  },
  statsCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  statsText: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 6,
  },
  dataPreview: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  previewTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  previewScroll: {
    maxHeight: 200,
  },
  previewText: {
    color: '#ccc',
    fontFamily: 'Courier',
    fontSize: 11,
  },
  columnImage: {
    width: '100%',
    height: 400,
    backgroundColor: '#000',
    borderRadius: 4,
    marginVertical: 8,
  },
  shareButton: {
    backgroundColor: '#FF9800',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  shareButtonHalf: {
    flex: 1,
  },
  shareButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cellImagesScroll: {
    maxHeight: 400,
  },
  cellImagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  cellImageContainer: {
    width: '48%',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  cellImageLabel: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  cellImageVision: {
    color: '#2196F3',
    fontSize: 10,
    fontFamily: 'Courier',
    marginBottom: 4,
  },
  cellImage: {
    width: '100%',
    height: 60,
    backgroundColor: '#000',
    borderRadius: 4,
    marginBottom: 4,
  },
  cellImageBbox: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'Courier',
  },
  cellImageError: {
    color: '#f44336',
    fontSize: 10,
    fontStyle: 'italic',
    padding: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
    textAlign: 'center',
  },
  modelOption: {
    flexDirection: 'row',
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  modelOptionSelected: {
    backgroundColor: '#4CAF50',
  },
  modelOptionMain: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  modelSize: {
    color: '#999',
    fontSize: 12,
  },
  modelStatus: {
    color: '#ccc',
    fontSize: 12,
    marginLeft: 12,
  },
  deleteButton: {
    backgroundColor: '#d32f2f',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  deleteButtonText: {
    fontSize: 20,
  },
  modalCloseButton: {
    backgroundColor: '#555',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCloseButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
