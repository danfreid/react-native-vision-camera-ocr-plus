# Fix: Extract All Rows + Strip Markdown Fences

## Issues Fixed

### Issue 1: Markdown Code Fences
**Problem:** LLM was wrapping output in markdown code fences:
```
```json
[{"date": ...}]
```
```

**Solution:** Added code to strip markdown fences before parsing:
```typescript
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
```

### Issue 2: Only Extracting First Row
**Problem:** LLM was only extracting 1 flight instead of all 14 rows.

**Root Cause:** The prompt wasn't explicit enough about extracting ALL rows.

**Solution:** Made the prompt much more explicit:

1. **Added row count to instructions:**
```
Extract data from ALL 15 flight rows (excluding header row)
Process EVERY row from row 1 to row 15
```

2. **Emphasized not to skip rows:**
```
Do NOT skip rows - even if a row appears empty, include it with empty/null values
```

3. **Added expected output count:**
```
EXPECTED OUTPUT: A JSON array with 15 objects (one per flight row).
```

4. **Added reminder at end:**
```
REMINDER: Extract ALL 15 flight rows. Do not stop after the first row!
```

5. **Increased token limit:**
- Changed from 4000 to 8000 tokens
- Allows room for all 14 flights with reasoning
- Each flight with reasoning is ~400-600 tokens
- 14 flights × 500 tokens = ~7000 tokens needed

## Why It Was Only Extracting One Row

LLMs sometimes stop early when:
1. Instructions aren't explicit about quantity
2. Token limit is too low
3. Example shows only one object
4. No clear indication of expected array length

The fix addresses all of these:
- ✅ Explicit count in multiple places
- ✅ Higher token limit (8000)
- ✅ Clear expectation of array with N objects
- ✅ Reminder not to stop early

## Expected Behavior After Fix

### Before:
```json
[
  {"date": {"value": "08-16-2024", ...}, ...}
]
```
Only 1 flight extracted, repeated 14 times in UI

### After:
```json
[
  {"date": {"value": "08-16-2024", ...}, ...},
  {"date": {"value": "08-17-2024", ...}, ...},
  {"date": {"value": "08-18-2024", ...}, ...},
  ...
  {"date": {"value": "08-29-2024", ...}, ...}
]
```
All 14 unique flights extracted

## Token Usage

With reasoning for each field:
- **Per flight:** ~400-600 tokens
- **14 flights:** ~5600-8400 tokens
- **Token limit:** 8000 tokens
- **Should fit:** Yes, with some margin

If you have pages with more than 14 flights, may need to increase to 10000 or 12000 tokens.

## Processing Time Impact

With 8000 token limit instead of 4000:
- **Before:** 30-60 seconds
- **After:** 60-120 seconds (roughly double)
- **Tokens/sec:** Still 8-12 tok/s
- **Worth it:** Yes, to get all flights!

## Console Logs

You'll now see in the prompt:
```
CRITICAL INSTRUCTIONS:
1. Extract data from ALL 15 flight rows (excluding header row)
2. Process EVERY row from row 1 to row 15
...
EXPECTED OUTPUT: A JSON array with 15 objects (one per flight row).
...
REMINDER: Extract ALL 15 flight rows. Do not stop after the first row!
```

And in the output:
```
========== EXTRACTED FLIGHT ENTRIES ==========
[
  { "date": {"value": "08-16-2024", ...}, ... },
  { "date": {"value": "08-17-2024", ...}, ... },
  { "date": {"value": "08-18-2024", ...}, ... },
  ...14 unique flights...
]
==============================================
```

## Files Modified
- `example/HybridFlightLogExtractor.tsx`
  - Updated `parseModelOutput()` to strip markdown fences
  - Updated prompt to be explicit about extracting all rows
  - Increased `n_predict` from 4000 to 8000
  - Updated progress calculation for 8000 tokens

## Next Build
```bash
npx eas build --platform ios --profile development --non-interactive
```

After this build, you should get all 14 unique flight entries with reasoning for each field!
