# Prompt Comparison Feature

## What Was Added

The app now runs **TWO** LLM extractions with different prompts and shows both results side-by-side for comparison!

### Prompt 1: Current System Prompt
- The existing detailed prompt with OCR error corrections
- Focuses on specific field-by-field instructions
- Includes reasoning and confidence for each field

### Prompt 2: Alternative (prompt.txt)
- The JSON-structured prompt from your flight-log-extractor app
- More structured with definitions and properties
- Different approach to column identification (right-to-left for right page)

## How It Works

### Processing Flow:
1. **OCR runs once** (same for both prompts)
2. **First LLM call** with current system prompt
   - Progress: 0-50%
   - Status: "Generating... X tokens"
3. **Second LLM call** with alternative prompt
   - Progress: 50-95%
   - Status: "Generating (Alt)... X tokens"
4. **Both results displayed** side-by-side
   - Progress: 100%
   - Status: "Complete! Prompt 1: X flights | Prompt 2: Y flights"

### Total Processing Time:
- **Before:** 60-120 seconds (one prompt)
- **After:** 120-240 seconds (two prompts)
- Worth it to compare which prompt works better!

## What You'll See

### In the UI:

```
Results - Comparison

Prompt 1 (Current): 14 flights
Prompt 2 (Alternative): 14 flights
OCR cells detected: 336

📋 Prompt 1: Current System Prompt

Extracted Flights (first 3):
[... JSON with reasoning ...]

Raw LLM Output:
[... raw output ...]

📋 Prompt 2: Alternative (prompt.txt)

Extracted Flights (first 3):
[... JSON with reasoning ...]

Raw LLM Output:
[... raw output ...]

[📤 CSV (P1)]  [📋 Full Report]
```

### In Console Logs:

```
[Process] Step 1: Starting Vision OCR...
========== RAW OCR RESULTS ==========
...
[Process] OCR complete in 2.3s

[Process] Step 2: Formatting OCR data for LLM...
========== FORMATTED OCR FOR LLM ==========
...

[Process] Step 3: Starting LLM extraction...
========== FULL PROMPT TO LLM ==========
...
[Process] LLM progress: 50 tokens in 5.2s (9.6 tok/s)
...
[Process] LLM complete in 45.2s: 387 tokens
========== RAW LLM OUTPUT ==========
...
========== EXTRACTED FLIGHT ENTRIES ==========
...

[Process] First extraction complete! Starting second extraction with alternative prompt...
========== ALTERNATIVE PROMPT TO LLM ==========
...
[Process] LLM2 progress: 50 tokens in 5.1s (9.8 tok/s)
...
[Process] LLM2 complete in 48.3s: 412 tokens
========== RAW LLM OUTPUT (ALTERNATIVE) ==========
...
========== EXTRACTED FLIGHT ENTRIES (ALTERNATIVE) ==========
...

[Process] Both extractions complete!
```

## Share Options

### 📤 CSV (P1)
- Quick CSV export from Prompt 1 results
- For spreadsheet import

### 📋 Full Report
- Comprehensive comparison report including:
  - Summary with both prompt results
  - Raw OCR data
  - **Prompt 1 section:**
    - Extracted flights with reasoning
    - Raw LLM output
    - CSV format
  - **Prompt 2 section:**
    - Extracted flights with reasoning
    - Raw LLM output
    - CSV format

## Comparison Criteria

### What to Look For:

#### 1. Flight Count
- Do both prompts extract all 14 flights?
- Or does one stop early?

#### 2. Field Accuracy
- Which prompt gets dates correct?
- Which handles aircraft types better?
- Which correctly identifies empty cells?

#### 3. Column Alignment
- Which prompt maintains proper column alignment?
- Which handles the "count from right" columns better?
- Which correctly identifies APP NO vs APP TYPE?

#### 4. OCR Error Corrections
- Which prompt applies corrections better (LB25→LR25)?
- Which handles slashed zeros correctly (∅→0)?
- Which converts decimals correctly (2|8→2.8)?

#### 5. Reasoning Quality
- Which prompt provides better reasoning?
- Which has higher confidence scores?
- Which explanations are more helpful?

#### 6. Edge Cases
- Empty cells
- Sparse rows
- Multi-leg routes
- Ditto marks in remarks

## Key Differences Between Prompts

### Prompt 1 (Current):
- **Style:** Narrative instructions
- **Structure:** Field-by-field descriptions
- **Emphasis:** OCR error corrections, decimal conversions
- **Approach:** Left-to-right column reading
- **Reasoning:** Requested for each field

### Prompt 2 (Alternative):
- **Style:** JSON schema with definitions
- **Structure:** Hierarchical properties
- **Emphasis:** Strict row alignment, column positioning
- **Approach:** Right-to-left for right page columns
- **Reasoning:** Requested (added to original prompt)

## Expected Outcomes

### Scenario 1: Both Work Well
- Both extract 14 flights
- Similar accuracy
- Different reasoning styles
- Choose based on preference

### Scenario 2: One is Better
- One extracts more flights
- One has better accuracy
- One handles edge cases better
- Clear winner emerges

### Scenario 3: Each Has Strengths
- Prompt 1 better at OCR corrections
- Prompt 2 better at column alignment
- Hybrid approach needed
- Combine best of both

## Files Modified
- `example/HybridFlightLogExtractor.tsx`
  - Added `result2` state for second result
  - Added second LLM call after first completes
  - Updated UI to show both results
  - Updated share function to include both results
  - Added section titles and comparison layout

## Files Used
- `example/prompt.txt` - Alternative prompt loaded at runtime

## Next Build
```bash
npx eas build --platform ios --profile development --non-interactive
```

## Testing Checklist

After the build:
- [ ] Both extractions run automatically
- [ ] Progress shows 0-50% for first, 50-100% for second
- [ ] Both results display in UI
- [ ] Can scroll through both sets of results
- [ ] Full Report includes both prompts
- [ ] Console logs show both extractions
- [ ] Can compare flight counts
- [ ] Can compare field accuracy
- [ ] Can identify which prompt is better

## Making the Decision

After testing, you can:
1. **Keep Prompt 1** if it's better
2. **Switch to Prompt 2** if it's better
3. **Combine both** if each has strengths
4. **Iterate further** based on what you learn

The comparison will show you exactly which approach works best for your flight log format!
