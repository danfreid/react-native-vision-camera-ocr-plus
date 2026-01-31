# Flight Log Extraction Prompt

This document contains the optimized LLM prompt for extracting flight log data from dual-page spreads using Apple's Foundation Models framework.

## Overview

The prompt is designed for extracting data from pilot logbooks with:
- **Left page**: Aircraft information and flight durations
- **Right page**: Flight conditions and piloting time
- **Dual-page layout**: Two facing pages in landscape orientation

## Key Features

### Critical Instructions

1. **Row Alignment**: Count physical grid lines from header independently for EVERY column
2. **Column Identification**: Read columns RIGHT TO LEFT to avoid confusion
3. **Decimal Format**: Two sub-columns (hours|tenths) - single digit in tenths = 0.X
4. **OCR Error Handling**: Standardize common misreads (LB25→LR25, BEZAY→BE-200, etc.)
5. **Validation**: PIC + SIC + Dual + Instructor + Solo MUST equal Total Duration

### Column Structure

**Left Page (15 columns):**
1. DATE
2. AIRCRAFT MAKE AND MODEL
3. AIRCRAFT IDENT
4. FROM
5. TO
6. TOTAL DURATION OF FLIGHT
7. AIRPLANE SINGLE-ENGINE LAND
8. AIRPLANE SINGLE-ENGINE SEA
9. AIRPLANE MULTI-ENGINE LAND
10. NEBASET (Turbojet)
11. ROTORCRAFT HELICOPTER
12. GLIDER
13. TURBOPROP
14. LANDINGS DAY
15. LANDINGS NIGHT

**Right Page (12 columns):**
1. NIGHT FLIGHT
2. ACTUAL INSTRUMENT
3. SIMULATED INSTRUMENT (HOOD)
4. APP NO. TYPE (combined)
5. FLIGHT SIMULATOR
6. CROSS COUNTRY
7. SOLO
8. PILOT IN COMMAND
9. SECOND IN COMMAND
10. DUAL RECEIVED
11. AS FLIGHT INSTRUCTOR
12. REMARKS AND ENDORSEMENTS

## Full Prompt Structure

See `flight-log-extractor/prompt.txt` for the complete JSON prompt with detailed instructions for each field.

## Usage with DocumentRecognizerWithLLM

```typescript
import { initializeLLM, processTableWithLLM } from 'react-native-vision-camera-ocr';

// Initialize the LLM (iOS 26+ only)
await initializeLLM();

// Load your prompt
const prompt = require('./prompt.json');

// Process dual images with LLM
const result = await processTableWithLLM({
  leftUri: 'file:///path/to/left.jpg',
  rightUri: 'file:///path/to/right.jpg',
  prompt: JSON.stringify(prompt),
  temperature: 0.1, // Low temperature for consistent extraction
});

console.log('Extracted data:', result.extractedData);
console.log('Confidence:', result.confidence);
```

## Common OCR Challenges Addressed

### Aircraft Type Standardization
- `LB25/LA25/LR-25` → `LR25`
- `BEZAY/BENZOO/BE-Z-O/8E-200/BE-210` → `BE-200`
- `IAILY/IAI24/IAIZ4/IAI124` → `IA1124`
- `DAZO-AI/DA20-AI` → `DA20-A1`

### Character Confusion
- `0/O` (zero vs letter O)
- `8/B` (eight vs letter B)
- `Q/0` (letter Q vs zero)
- `∅/Ø/ø/⌀` (slashed zero = 0)

### Decimal Format
- `2|8` = `2.8` (hours|tenths)
- `|6` = `0.6` (empty hours, 6 tenths)
- `9|` = `0.9` (9 hours, empty tenths)
- `2|∅` = `2.0` (slashed zero = 0)

### Date Format
- `9/10` = September 10 (NOT August)
- Year from header: `YEAR 96` = `1996`
- Output format: `MM-DD-YYYY`

### Column Positioning
- **Landings**: Two narrow sub-columns (DAY left, NIGHT right)
- **App No. vs App Type**: Narrow columns with single digits vs letter codes
- **PIC vs SIC**: Count from right edge to avoid confusion

## Validation Rules

1. **Total Duration Match**: Sum of aircraft type columns should equal Total Duration
2. **Piloting Time Match**: PIC + SIC + Dual + Instructor + Solo = Total Duration
3. **Row Alignment**: Same number of rows on left and right pages
4. **Empty Cells**: Return empty string, not zero or null
5. **Summary Rows**: Exclude "TOTALS THIS PAGE", "AMT. FORWARDED", "TOTALS TO DATE"

## Tips for Best Results

1. **High-quality images**: 300+ DPI, good lighting, minimal skew
2. **Low temperature**: Use 0.1-0.3 for consistent extraction
3. **Validate output**: Check that totals match across columns
4. **Handle ditto marks**: Extract `"` as-is, don't copy previous row
5. **Multi-leg routes**: Combine with hyphens (e.g., `HOU-IAH-TYR-HOU`)

## Example Output

```json
{
  "Year": "1996",
  "Aircraft Info and Durations": [
    {
      "Row #": 1,
      "Date": "09-10-1996",
      "Aircraft Make and Model": "BE-200",
      "Aircraft Identifier": "N308AJ",
      "From-To": "HOU-GLS-HOU",
      "Total Duration of Flight": "2.8",
      "Single-Engine Land": "",
      "Single-Engine Sea": "",
      "Multi-Engine Land": "2.8",
      "Turbojet": "",
      "Rotorcraft helicopter": "",
      "Glider": "",
      "Turboprop": "2.8",
      "Landings Day": "2",
      "Landings Night": ""
    }
  ],
  "Conditions and Piloting": [
    {
      "Row #": 1,
      "Night Flight": "",
      "Actual Instrument": "",
      "Simulated Instrument Hood": "",
      "App No.": "3",
      "App Type": "ILS",
      "Flight Simulator": "",
      "Cross Country": "2.8",
      "Solo": "",
      "Pilot in Command": "2.8",
      "Second in Command": "",
      "Dual Received": "",
      "As Flight Instructor": "",
      "Remarks and endorsements": "91-135-91"
    }
  ],
  "Signature": true
}
```

## Integration with Vision Camera OCR

This prompt is designed to work with the comprehensive data output from `DualImageRecognizer`:

```typescript
// First get OCR data with bounding boxes
const ocrResult = await DualImageRecognizer({
  leftUri: leftImage,
  rightUri: rightImage
});

// Then enhance with LLM extraction
const llmResult = await processTableWithLLM({
  leftUri: leftImage,
  rightUri: rightImage,
  prompt: JSON.stringify(flightLogPrompt),
  temperature: 0.1
});

// Combine for complete analysis
const completeData = {
  ocr: ocrResult,        // Raw OCR with bounding boxes
  extracted: llmResult,  // Structured LLM extraction
  csv: ocrResult.csv,    // Combined CSV
};
```

## See Also

- [Foundation Models Integration](./FOUNDATION_MODELS_INTEGRATION.md)
- [Enhanced Table Extraction](./ENHANCED_TABLE_EXTRACTION.md)
- [Quick Start LLM](./QUICK_START_LLM.md)
- [Migration Guide](./MIGRATION_GUIDE.md)
