# Raw LLM JSON Output Display

## Overview

When using the Foundation Models integration (`processTableWithLLM`), the system now returns the **raw JSON response** from the LLM before it's converted to CSV format. This allows you to see exactly what the LLM extracted and how it structured the data.

## What's Included

The `rawLLMResponse` field contains:

```typescript
{
  leftTable: {
    rowCount: number;
    columnCount: number;
    headers: string[];
    cells: Array<{
      value: string;
      row: number;
      column: number;
      confidence: number;
    }>;
  },
  rightTable: {
    rowCount: number;
    columnCount: number;
    headers: string[];
    cells: Array<{
      value: string;
      row: number;
      column: number;
      confidence: number;
    }>;
  },
  calculations: {
    totalHours: number;
    totalNight: number;
    totalCrossCountry: number;
    totalPIC: number;
    totalDual: number;
    dayLandings: number;
    nightLandings: number;
  }
}
```

## Where It Appears

### 1. Console Log
```javascript
console.log('Raw LLM Response:', JSON.stringify(result.rawLLMResponse, null, 2));
```

### 2. App UI Display
A new **"Raw LLM JSON Response"** section appears below the CSV preview with:
- Dark theme for better JSON readability
- Syntax highlighting colors
- Scrollable view (max 300px height)
- Monospace font for proper alignment

### 3. TypeScript Interface
```typescript
import { processTableWithLLM, type EnhancedTableResult } from 'react-native-vision-camera-ocr';

const result: EnhancedTableResult = await processTableWithLLM(
  leftUri,
  rightUri,
  promptContext
);

// Access raw LLM response
console.log(result.rawLLMResponse.leftTable.cells);
console.log(result.rawLLMResponse.calculations.totalHours);
```

## Example Output

```json
{
  "leftTable": {
    "rowCount": 14,
    "columnCount": 15,
    "headers": [
      "DATE",
      "AIRCRAFT MAKE AND MODEL",
      "AIRCRAFT IDENT",
      "FROM",
      "TO",
      "TOTAL DURATION OF FLIGHT",
      "AIRPLANE SINGLE-ENGINE LAND",
      "AIRPLANE SINGLE-ENGINE SEA",
      "AIRPLANE MULTI-ENGINE LAND",
      "TURBOJET",
      "ROTORCRAFT HELICOPTER",
      "GLIDER",
      "TURBOPROP",
      "LANDINGS DAY",
      "LANDINGS NIGHT"
    ],
    "cells": [
      {
        "value": "09-10-1996",
        "row": 0,
        "column": 0,
        "confidence": 0.95
      },
      {
        "value": "BE-200",
        "row": 0,
        "column": 1,
        "confidence": 0.92
      },
      {
        "value": "N308AJ",
        "row": 0,
        "column": 2,
        "confidence": 0.98
      }
      // ... more cells
    ]
  },
  "rightTable": {
    "rowCount": 14,
    "columnCount": 12,
    "headers": [
      "NIGHT",
      "ACTUAL INSTRUMENT",
      "SIMULATED INSTRUMENT (HOOD)",
      "APP NO. TYPE",
      "FLIGHT SIMULATOR",
      "CROSS COUNTRY",
      "SOLO",
      "PILOT IN COMMAND",
      "SECOND IN COMMAND",
      "DUAL RECEIVED",
      "AS FLIGHT INSTRUCTOR",
      "REMARKS AND ENDORSEMENTS"
    ],
    "cells": [
      {
        "value": "",
        "row": 0,
        "column": 0,
        "confidence": 0.0
      },
      {
        "value": "2.8",
        "row": 0,
        "column": 7,
        "confidence": 0.89
      }
      // ... more cells
    ]
  },
  "calculations": {
    "totalHours": 48.5,
    "totalNight": 3.2,
    "totalCrossCountry": 42.1,
    "totalPIC": 45.3,
    "totalDual": 0.0,
    "dayLandings": 18,
    "nightLandings": 2
  }
}
```

## Benefits

### 1. Debugging
- See exactly what the LLM extracted from each cell
- Verify row/column positions
- Check confidence scores
- Identify OCR errors that the LLM corrected

### 2. Validation
- Compare LLM output against expected structure
- Verify calculations are correct
- Check that headers match your prompt
- Ensure row counts align between left and right pages

### 3. Integration
- Use structured data directly in your app
- Access individual cells programmatically
- Build custom visualizations
- Export to different formats

### 4. Analysis
- See which cells have low confidence
- Identify patterns in OCR errors
- Understand how the LLM grouped text into cells
- Verify spatial understanding

## Usage Example

```typescript
import { processTableWithLLM } from 'react-native-vision-camera-ocr';

const result = await processTableWithLLM(
  'file:///path/to/left.jpg',
  'file:///path/to/right.jpg',
  flightLogPrompt
);

// Access structured data
const dateCell = result.rawLLMResponse.leftTable.cells.find(
  cell => cell.row === 0 && cell.column === 0
);
console.log('First date:', dateCell?.value);

// Access calculations
console.log('Total hours:', result.rawLLMResponse.calculations.totalHours);

// Iterate through all cells
result.rawLLMResponse.leftTable.cells.forEach(cell => {
  if (cell.confidence < 0.8) {
    console.warn(`Low confidence cell at [${cell.row},${cell.column}]: "${cell.value}"`);
  }
});

// Get specific column data
const aircraftColumn = result.rawLLMResponse.leftTable.cells.filter(
  cell => cell.column === 1 // AIRCRAFT MAKE AND MODEL
);
console.log('All aircraft:', aircraftColumn.map(c => c.value));
```

## Comparison: OCR vs LLM

### DualImageRecognizer (OCR Only)
```typescript
const ocrResult = await DualImageRecognizer({
  leftUri: leftImage,
  rightUri: rightImage
});

// Returns:
// - csv: Combined CSV with metadata
// - cellData: All cells with bounding boxes
// - leftTable/rightTable: Column structure
// - dateColumn: Extracted date column
// - rectangles: Detected table boundaries
// - metadata: Row/column counts
```

### processTableWithLLM (OCR + LLM)
```typescript
const llmResult = await processTableWithLLM(
  leftImage,
  rightImage,
  promptContext
);

// Returns:
// - csv: Enhanced CSV with LLM corrections
// - leftTable/rightTable: Structured cell data
// - calculations: Computed totals
// - metadata: Row/column counts
// - rawLLMResponse: Complete LLM JSON output ← NEW!
```

## Display Styling

The raw JSON is displayed with:
- **Dark background** (#1e1e1e) for reduced eye strain
- **Green title** (#4CAF50) for visual distinction
- **Light gray text** (#d4d4d4) for readability
- **Monospace font** (Courier) for proper alignment
- **Scrollable view** (300px max height)
- **Compact line height** (16px) for dense data

## Console Output

The raw JSON is also logged to console with formatting:

```javascript
=== LLM EXTRACTION COMPLETE ===
CSV: [csv content]
Raw LLM Response: {
  "leftTable": {
    "rowCount": 14,
    "columnCount": 15,
    ...
  },
  ...
}
Total hours: 48.5
Rows extracted: 14
```

## See Also

- [Foundation Models Integration](./FOUNDATION_MODELS_INTEGRATION.md)
- [Enhanced Table Extraction](./ENHANCED_TABLE_EXTRACTION.md)
- [Flight Log Prompt](./FLIGHT_LOG_PROMPT.md)
- [Quick Start LLM](./QUICK_START_LLM.md)
