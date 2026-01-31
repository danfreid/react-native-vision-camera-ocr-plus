# Alternative Prompt Only - COMPLETE

## What Was Changed

The app now runs **ONLY the alternative prompt** (from `prompt.txt`), with the first LLM call (current system prompt) commented out.

## Changes Made

### 1. Commented Out First LLM Call
**File:** `example/HybridFlightLogExtractor.tsx`

**Location:** After OCR formatting (around line 550)

The entire first LLM call with `SYSTEM_PROMPT` is now wrapped in a multi-line comment `/* ... */`. This includes:
- Prompt building
- LLM completion call
- Progress tracking (0-50%)
- Result parsing
- CSV generation
- Setting `result` state

### 2. Updated Progress Tracking for Alternative Prompt
**Changes:**
- Progress now goes from **50% to 100%** (was 50% to 95%)
- Status messages simplified:
  - "Extracting with Qwen3-VL (alternative prompt)..."
  - "Generating... X tokens (Y tok/s)"
  - "Complete! Extracted X flights"

### 3. Simplified UI to Show Only Alternative Results
**Changes:**
- Title changed from "Results - Comparison" to "Results - Alternative Prompt"
- Stats card shows only alternative prompt results
- Removed Prompt 1 sections entirely
- Shows only Prompt 2 (Alternative) results:
  - Extracted Flights (first 3)
  - Raw LLM Output
  - CSV Format (first 5 rows)
- Share buttons updated:
  - "📤 CSV" (was "📤 CSV (P1)")
  - "📋 Full Report" (simplified report)

### 4. Updated Share Functions
**shareResults():**
- Now uses `result2` instead of `result`
- Shares CSV from alternative prompt only

**shareDetailedResults():**
- Now uses `result2` instead of `result`
- Report includes only alternative prompt extraction
- Removed Prompt 1 sections
- File named `flight-log-{timestamp}.txt` (was `flight-log-comparison-{timestamp}.txt`)

### 5. Console Logging
**Updated log messages:**
- "Step 3: Using alternative prompt (embedded)..."
- "LLM progress:" (was "LLM2 progress:")
- "LLM complete in Xs: Y tokens"
- "Step 4: Parsing LLM output..."
- "Extracted X flight entries"
- "Extraction complete!" (was "Both extractions complete!")

## Processing Flow

### Before (Dual Prompts):
1. OCR (0-30%)
2. Format OCR data (30-50%)
3. **First LLM call** with SYSTEM_PROMPT (50-95%)
4. **Second LLM call** with ALTERNATIVE_PROMPT (50-95%)
5. Complete (100%)
- **Total time:** 120-240 seconds

### After (Alternative Only):
1. OCR (0-30%)
2. Format OCR data (30-50%)
3. **LLM call** with ALTERNATIVE_PROMPT (50-100%)
4. Complete (100%)
- **Total time:** 60-120 seconds

## Benefits

✅ **Faster processing** - Only one LLM call instead of two  
✅ **Simpler UI** - No comparison, just results  
✅ **Less battery usage** - Half the inference time  
✅ **Cleaner logs** - No duplicate extraction logs  
✅ **Testing alternative prompt** - Focus on the JSON-structured prompt  

## To Re-enable First Prompt

If you want to test the first prompt again or compare both:

1. Uncomment the first LLM call block (around line 550)
2. Change progress tracking back to 50-95% for both
3. Update UI to show both `result` and `result2`
4. Update share functions to include both results

## What's Still There

- `SYSTEM_PROMPT` constant is still defined (just not used)
- `result` state variable exists (just not set)
- All the comparison UI code is removed
- First LLM call code is commented out (easy to restore)

## Console Output

```
[Process] Step 1: Starting Vision OCR...
========== RAW OCR RESULTS ==========
...
[Process] OCR complete in 2.3s

[Process] Step 2: Formatting OCR data for LLM...
========== FORMATTED OCR FOR LLM ==========
...

[Process] Step 3: Using alternative prompt (embedded)...
========== ALTERNATIVE PROMPT TO LLM ==========
...
[Process] LLM progress: 50 tokens in 5.1s (9.8 tok/s)
...
[Process] LLM complete in 48.3s: 412 tokens
========== RAW LLM OUTPUT ==========
...
[Process] Step 4: Parsing LLM output...
========== EXTRACTED FLIGHT ENTRIES ==========
...
========== CSV OUTPUT (ALTERNATIVE PROMPT) ==========
...
[Process] Extraction complete!
```

## UI Display

```
Results - Alternative Prompt

Extracted: 14 flights
OCR cells detected: 336

Extracted Flights (first 3):
[... JSON with reasoning ...]

Raw LLM Output:
[... raw output ...]

CSV Format (first 5 rows):
DATE,AIRCRAFT,IDENT,ROUTE,TOTAL,...
09-10-2003,LR25,N123AB,HOU-DFW,2.8,...
...

[📤 CSV]  [📋 Full Report]
```

## Files Modified
- `example/HybridFlightLogExtractor.tsx` - Commented out first LLM call, simplified UI and share functions

## Status

✅ First LLM call commented out  
✅ Progress tracking updated (50-100%)  
✅ UI simplified to show only alternative results  
✅ Share functions updated  
✅ Console logging updated  
✅ No syntax errors  
✅ Formatted with Prettier  

**Ready to build and test the alternative prompt!**

```bash
npx eas build --platform ios --profile development --non-interactive
```
