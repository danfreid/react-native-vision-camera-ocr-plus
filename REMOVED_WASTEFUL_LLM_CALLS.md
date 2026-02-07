# Removed Wasteful Individual Cell LLM Parsing

## Summary
Removed 112 unnecessary LLM calls per extraction by eliminating individual cell LLM parsing. The code was doing both full-column LLM parsing (1 call per column) AND individual cell LLM parsing (14 calls per column), but only using the full-column results.

## Performance Impact

### Before:
- Each duration column: 1 LLM call for full column + 14 LLM calls for individual cells = **15 calls**
- 8 duration columns (TOTAL, SEL, SES, MEL, TURBOJET, TURBOPROP, HELI, GLIDER) × 15 calls = **120 LLM calls total**

### After:
- Each duration column: 1 LLM call for full column only = **1 call**
- 8 duration columns × 1 call = **8 LLM calls total**

### Savings: **112 LLM calls eliminated (93% reduction!)**

## What Was Removed

### From `extractFlightDurationColumn()` function:

1. **Entire "LLM OCR ON INDIVIDUAL CELL" section (~40 lines)**
   - Individual LLM completion call for each of 14 cells
   - Cell-specific prompt generation
   - Response parsing and number extraction
   - Error handling for each cell

2. **llmCellText variable**
   - Declaration
   - Assignment from LLM response
   - Storage in extractions object

3. **Logging comparisons**
   - "LLM Cell" log lines
   - Vision vs LLM Cell comparisons
   - LLM Cell vs LLM Column comparisons

## What Still Runs (The Important Stuff)

1. **LLM Column extraction** - 1 call per column that processes all 14 cells at once
2. **Vision OCR** - On full column and individual cells
3. **Pixel analysis** - For content detection
4. **Hybrid correction** - Maps LLM's compacted values to correct row positions

## Why This Works

The `getFinalValue()` function (which generates the final CSV) uses:
```javascript
if (cell.llmColumnValue !== undefined && cell.llmColumnValue !== null) {
  return cell.llmColumnValue;  // Uses LLM Column result
}
```

It **never** used `llmCellText`, so those 112 LLM calls were completely wasted.

## Code Changes

### Removed from extractions object:
```javascript
// BEFORE
extractions.push({
  ...
  llmCellText: llmCellText,  // ❌ REMOVED
  llmColumnValue: llmColumnValue,  // ✅ KEPT
  ...
});

// AFTER
extractions.push({
  ...
  llmColumnValue: llmColumnValue,  // ✅ KEPT
  ...
});
```

### Simplified logging:
```javascript
// BEFORE
console.log(`    LLM Cell: "${cell.llmCellText || ''}"`);  // ❌ REMOVED
console.log(`    LLM Column: "${cell.llmColumnValue || ''}"`);  // ✅ KEPT

// AFTER
console.log(`    LLM Column: "${cell.llmColumnValue || ''}"`);  // ✅ KEPT
```

## Files Modified
- `example/HybridFlightLogExtractor.tsx`

## Testing
Run the app and verify:
1. Extraction still works correctly
2. Processing is faster (112 fewer LLM calls)
3. Console logs are cleaner (no confusing 3-way comparisons)
4. Final CSV output is identical to before
