# Foundation Models Integration for Enhanced Table Extraction

This document describes the integration of Apple's Foundation Models framework (iOS 26+) with the Vision Camera OCR library to provide enhanced tabular data extraction with spatial understanding and error correction.

## Overview

The Foundation Models integration combines:
- **Vision Framework OCR**: Fast, accurate text recognition with bounding boxes
- **Apple Intelligence LLM**: On-device language model for spatial understanding and error correction
- **Structured Output**: Type-safe table extraction using Swift's `@Generable` macro

## Features

### 1. Spatial Understanding
The LLM analyzes the spatial relationships between text elements to:
- Identify rows and columns based on position
- Group text into cells
- Handle merged cells and multi-line entries
- Align data across dual-page spreads

### 2. Error Correction
Common OCR errors in handwritten text are automatically corrected:
- Slashed zeros (Ø) → 0 (not 6)
- Character confusion: 0/O, 1/I, 8/B, 5/S
- Aircraft codes: LB25→LR25, BE-Z-O→BE-200, IAILY→IA1124
- Decimal formats: "2|8" → 2.8, "|6" → 0.6

### 3. Automatic Calculations
The system can calculate totals and summaries:
- Total flight hours
- Category-specific hours (night, cross-country, PIC, etc.)
- Landing counts
- Custom calculations based on context

### 4. Privacy & Performance
- 100% on-device processing
- No data leaves the device
- Optimized for Apple Silicon (Neural Engine)
- Works offline

## Requirements

- iOS 26.0 or later
- Apple Intelligence enabled device
- Supported regions for Apple Intelligence

## Installation

The Foundation Models integration is included in the main package. No additional dependencies required.

```bash
npm install react-native-vision-camera-ocr
cd ios && pod install
```

## Usage

### Basic Example

```typescript
import {
  initializeLLM,
  processTableWithLLM,
  isLLMAvailable,
} from 'react-native-vision-camera-ocr';

// Check availability
if (!isLLMAvailable()) {
  console.log('Foundation Models requires iOS 26+');
  return;
}

// Initialize the LLM (call once at app startup)
try {
  const result = await initializeLLM();
  console.log(result.message); // "Foundation Models initialized"
} catch (error) {
  console.error('Initialization failed:', error);
  return;
}

// Process dual-page images
const result = await processTableWithLLM(
  'file:///path/to/left-page.jpg',
  'file:///path/to/right-page.jpg',
  'Flight logbook with columns: Date, Aircraft, Route, Duration, Night, PIC, etc.'
);

// Access results
console.log('CSV Output:\n', result.csv);
console.log('Total Hours:', result.calculations.totalHours);
console.log('Left page structure:', result.leftTable);
console.log('Right page structure:', result.rightTable);
```

### Flight Logbook Example

```typescript
import { processTableWithLLM } from 'react-native-vision-camera-ocr';

const contextPrompt = `
Flight logbook table with the following structure:

Left page columns:
- DATE: MM/DD format
- AIRCRAFT MAKE AND MODEL: Aircraft type (e.g., C172, PA28, LR25)
- AIRCRAFT IDENT: Registration number (e.g., N12345)
- FROM-TO: Airport codes separated by hyphens
- TOTAL DURATION: Flight hours in decimal format
- Aircraft category columns (SEL, MEL, etc.)
- LANDINGS DAY and LANDINGS NIGHT: Integer counts

Right page columns:
- NIGHT: Night flight hours
- ACTUAL INSTRUMENT: IMC hours
- SIMULATED INSTRUMENT: Hood time
- APPROACHES: Count and type
- CROSS COUNTRY: XC hours
- PILOT IN COMMAND: PIC hours
- SECOND IN COMMAND: SIC hours
- DUAL RECEIVED: Instruction received
- AS FLIGHT INSTRUCTOR: CFI time
- REMARKS: Notes and endorsements

Special handling:
- Slashed zeros should be interpreted as 0
- Decimal format: "2|8" means 2.8 hours
- Empty cells should remain empty
`;

const result = await processTableWithLLM(
  leftImageUri,
  rightImageUri,
  contextPrompt
);

// Parse CSV
const rows = result.csv.split('\n').filter(row => !row.startsWith('#'));
const headers = rows[0].split(',');
const data = rows.slice(1).map(row => {
  const values = row.split(',');
  return headers.reduce((obj, header, i) => {
    obj[header.replace(/"/g, '')] = values[i]?.replace(/"/g, '') || '';
    return obj;
  }, {} as Record<string, string>);
});

console.log('Extracted flights:', data);
console.log('Calculations:', result.calculations);
```

### Advanced: Custom Calculations

```typescript
// The context prompt can request specific calculations
const contextPrompt = `
Flight logbook table. Calculate:
1. Total hours by aircraft type
2. Hours in last 90 days
3. Currency requirements (3 takeoffs/landings in 90 days)
4. Night currency (3 takeoffs/landings at night in 90 days)
`;

const result = await processTableWithLLM(
  leftImageUri,
  rightImageUri,
  contextPrompt
);

// Access custom calculations
console.log(result.calculations);
```

