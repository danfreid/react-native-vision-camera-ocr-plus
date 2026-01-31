# Detailed Logging and Reasoning Feature

## What Was Added

### 1. Comprehensive Console Logging
The app now logs every step of the extraction process in detail:

#### Raw OCR Results
```
========== RAW OCR RESULTS ==========
LEFT PAGE:
{
  "columnCount": 15,
  "rowCount": 16,
  "columns": [...],
  ...
}

RIGHT PAGE:
{
  "columnCount": 12,
  "rowCount": 16,
  ...
}

LEFT CELL DATA (first 20):
[
  {"row": 0, "column": 0, "value": "DATE", "confidence": 0.98, ...},
  ...
]
=====================================
```

#### Formatted OCR for LLM
```
========== FORMATTED OCR FOR LLM ==========
LEFT PAGE STRUCTURE:
Columns (15): Col0: DATE, Col1: AIRCRAFT MAKE AND MODEL, ...
Rows: 16

CELL GRID (first 5 rows):
Row 1: 8/16 | LR25 | N208AJ | HOU-DFW | 2 | 8 | ...
===========================================
```

#### Full Prompt to LLM
```
========== FULL PROMPT TO LLM ==========
You are extracting flight log data from 2 facing pages...
[Complete prompt with all instructions and OCR data]
========================================
```

#### Raw LLM Output
```
========== RAW LLM OUTPUT ==========
[
  {
    "date": {"value": "08-16-2024", "confidence": 0.95, "reasoning": "OCR read '8/16' clearly"},
    ...
  }
]
====================================
```

#### Extracted Flight Entries
```
========== EXTRACTED FLIGHT ENTRIES ==========
[
  {
    "date": {"value": "08-16-2024", "confidence": 0.95, "reasoning": "..."},
    "aircraft": {"value": "LR25", "confidence": 0.9, "reasoning": "Corrected from LB25"},
    ...
  }
]
==============================================
```

### 2. Reasoning for Each Field

The LLM now provides for each extracted field:
- **value**: The extracted value
- **confidence**: Confidence level (0.0-1.0)
- **reasoning**: Why this value was chosen

Example:
```json
{
  "date": {
    "value": "08-16-2024",
    "confidence": 0.95,
    "reasoning": "OCR read '8/16' clearly in DATE column"
  },
  "aircraft": {
    "value": "LR25",
    "confidence": 0.9,
    "reasoning": "Corrected from 'LB25' per OCR error rules"
  },
  "totalDuration": {
    "value": 2.8,
    "confidence": 0.95,
    "reasoning": "OCR read '2|8' in two sub-columns, converted to 2.8"
  },
  "actualInstrument": {
    "value": 0.2,
    "confidence": 0.85,
    "reasoning": "OCR read '|2' (tenths only), converted to 0.2"
  },
  "mel": {
    "value": 0.0,
    "confidence": 1.0,
    "reasoning": "Empty cell at row 3, column 7"
  },
  "turbojet": {
    "value": 2.8,
    "confidence": 0.9,
    "reasoning": "LR25 is jet aircraft, matches total duration"
  },
  "turboprop": {
    "value": 0.0,
    "confidence": 1.0,
    "reasoning": "LR25 is turbojet not turboprop per rules"
  }
}
```

### 3. Two Share Options

#### Option 1: CSV Only (📤 CSV)
- Quick export for spreadsheet import
- Just the extracted data in CSV format
- Same as before

#### Option 2: Full Report (📋 Full Report)
Comprehensive text file containing:

```
========== FLIGHT LOG EXTRACTION REPORT ==========

=== SUMMARY ===
Extraction Date: 1/31/2026, 3:45:23 PM
Flights Extracted: 14
OCR Cells Detected: 336
Left Page Columns: 15
Right Page Columns: 12

=== RAW OCR RESULTS ===
LEFT PAGE STRUCTURE:
[Complete OCR table structure]

LEFT PAGE CELLS (first 30):
[Cell-by-cell OCR data with positions and confidence]

RIGHT PAGE CELLS (first 30):
[Cell-by-cell OCR data]

=== EXTRACTED FLIGHTS WITH REASONING ===

Flight 1:
{
  "date": {
    "value": "08-16-2024",
    "confidence": 0.95,
    "reasoning": "OCR read '8/16' clearly in DATE column"
  },
  "aircraft": {
    "value": "LR25",
    "confidence": 0.9,
    "reasoning": "Corrected from 'LB25' per OCR error rules"
  },
  [... all fields with reasoning ...]
}

Flight 2:
[...]

=== RAW LLM OUTPUT ===
[Complete unprocessed output from the model]

=== CSV FORMAT ===
DATE,AIRCRAFT,IDENT,ROUTE,TOTAL,...
08-16-2024,LR25,N208AJ,HOU-DFW,2.8,...

========== END REPORT ==========
```

