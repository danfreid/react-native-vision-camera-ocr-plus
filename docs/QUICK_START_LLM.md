# Quick Start: Enhanced Table Extraction with Foundation Models

Get started with Apple's Foundation Models for superior table extraction in just 5 minutes.

## Prerequisites

- iOS 26.0 or later
- Apple Intelligence enabled device
- React Native project with Vision Camera OCR installed

## Installation

```bash
npm install react-native-vision-camera-ocr
cd ios && pod install
```

## Basic Usage (3 Steps)

### Step 1: Check Availability

```typescript
import { isLLMAvailable } from 'react-native-vision-camera-ocr';

if (!isLLMAvailable()) {
  console.log('Foundation Models requires iOS 26+');
  // Fall back to standard OCR
  return;
}
```

### Step 2: Initialize (Once)

```typescript
import { initializeLLM } from 'react-native-vision-camera-ocr';

// Call once at app startup
useEffect(() => {
  initializeLLM()
    .then(() => console.log('LLM ready!'))
    .catch(console.error);
}, []);
```

### Step 3: Process Images

```typescript
import { processTableWithLLM } from 'react-native-vision-camera-ocr';

const result = await processTableWithLLM(
  'file:///path/to/left-page.jpg',
  'file:///path/to/right-page.jpg',
  'Table with columns: Date, Name, Amount, Total'
);

// Use results
console.log('CSV:', result.csv);
console.log('Total:', result.calculations.totalHours);
```

## Complete Example

```typescript
import React, { useState, useEffect } from 'react';
import { View, Button, Text } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  initializeLLM,
  processTableWithLLM,
  isLLMAvailable,
} from 'react-native-vision-camera-ocr';

export default function TableExtractor() {
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (isLLMAvailable()) {
      initializeLLM()
        .then(() => setReady(true))
        .catch(console.error);
    }
  }, []);

  const pickAndProcess = async () => {
    // Pick left image
    const left = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (left.canceled) return;

    // Pick right image
    const right = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (right.canceled) return;

    // Process
    const extracted = await processTableWithLLM(
      left.assets[0].uri,
      right.assets[0].uri,
      'Flight logbook with Date, Aircraft, Duration columns'
    );

    setResult(extracted);
  };

  if (!isLLMAvailable()) {
    return <Text>Requires iOS 26+</Text>;
  }

  if (!ready) {
    return <Text>Initializing...</Text>;
  }

  return (
    <View>
      <Button title="Extract Table" onPress={pickAndProcess} />
      {result && (
        <View>
          <Text>Total Hours: {result.calculations.totalHours}</Text>
          <Text>Rows: {result.leftTable.rowCount}</Text>
        </View>
      )}
    </View>
  );
}
```

## Context Prompt Template

```typescript
const contextPrompt = `
Table structure:
- Column 1: [Name] - [Type] - [Format]
- Column 2: [Name] - [Type] - [Format]
...

Special rules:
- [Rule 1]
- [Rule 2]

Example row:
[Show sample data]
`;
```

## Flight Logbook Example

```typescript
const LOGBOOK_CONTEXT = `
Flight logbook with dual pages.

Left page: Date, Aircraft, Route, Duration
Right page: Night, PIC, Remarks

Rules:
- Dates in M/D format
- Duration in decimal hours (2.5 = 2h 30m)
- Slashed zero (Ø) = 0, not 6

Example:
8/15, C172, HOU-AUS, 2.5, 0.0, 2.5, "Training"
`;

const result = await processTableWithLLM(
  leftUri,
  rightUri,
  LOGBOOK_CONTEXT
);
```

## Accessing Results

```typescript
// CSV output
const csv = result.csv;
console.log(csv);

// Structured data
const leftTable = result.leftTable;
console.log('Rows:', leftTable.rowCount);
console.log('Columns:', leftTable.columnCount);
console.log('Headers:', leftTable.headers);

// Individual cells
leftTable.cells.forEach(cell => {
  console.log(`[${cell.row},${cell.column}]: ${cell.value}`);
});

// Calculations
console.log('Total hours:', result.calculations.totalHours);
console.log('Night hours:', result.calculations.totalNight);
console.log('Day landings:', result.calculations.dayLandings);
```

## Error Handling

```typescript
try {
  await initializeLLM();
} catch (error) {
  if (error.message.includes('unavailable')) {
    // Device doesn't support Foundation Models
    Alert.alert('Not Available', 'Requires iOS 26+ with Apple Intelligence');
  } else {
    // Other error
    console.error('Init error:', error);
  }
}

try {
  const result = await processTableWithLLM(left, right, context);
} catch (error) {
  if (error.message.includes('IMAGE_ERROR')) {
    Alert.alert('Error', 'Could not load images');
  } else if (error.message.includes('PROCESSING_ERROR')) {
    Alert.alert('Error', 'Failed to process table');
  } else {
    console.error('Processing error:', error);
  }
}
```

## Tips for Best Results

### 1. Image Quality
- Good lighting
- In focus
- Entire table visible
- No shadows or glare
- 1080p or higher

### 2. Context Prompt
- Describe all columns
- Specify data types
- List common errors
- Show example data
- Include validation rules

### 3. Performance
- Initialize once at startup
- Process in background
- Show loading indicator
- Handle errors gracefully

## Common Issues

### "Foundation Models unavailable"
**Fix:** Ensure iOS 26+, Apple Intelligence enabled, supported region

### Low accuracy
**Fix:** Better image quality, more detailed context prompt

### Slow processing
**Fix:** Reduce image size, process in background

### Wrong structure
**Fix:** Provide more context about table layout

## Next Steps

- 📖 [Full API Documentation](./FOUNDATION_MODELS_INTEGRATION.md)
- 🎯 [Use Cases & Best Practices](./ENHANCED_TABLE_EXTRACTION.md)
- 💻 [Complete Example App](../example/EnhancedFlightLogExtractor.tsx)
- 📝 [Implementation Details](./IMPLEMENTATION_SUMMARY.md)

## Support

- GitHub Issues: [repository-url]
- Documentation: [docs-url]
- Apple Developer Forums: Foundation Models

## License

MIT
