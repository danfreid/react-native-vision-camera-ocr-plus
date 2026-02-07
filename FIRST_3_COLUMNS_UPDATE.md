# First 3 Columns LLM Update + Removed Wasteful Individual Cell LLM Parsing

## Problem 1: Date Extraction
The LLM was not performing well on DATE extraction when processing all 5 columns together in the "Basic Info" batch. It used to do better when we focused on just the first 3 columns.

## Problem 2: Wasteful Individual Cell LLM Parsing
The code was doing LLM parsing on EACH individual cell (14 LLM calls per column), even though we already had superior LLM Column parsing (1 LLM call per column). The individual cell results were never used for extraction - only for logging.

## Solutions

### 1. Split "Basic Info" Batch into Two Batches

**Before:**
```javascript
{
  name: 'Basic Info',
  prompt: `Extract these columns from the flight log (left page):
1. DATE (M/D format)
2. AIRCRAFT MAKE AND MODEL (e.g., LR25, BE-200)
3. AIRCRAFT IDENT (N-number)
4. FROM-TO (airport codes)
5. TOTAL DURATION (hours.tenths, e.g., 2|8 = 2.8)
...`
}
```

**After:**
```javascript
{
  name: 'First 3 Columns (DATE, AIRCRAFT, IDENT)',
  prompt: `Extract ONLY these first 3 columns from the flight log (left page):
1. DATE (M/D format - CRITICAL: Read the month digit carefully. 9/10 means September 10, NOT August)
2. AIRCRAFT MAKE AND MODEL (e.g., LR25, BE-200, IA1124)
3. AIRCRAFT IDENT (N-number)

FOCUS ONLY ON THESE 3 COLUMNS. Ignore all other columns.
...
CRITICAL: For DATE column, read each date independently. Do NOT create patterns or sequences.`
},
{
  name: 'Route and Duration',
  prompt: `Extract these columns from the flight log (left page):
1. FROM-TO (airport codes with hyphens)
2. TOTAL DURATION (hours.tenths, e.g., 2|8 = 2.8)
...`
}
```

### 2. Enhanced Logging for First 3 Columns

Added special logging to show what the LLM extracts from the first 3 columns:

```javascript
// Special logging for first 3 columns batch
if (i === 0) {
  console.log(`[Process] ========== FIRST 3 COLUMNS BATCH ==========`);
  console.log(`[Process] This batch focuses ONLY on DATE, AIRCRAFT MAKE, and AIRCRAFT IDENT`);
  console.log(`[Process] Prompt: ${batch.prompt}`);
  console.log(`[Process] ================================================`);
}
```

After extraction:
```javascript
// Special logging for first 3 columns batch
if (i === 0) {
  console.log(`[Process] ========== FIRST 3 COLUMNS RESULTS ==========`);
  console.log(`[Process] LLM extracted ${batchData.length} rows`);
  console.log(`[Process] Here's what the LLM saw in the first 3 columns:`);
  batchData.forEach((row: any, idx: number) => {
    console.log(`[Process]   Row ${idx + 1}: DATE="${row.date}" AIRCRAFT="${row.aircraft}" IDENT="${row.ident}"`);
  });
  console.log(`[Process] ===================================================`);
}
```

## Benefits

1. **Focused Attention**: LLM can focus solely on DATE, AIRCRAFT, and IDENT without being distracted by other columns
2. **Better Date Recognition**: Explicit instructions about date format (9/10 = September 10, not August)
3. **Clear Visibility**: Detailed logging shows exactly what the LLM extracted from these critical columns
4. **Easier Debugging**: Can immediately see if date extraction is working correctly
5. **Massive Performance Improvement**: Removed 14 individual LLM calls per duration column (TOTAL, SEL, SES, MEL, TURBOJET, TURBOPROP, HELI, GLIDER = 112 LLM calls saved!)
6. **Cleaner Code**: Removed unused llmCellText variable and all related comparison logic
7. **Simpler Logging**: Removed confusing 3-way comparisons (Vision vs LLM Cell vs LLM Column), now just Vision vs LLM Column

## Performance Impact

**Before:**
- Each duration column: 1 LLM call for full column + 14 LLM calls for individual cells = 15 calls
- 8 duration columns × 15 calls = 120 LLM calls total

**After:**
- Each duration column: 1 LLM call for full column only = 1 call
- 8 duration columns × 1 call = 8 LLM calls total

**Savings: 112 LLM calls eliminated (93% reduction in LLM calls for duration columns!)**

## Total Batches
The extraction now runs in **5 batches** instead of 4:
1. First 3 Columns (DATE, AIRCRAFT, IDENT)
2. Route and Duration
3. Aircraft Categories
4. Flight Conditions
5. Pilot Time

## Testing
Run the app and check the console logs for:
- `[Process] ========== FIRST 3 COLUMNS BATCH ==========`
- `[Process] ========== FIRST 3 COLUMNS RESULTS ==========`

This will show you exactly what dates the LLM is reading from the images.

## Code Changes Summary

### Removed from `extractFlightDurationColumn()`:
- Entire "LLM OCR ON INDIVIDUAL CELL" section (~40 lines)
- Individual LLM completion call for each cell
- llmCellText variable and parsing logic
- llmCellText from extractions object

### Updated Logging:
- Removed "LLM Cell" from all console.log statements
- Removed Vision vs LLM Cell comparisons
- Removed LLM Cell vs LLM Column comparisons
- Kept only Vision vs LLM Column comparisons (the only one that matters)

### What Still Runs:
- LLM Column extraction (1 call per column) - this is what we use for final values
- Vision OCR on full column
- Vision OCR on individual cells (for sub-column parsing)
- Pixel analysis for content detection
- Hybrid correction (mapping LLM compacted values to correct positions)
