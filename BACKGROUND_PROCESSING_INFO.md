# Background Processing - What You Need to Know

## The Reality of iOS Background Processing

### Short Answer
**iOS will keep your app running for a limited time (~30 seconds to 3 minutes) when you switch away.** After that, it may suspend the app to save battery.

### What We Added
The app now monitors when you switch away and shows a warning banner:
```
⚠️ App is in background. Processing may be slower or paused. 
Keep app in foreground for best performance.
```

### How iOS Background Works

#### When You Switch Apps:
1. **First 30 seconds**: App continues running normally
2. **30 seconds - 3 minutes**: iOS may throttle CPU usage
3. **After 3 minutes**: iOS will likely suspend the app completely

#### What Happens to LLM Processing:
- **Best case**: Processing completes within 30 seconds → No interruption
- **Typical case**: Processing takes 30-90 seconds → May slow down or pause
- **Worst case**: Processing takes >3 minutes → Will be suspended

### Recommendations

#### For Best Results:
1. **Keep the app in foreground** during processing (30-90 seconds)
2. Don't switch to other apps while "Generating..." is showing
3. Don't lock your phone during processing
4. Keep your phone plugged in (prevents aggressive power saving)

#### If You Must Switch Away:
- The app will try to continue processing
- Check back within 1-2 minutes
- If progress stopped, you may need to restart extraction

### Why Not Full Background Support?

iOS restricts background processing to specific use cases:
- Audio playback
- Location tracking
- VoIP calls
- Background fetch (periodic, not continuous)
- Push notifications

**LLM inference doesn't fit any of these categories**, so iOS won't grant extended background time.

### Technical Details

#### What We Implemented:
```typescript
// Monitor app state changes
AppState.addEventListener('change', (nextAppState) => {
  if (nextAppState === 'background' && processingRef.current) {
    // Show warning banner
    console.log('[Background] App moved to background');
  }
});
```

#### What iOS Provides:
- ~30 seconds of guaranteed background time
- Possible extension to 3 minutes if system allows
- No guarantees after that

#### What We Can't Do:
- Force iOS to keep app running indefinitely
- Prevent suspension after time limit
- Resume processing automatically after suspension

### Workarounds

#### Option 1: Stay in Foreground (Recommended)
- Keep app visible during processing
- Takes 30-90 seconds total
- Most reliable

#### Option 2: Use Guided Access (iOS Feature)
1. Settings → Accessibility → Guided Access
2. Enable Guided Access
3. Triple-click side button in app
4. Prevents accidental app switching
5. Keeps app in foreground

#### Option 3: Disable Auto-Lock
1. Settings → Display & Brightness → Auto-Lock
2. Set to "Never" temporarily
3. Prevents screen from locking during processing
4. Remember to re-enable after!

### Comparison with flight-log-extractor App

Your existing app has the same limitation:
- Must stay in foreground during processing
- iOS will suspend if you switch away too long
- No way around this without Apple's special entitlements

### Future Possibilities

#### What Could Help:
1. **Faster model**: Qwen3-VL-2B is fastest, completes in 30-60 seconds
2. **Batch processing**: Process multiple pages in sequence (stay in app longer)
3. **Save/resume**: Save progress and resume if interrupted (complex to implement)

#### What Won't Help:
- Background fetch (only runs periodically, not continuously)
- Push notifications (can't trigger long-running tasks)
- Background tasks (limited to 30 seconds)

### Bottom Line

**Keep the app in foreground for 30-90 seconds while processing.** This is the most reliable approach and matches how most iOS apps handle intensive tasks.

The warning banner will alert you if you accidentally switch away, so you can return to the app before iOS suspends it.

## Files Modified
- `example/HybridFlightLogExtractor.tsx` - Added AppState monitoring and warning banner

## What You'll See

### During Processing (Foreground):
- Progress bar moves smoothly
- Status updates with token count
- No warnings

### If You Switch Away:
- Orange warning banner appears when you return
- "⚠️ App is in background. Processing may be slower or paused."
- Processing may continue for 30-90 seconds
- May be suspended after that

### Console Logs:
```
[Background] App moved to background during processing
[Background] App returned to foreground, processing continues
```

## Testing
After the next build:
1. Start extraction
2. Switch to another app after 10 seconds
3. Return within 30 seconds → Should see warning but processing continues
4. Return after 2 minutes → May need to restart extraction
