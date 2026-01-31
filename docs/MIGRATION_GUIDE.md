# Migration Guide: Standard OCR → Enhanced LLM Extraction

This guide helps you upgrade from standard OCR to the enhanced Foundation Models extraction for better accuracy and spatial understanding.

## Why Migrate?

| Feature | Standard OCR | Enhanced LLM |
|---------|-------------|--------------|
| Accuracy (handwritten) | 85% | 95% |
| Spatial understanding | Basic | Advanced |
| Error correction | None | Automatic |
| Table structure | Manual | Automatic |
| Calculations | Manual | Automatic |

## Prerequisites

- iOS 26.0 or later
- Apple Intelligence enabled
- Supported region

## Migration Steps

### Step 1: Check Availability

Add availability check before using enhanced features:

```typescript
import { isLLMAvailable } from 'react-native-vision-camera-ocr';

// Before
const result = await DocumentRecognizer.process(uri);

// After
if (isLLMAvailable()) {
  // Use enhanced extraction
  await initializeLLM();
  const result = await processTableWithLLM(leftUri, rightUri, context);
} else {
  // Fall back to standard OCR
  const result = await DocumentRecognizer.process(uri);
}
```

### Step 2: Initialize LLM

Add initialization at app startup:

```typescript
// Before
import { DocumentRecognizer } from 'react-native-vision-camera-ocr';

// After
import {
  DocumentRecognizer,
  initializeLLM,
  isLLMAvailable,
} from 'react-native-vision-camera-ocr';

useEffect(() => {
  if (isLLMAvailable()) {
    initializeLLM().catch(console.error);
  }
}, []);
```

### Step 3: Update Processing Logic

Replace single-image processing with dual-image LLM processing:

```typescript
// Before: Standard OCR
const processImage = async (uri: string) => {
  const result = await DocumentRecognizer.process(uri, []);
  const csv = formatTableAsCSV(result.tables);
  return csv;
};

// After: Enhanced LLM
const processImages = async (leftUri: string, rightUri: string) => {
  const result = await processTableWithLLM(
    leftUri,
    rightUri,
    contextPrompt
  );
  return result.csv; // Already formatted
};
```

### Step 4: Add Context Prompt

Create a context prompt describing your table structure:

```typescript
const contextPrompt = `
Flight logbook table with dual-page spread:

LEFT PAGE COLUMNS:
1. DATE - Format: M/D
2. AIRCRAFT - Type codes (C172, PA28, LR25)
3. IDENT - N-numbers
4. ROUTE - Airport codes with hyphens
5. DURATION - Decimal hours
...

RIGHT PAGE COLUMNS:
1. NIGHT - Night hours
2. PIC - Pilot in command hours
...

RULES:
- Slashed zeros (Ø) = 0, not 6
- Decimal format: "2|8" = 2.8
- Aircraft codes: LB25→LR25
`;
```

### Step 5: Update Result Handling

Use the enhanced result structure:

```typescript
// Before: Standard OCR
const result = await DocumentRecognizer.process(uri);
const tables = result.tables;
const rawText = result.rawText;

// After: Enhanced LLM
const result = await processTableWithLLM(leftUri, rightUri, context);
const csv = result.csv;
const leftTable = result.leftTable;
const rightTable = result.rightTable;
const calculations = result.calculations;

// Access structured data
console.log('Total hours:', calculations.totalHours);
console.log('Rows:', leftTable.rowCount);
console.log('Columns:', leftTable.columnCount);
```

## Complete Example: Before & After

### Before (Standard OCR)

```typescript
import React, { useState } from 'react';
import { DocumentRecognizer, formatTableAsCSV } from 'react-native-vision-camera-ocr';

export default function FlightLogExtractor() {
  const [csv, setCsv] = useState('');

  const processImage = async (uri: string) => {
    try {
      const result = await DocumentRecognizer.process(uri, []);
      const csvData = formatTableAsCSV(result.tables);
      
      // Manual parsing and validation
      const rows = csvData.split('\n');
      const totalHours = rows.reduce((sum, row) => {
        const values = row.split(',');
        const hours = parseFloat(values[4]) || 0;
        return sum + hours;
      }, 0);
      
      setCsv(csvData);
      console.log('Total hours:', totalHours);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    // UI code...
  );
}
```