## How to Use

### Viewing Console Logs

1. **Connect iPhone to Mac**
2. **Open Xcode** → Window → Devices and Simulators
3. **Select your iPhone**
4. **Click "Open Console"**
5. **Filter by "Process" or "=========="** to see the detailed logs

### Sharing Results

After extraction completes:

1. **📤 CSV** - Quick share for spreadsheet import
   - Tap to share CSV file
   - Import into Excel, Numbers, Google Sheets
   - Just the data, no reasoning

2. **📋 Full Report** - Complete analysis
   - Tap to share detailed text file
   - Contains everything: OCR, reasoning, LLM output
   - Perfect for debugging or documentation
   - Can send to Notes, Email, Files, etc.

## Use Cases

### For Normal Use
- Use **📤 CSV** to import into your logbook software
- Quick and simple

### For Debugging
- Use **📋 Full Report** to see:
  - What OCR detected
  - How LLM interpreted it
  - Why each value was chosen
  - Confidence levels for each field

### For Verification
- Check reasoning to understand extraction decisions
- Verify confidence levels (low confidence = double-check)
- See OCR corrections applied (LB25 → LR25, etc.)
- Validate empty cell handling

### For Improvement
- Share full report when reporting issues
- Helps identify patterns in errors
- Shows where OCR struggles
- Reveals LLM interpretation logic

## Example Reasoning Patterns

### OCR Corrections
```json
"aircraft": {
  "value": "LR25",
  "confidence": 0.9,
  "reasoning": "Corrected from 'LB25' per OCR error rules"
}
```

### Decimal Conversion
```json
"totalDuration": {
  "value": 2.8,
  "confidence": 0.95,
  "reasoning": "OCR read '2|8' in two sub-columns, converted to 2.8"
}
```

### Tenths-Only Values
```json
"actualInstrument": {
  "value": 0.2,
  "confidence": 0.85,
  "reasoning": "OCR read '|2' (tenths only), converted to 0.2"
}
```

### Empty Cells
```json
"solo": {
  "value": 0.0,
  "confidence": 1.0,
  "reasoning": "Empty cell at row 5, column 12"
}
```

### Aircraft Type Logic
```json
"turbojet": {
  "value": 2.8,
  "confidence": 0.9,
  "reasoning": "LR25 is jet aircraft, matches total duration"
},
"turboprop": {
  "value": 0.0,
  "confidence": 1.0,
  "reasoning": "LR25 is turbojet not turboprop per rules"
}
```

### Validation
```json
"pic": {
  "value": 2.8,
  "confidence": 0.95,
  "reasoning": "Matches total duration, validated PIC+SIC+Dual+CFI+Solo=Total"
}
```

## Console Log Structure

When you run extraction, you'll see this sequence:

1. **[Process] Step 1: Starting Vision OCR...**
2. **========== RAW OCR RESULTS ==========**
3. **[Process] OCR complete in 2.3s**
4. **[Process] Step 2: Formatting OCR data for LLM...**
5. **========== FORMATTED OCR FOR LLM ==========**
6. **[Process] Step 3: Starting LLM extraction...**
7. **========== FULL PROMPT TO LLM ==========**
8. **[Process] Starting LLM completion...**
9. **[Process] LLM progress: 50 tokens in 5.2s (9.6 tok/s)**
10. **[Process] LLM progress: 100 tokens in 10.8s (9.3 tok/s)**
11. **[Process] LLM complete in 45.2s: 387 tokens**
12. **========== RAW LLM OUTPUT ==========**
13. **[Process] Step 4: Parsing LLM output...**
14. **========== EXTRACTED FLIGHT ENTRIES ==========**
15. **[Process] Processing complete!**

## Files Modified
- `example/HybridFlightLogExtractor.tsx` - Added comprehensive logging, reasoning, and detailed share

## Next Build
```bash
npx eas build --platform ios --profile development --non-interactive
```

After installing, you'll have:
- ✅ Complete console logging of every step
- ✅ Reasoning and confidence for each extracted field
- ✅ Two share options: CSV and Full Report
- ✅ Perfect for debugging and verification