## API Reference

### `initializeLLM()`

Initialize the Foundation Models session. Must be called before using `processTableWithLLM`.

**Returns:** `Promise<{ success: boolean; message: string }>`

**Throws:** Error if Foundation Models is unavailable

```typescript
await initializeLLM();
```

### `processTableWithLLM(leftImageUri, rightImageUri, contextPrompt)`

Process dual-page table images with LLM enhancement.

**Parameters:**
- `leftImageUri: string` - File path to left page image
- `rightImageUri: string` - File path to right page image  
- `contextPrompt: string` - Context about table structure and expected data

**Returns:** `Promise<EnhancedTableResult>`

```typescript
interface EnhancedTableResult {
  csv: string;                    // Combined CSV output
  leftTable: TableStructure;      // Left page structure
  rightTable: TableStructure;     // Right page structure
  calculations: FlightCalculations; // Calculated totals
  metadata: {
    leftRows: number;
    leftColumns: number;
    rightRows: number;
    rightColumns: number;
  };
}
```

### `isLLMAvailable()`

Check if Foundation Models is available on the current device.

**Returns:** `boolean`

```typescript
if (isLLMAvailable()) {
  // Use enhanced extraction
} else {
  // Fall back to standard OCR
}
```

## Type Definitions

### `TableStructure`

```typescript
interface TableStructure {
  rowCount: number;
  columnCount: number;
  headers: string[];
  cells: TableCell[];
}
```

### `TableCell`

```typescript
interface TableCell {
  value: string;      // Extracted text
  row: number;        // Row index (0-based)
  column: number;     // Column index (0-based)
  confidence: number; // Confidence score 0.0-1.0
}
```

### `FlightCalculations`

```typescript
interface FlightCalculations {
  totalHours: number;
  totalNight: number;
  totalCrossCountry: number;
  totalPIC: number;
  totalDual: number;
  dayLandings: number;
  nightLandings: number;
}
```

## Best Practices

### 1. Context Prompts

Provide detailed context about your table structure:

```typescript
const contextPrompt = `
Table structure:
- Column names and their meanings
- Data types (text, numbers, dates)
- Special formatting rules
- Common abbreviations
- Validation rules

Example data:
- Show a sample row
- Explain any special cases
`;
```

### 2. Error Handling

```typescript
try {
  await initializeLLM();
} catch (error) {
  if (error.message.includes('unavailable')) {
    // Device doesn't support Foundation Models
    // Fall back to standard OCR
  } else {
    // Other initialization error
  }
}
```

### 3. Image Quality

For best results:
- Use good lighting
- Ensure text is in focus
- Capture the entire table
- Avoid shadows and glare
- Use high resolution (at least 1080p)

### 4. Performance

- Initialize once at app startup
- Reuse the same session for multiple extractions
- Process images in background thread
- Show progress indicator for user feedback

## Comparison: Standard vs Enhanced

| Feature | Standard OCR | Enhanced (LLM) |
|---------|-------------|----------------|
| Text Recognition | ✅ | ✅ |
| Bounding Boxes | ✅ | ✅ |
| Spatial Understanding | ❌ | ✅ |
| Error Correction | ❌ | ✅ |
| Table Structure | Basic | Advanced |
| Calculations | ❌ | ✅ |
| Context Awareness | ❌ | ✅ |
| Handwriting Accuracy | Good | Excellent |

## Troubleshooting

### "Foundation Models unavailable"

**Cause:** Device doesn't support Apple Intelligence or it's not enabled.

**Solution:**
- Ensure iOS 26+ is installed
- Enable Apple Intelligence in Settings
- Check device is in supported region
- Verify device has Apple Intelligence capability

### Low Confidence Scores

**Cause:** Poor image quality or unclear handwriting.

**Solution:**
- Improve lighting conditions
- Use higher resolution images
- Ensure text is in focus
- Provide more context in the prompt

### Incorrect Table Structure

**Cause:** Complex layout or merged cells.

**Solution:**
- Provide detailed context about table structure
- Specify column names and positions
- Describe any special formatting
- Show example data in context prompt

### Slow Processing

**Cause:** Large images or complex tables.

**Solution:**
- Resize images to reasonable size (1080p-4K)
- Process in background thread
- Show progress indicator
- Consider batch processing for multiple pages

## Examples

See the `example/` directory for complete working examples:
- `example/FlightLogExtractor.tsx` - Flight logbook extraction
- `example/TableScanner.tsx` - Generic table scanning
- `example/FormExtractor.tsx` - Form data extraction

## License

MIT

## Support

For issues and questions:
- GitHub Issues: [repository-url]
- Documentation: [docs-url]
- Apple Developer Forums: [Foundation Models tag]
