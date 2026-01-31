# Directory Creation Fix

## Issue
The app was crashing on startup with:
```
FileAlreadyExistsException: File 'file:///.../Documents/models/' already exists
```

## Root Cause
The code was calling `modelsDir.create()` unconditionally, which fails if the directory already exists. This happens when:
1. The user previously used the flight-log-extractor app (which creates the same directory)
2. The app is restarted after models were already downloaded

## Fix Applied
Changed both `checkAndLoadModel()` and `downloadFile()` functions to check if the directory exists before trying to create it:

```typescript
// Before (crashes if directory exists)
const modelsDir = new Directory(Paths.document, 'models');
await modelsDir.create();

// After (safe)
const modelsDir = new Directory(Paths.document, 'models');
if (!modelsDir.exists) {
  await modelsDir.create();
}
```

## Files Modified
- `example/HybridFlightLogExtractor.tsx` - Added existence checks in 2 places

## Testing
The app should now:
- ✅ Start successfully even if models directory already exists
- ✅ Detect previously downloaded models from flight-log-extractor app
- ✅ Auto-load models if they're already present
- ✅ Allow downloading new models without errors

## No Rebuild Needed
Since this is a JavaScript/TypeScript change (not native code), you can test it with:
1. Close the app completely
2. Rebuild with: `npx eas build --platform ios --profile development --non-interactive`
3. Install the new build
4. The error should be gone

The app should now properly detect if you already have the Qwen3-VL model downloaded from the other app and load it automatically!