### After (Enhanced LLM)

```typescript
import React, { useState, useEffect } from 'react';
import {
  initializeLLM,
  processTableWithLLM,
  isLLMAvailable,
} from 'react-native-vision-camera-ocr';

const CONTEXT = `
Flight logbook with columns: Date, Aircraft, Route, Duration, etc.
Rules: Slashed zeros = 0, Decimal format: "2|8" = 2.8
`;

export default function FlightLogExtractor() {
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (isLLMAvailable()) {
      initializeLLM()
        .then(() => setReady(true))
        .catch(console.error);
    }
  }, []);

  const processImages = async (leftUri: string, rightUri: string) => {
    try {
      const extracted = await processTableWithLLM(
        leftUri,
        rightUri,
        CONTEXT
      );
      
      // Automatic calculations included
      setResult(extracted);
      console.log('Total hours:', extracted.calculations.totalHours);
      console.log('CSV:', extracted.csv);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  if (!isLLMAvailable()) {
    return <Text>Requires iOS 26+</Text>;
  }

  return (
    // UI code...
  );
}
```

## Gradual Migration Strategy

### Option 1: Feature Flag

Use a feature flag to gradually roll out:

```typescript
const USE_ENHANCED_EXTRACTION = true; // Toggle this

const processLogbook = async (leftUri: string, rightUri: string) => {
  if (USE_ENHANCED_EXTRACTION && isLLMAvailable()) {
    return await processTableWithLLM(leftUri, rightUri, context);
  } else {
    // Fall back to standard OCR
    const leftResult = await DocumentRecognizer.process(leftUri);
    const rightResult = await DocumentRecognizer.process(rightUri);
    return combineResults(leftResult, rightResult);
  }
};
```

### Option 2: User Preference

Let users choose:

```typescript
const [useEnhanced, setUseEnhanced] = useState(false);

const processLogbook = async (leftUri: string, rightUri: string) => {
  if (useEnhanced && isLLMAvailable()) {
    return await processTableWithLLM(leftUri, rightUri, context);
  } else {
    return await standardOCR(leftUri, rightUri);
  }
};

// In settings
<Switch
  value={useEnhanced}
  onValueChange={setUseEnhanced}
  disabled={!isLLMAvailable()}
/>
```

### Option 3: Automatic Fallback

Try enhanced, fall back if unavailable:

```typescript
const processLogbook = async (leftUri: string, rightUri: string) => {
  try {
    if (isLLMAvailable()) {
      return await processTableWithLLM(leftUri, rightUri, context);
    }
  } catch (error) {
    console.warn('Enhanced extraction failed, falling back:', error);
  }
  
  // Fall back to standard OCR
  return await standardOCR(leftUri, rightUri);
};
```

## API Mapping

### Processing

| Standard OCR | Enhanced LLM |
|-------------|--------------|
| `DocumentRecognizer.process(uri)` | `processTableWithLLM(leftUri, rightUri, context)` |
| Single image | Dual images |
| No context | Context prompt required |

### Results

| Standard OCR | Enhanced LLM |
|-------------|--------------|
| `result.tables` | `result.leftTable`, `result.rightTable` |
| `result.rawText` | `result.csv` |
| Manual calculations | `result.calculations` |
| `result.cellConfidences` | `cell.confidence` in each cell |

### Formatting

| Standard OCR | Enhanced LLM |
|-------------|--------------|
| `formatTableAsCSV(tables)` | `result.csv` (already formatted) |
| `formatTableAsText(tables)` | Parse `result.csv` |
| Manual alignment | Automatic alignment |

## Common Patterns

### Pattern 1: Dual-Page Processing

```typescript
// Before: Process separately
const left = await DocumentRecognizer.process(leftUri);
const right = await DocumentRecognizer.process(rightUri);
const combined = manuallyAlign(left, right);

// After: Process together
const result = await processTableWithLLM(leftUri, rightUri, context);
// Automatically aligned
```

### Pattern 2: Error Correction

```typescript
// Before: Manual correction
const corrected = text
  .replace(/Ø/g, '0')
  .replace(/LB25/g, 'LR25')
  .replace(/BE-Z-O/g, 'BE-200');

// After: Automatic correction
// Just specify in context prompt
const context = `
Common errors to correct:
- Slashed zero (Ø) = 0
- LB25 → LR25
- BE-Z-O → BE-200
`;
```

### Pattern 3: Calculations

```typescript
// Before: Manual calculation
const totalHours = rows.reduce((sum, row) => {
  const hours = parseFloat(row.duration) || 0;
  return sum + hours;
}, 0);

// After: Automatic calculation
const totalHours = result.calculations.totalHours;
```

## Performance Considerations

### Processing Time

| Method | Time |
|--------|------|
| Standard OCR | 1-2 seconds |
| Enhanced LLM | 3-5 seconds |

**Recommendation:** Show progress indicator for enhanced extraction.

### Memory Usage

| Method | Memory |
|--------|--------|
| Standard OCR | ~100MB |
| Enhanced LLM | ~500MB |

**Recommendation:** Process in background, release resources after.

### Battery Impact

| Method | Impact |
|--------|--------|
| Standard OCR | Low |
| Enhanced LLM | Medium |

**Recommendation:** Avoid processing many images in quick succession.

## Testing Strategy

### 1. Unit Tests

```typescript
describe('Enhanced Extraction', () => {
  it('should initialize LLM', async () => {
    if (isLLMAvailable()) {
      const result = await initializeLLM();
      expect(result.success).toBe(true);
    }
  });

  it('should process dual images', async () => {
    if (isLLMAvailable()) {
      const result = await processTableWithLLM(
        leftUri,
        rightUri,
        context
      );
      expect(result.csv).toBeDefined();
      expect(result.calculations).toBeDefined();
    }
  });
});
```

### 2. Integration Tests

Test with real flight logbook images:
- Clear handwriting
- Poor handwriting
- Mixed print/handwriting
- Damaged or faded pages

### 3. Comparison Tests

Compare results between standard and enhanced:

```typescript
const compareResults = async (leftUri: string, rightUri: string) => {
  // Standard OCR
  const standardLeft = await DocumentRecognizer.process(leftUri);
  const standardRight = await DocumentRecognizer.process(rightUri);
  
  // Enhanced LLM
  const enhanced = await processTableWithLLM(leftUri, rightUri, context);
  
  // Compare accuracy
  console.log('Standard rows:', standardLeft.tables[0]?.rowCount);
  console.log('Enhanced rows:', enhanced.leftTable.rowCount);
};
```

## Rollback Plan

If you need to rollback:

1. **Keep standard OCR code**: Don't remove it during migration
2. **Use feature flag**: Easy to toggle off
3. **Monitor errors**: Track LLM failures
4. **Automatic fallback**: Catch errors and use standard OCR

```typescript
const processWithFallback = async (leftUri: string, rightUri: string) => {
  try {
    if (isLLMAvailable()) {
      return await processTableWithLLM(leftUri, rightUri, context);
    }
  } catch (error) {
    console.error('LLM failed, using standard OCR:', error);
  }
  
  // Fallback to standard OCR
  const left = await DocumentRecognizer.process(leftUri);
  const right = await DocumentRecognizer.process(rightUri);
  return combineStandardResults(left, right);
};
```

## Troubleshooting

### Issue: "Foundation Models unavailable"
**Solution:** Check iOS version, Apple Intelligence settings, region

### Issue: Lower accuracy than expected
**Solution:** Improve context prompt, check image quality

### Issue: Slow processing
**Solution:** Reduce image size, process in background

### Issue: High memory usage
**Solution:** Process one at a time, release resources

## Support

For migration help:
- GitHub Issues: [repository-url]
- Documentation: [docs-url]
- Migration examples: [examples-url]

## Next Steps

1. ✅ Review this migration guide
2. ✅ Test on development device
3. ✅ Update context prompts
4. ✅ Add error handling
5. ✅ Test with real data
6. ✅ Deploy to production

## Resources

- [Quick Start Guide](./QUICK_START_LLM.md)
- [API Documentation](./FOUNDATION_MODELS_INTEGRATION.md)
- [Best Practices](./ENHANCED_TABLE_EXTRACTION.md)
- [Example App](../example/EnhancedFlightLogExtractor.tsx)

## License

MIT
