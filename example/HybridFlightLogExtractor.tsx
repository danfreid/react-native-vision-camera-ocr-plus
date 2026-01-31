import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  AppState,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { initLlama, LlamaContext } from 'llama.rn';
import { File, Paths, Directory } from 'expo-file-system/next';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { DualImageRecognizer } from 'react-native-vision-camera-ocr';

// Model definitions
interface ModelConfig {
  id: string;
  name: string;
  size: string;
  modelFile: string;
  mmprojFile: string;
  modelUrl: string;
  mmprojUrl: string;
}

const HF_BASE_URL = 'https://huggingface.co/unsloth';

const MODELS: ModelConfig[] = [
  {
    id: 'qwen3-vl-2b',
    name: 'Qwen3-VL 2B',
    size: '~1.5GB',
    modelFile: 'Qwen3-VL-2B-Instruct-Q4_K_M.gguf',
    mmprojFile: 'mmproj-Qwen3-VL-2B-F16.gguf',
    modelUrl: `${HF_BASE_URL}/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3-VL-2B-Instruct-Q4_K_M.gguf`,
    mmprojUrl: `${HF_BASE_URL}/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-F16.gguf`,
  },
];

const SYSTEM_PROMPT = `You are extracting flight log data from 2 facing pages in landscape format.

LEFT PAGE has aircraft info and durations with these columns:
- DATE: Format MM-DD-YYYY. CRITICAL: 9/10 means September 10 (09-10), NOT August. Read month digit carefully before slash.
- AIRCRAFT MAKE AND MODEL: Standardize OCR errors: LB25/LA25/LR-25=LR25, BEZAY/BENZOO/BE-Z-O/8E-200/BE-210/BE200=BE-200, IAILY/IAI24/IAIZ4/IAI124=IA1124, DAZO-AI/DA20-AI=DA20-A1
- AIRCRAFT IDENT: Distinguish 0/O, 8/B, Q/0
- FROM and TO: 3-letter airport codes, combine with hyphens. Multi-leg routes may span multiple lines.
- TOTAL DURATION OF FLIGHT: Two sub-columns (hours|tenths). Slashed zero = 0 not 6 (∅,Ø,ø,⌀=0). Combine as decimal: 2|8=2.8, 4|2=4.2, |6=0.6, 9|=0.9, 2|∅=2.0
- AIRPLANE SINGLE-ENGINE LAND, SINGLE-ENGINE SEA, MULTI-ENGINE LAND: Extract from respective columns
- TURBOJET: ONLY for LR25, IA1124 (jets). CRITICAL: BE-200 is TURBOPROP not turbojet.
- TURBOPROP: ONLY for BE-200, PC12, TBM, C208, King Air. NOT for jets (LR25, IA1124).
- ROTORCRAFT HELICOPTER, GLIDER: Only for respective aircraft types
- LANDINGS DAY: LEFT side of LNDGS cell. Compare horizontal position to determine if left-aligned (Day) or right-aligned (Night).
- LANDINGS NIGHT: RIGHT side of LNDGS cell. When only ONE number in LNDGS, check alignment.

RIGHT PAGE has conditions and piloting time with these columns (COUNT FROM RIGHT EDGE):
- REMARKS AND ENDORSEMENTS: Rightmost column. Ditto mark (") means same as row above - extract the mark itself.
- AS FLIGHT INSTRUCTOR: 2nd column from right edge (last numeric column)
- DUAL RECEIVED: 3rd column from right edge
- SECOND IN COMMAND: 4th column from right edge. For multi-crew jets (LR25, IA1124), pilot often logs SIC not PIC.
- PILOT IN COMMAND: 5th column from right edge, LEFT of SIC column
- SOLO: 6th column from right edge
- CROSS COUNTRY: 7th column from right edge, in middle-right area
- FLIGHT SIMULATOR: Between APP TYPE and CROSS COUNTRY, rarely used
- APP TYPE: Contains text codes (ILS, VOR, GPS, LOC, T, V, L). NOT numeric values.
- APP NO.: NARROW single-digit column BEFORE APP TYPE. Contains only integers 1-9. NOT decimal flight times.
- SIMULATED INSTRUMENT (HOOD): Independent column, two sub-columns (hours|tenths)
- ACTUAL INSTRUMENT: Immediately RIGHT of NIGHT column. CRITICAL: Single digit in RIGHT sub-column means 0.X (|2 = 0.2 not 2.0)
- NIGHT: FAR LEFT columns 1-2 of right page

CRITICAL RULES:
1. STRICT ROW ALIGNMENT: Count physical grid lines from header for EACH column independently. Row 5 is always 5th grid line down, even if earlier rows are empty in that column.
2. DECIMAL FORMAT: hours|tenths as two sub-columns. Single digit in tenths column = 0.X (|2 = 0.2)
3. VALIDATION: PIC + SIC + Dual + CFI + Solo MUST equal Total Duration
4. Slashed zero (∅,Ø,ø,⌀) = 0 not 6
5. Exclude summary rows: TOTALS THIS PAGE, AMT. FORWARDED, TOTALS TO DATE

You will receive OCR bounding boxes showing spatial layout. Use them to handle empty cells and maintain alignment.

Output JSON array with one object per flight row containing all fields.`;

const ALTERNATIVE_PROMPT = `Extract flight log data from these 2 facing pages (left and right).

LEFT PAGE columns (in order):
1. DATE (M/D format, year from header)
2. AIRCRAFT MAKE AND MODEL (e.g., LR25, BE-200, IA1124)
3. AIRCRAFT IDENT (N-number)
4. FROM-TO (airport codes with hyphens)
5. TOTAL DURATION (hours.tenths, e.g., 2|8 = 2.8)
6. SINGLE-ENGINE LAND (hours.tenths or empty)
7. SINGLE-ENGINE SEA (hours.tenths or empty)
8. MULTI-ENGINE LAND (hours.tenths or empty)
9. TURBOJET (hours.tenths or empty - only for LR25, IA1124)
10. ROTORCRAFT (hours.tenths or empty)
11. GLIDER (hours.tenths or empty)
12. TURBOPROP (hours.tenths or empty - only for BE-200, PC12)
13. CUSTOM3 (usually empty)
14. LANDINGS DAY (integer or empty)
15. LANDINGS NIGHT (integer or empty)

RIGHT PAGE columns (in order):
16. NIGHT (hours.tenths or empty)
17. ACTUAL INSTRUMENT (hours.tenths or empty - often small values like 0.2, 0.3)
18. SIMULATED INSTRUMENT (hours.tenths or empty)
19. APPROACHES (integer or empty)
20. APPROACH TYPE (text like ILS, VOR, GPS or empty)
21. FLIGHT SIMULATOR (hours.tenths or empty)
22. CROSS COUNTRY (hours.tenths or empty)
23. SOLO (hours.tenths or empty)
24. PILOT IN COMMAND (hours.tenths or empty)
25. SECOND IN COMMAND (hours.tenths or empty)
26. DUAL RECEIVED (hours.tenths or empty)
27. AS FLIGHT INSTRUCTOR (hours.tenths or empty)
28. REMARKS (text or empty)

CRITICAL RULES:
- Read EACH cell independently - don't repeat values
- Empty cells = empty string, not zero
- Slashed zero (Ø) = 0
- Format X|Y as X.Y (e.g., 2|8 = 2.8, |6 = 0.6)
- Skip TOTALS rows at bottom
- Extract 14 flight rows maximum

Output JSON array with one object per row.`;

export default function HybridFlightLogExtractor() {
  const [leftImage, setLeftImage] = useState<string | null>(null);
  const [rightImage, setRightImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [result2, setResult2] = useState<any>(null);
  const [modelReady, setModelReady] = useState(false);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelConfig | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [backgroundWarning, setBackgroundWarning] = useState(false);
  const contextRef = useRef<LlamaContext | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    checkAndLoadModel();

    // Monitor app state changes
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background' && processingRef.current) {
        console.log('[Background] App moved to background during processing');
        setBackgroundWarning(true);
      } else if (nextAppState === 'active' && processingRef.current) {
        console.log(
          '[Background] App returned to foreground, processing continues'
        );
        setBackgroundWarning(false);
      }
    });

    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAndLoadModel = async () => {
    try {
      setStatus('Checking models...');

      const modelsDir = new Directory(Paths.document, 'models');

      // Create directory only if it doesn't exist
      if (!modelsDir.exists) {
        await modelsDir.create();
      }

      // Check which models are downloaded
      const downloaded: string[] = [];
      for (const model of MODELS) {
        const modelFile = new File(modelsDir, model.modelFile);
        const mmprojFile = new File(modelsDir, model.mmprojFile);
        if (modelFile.exists && mmprojFile.exists) {
          downloaded.push(model.id);
        }
      }
      setDownloadedModels(downloaded);

      if (downloaded.length > 0) {
        // Auto-load first downloaded model
        const firstModel = MODELS.find((m) => downloaded.includes(m.id));
        if (firstModel) {
          setSelectedModel(firstModel);
          await loadModel(firstModel);
        }
      } else {
        setStatus('No model found. Tap ⚙️ to download.');
      }
    } catch (error: any) {
      console.error('Model check error:', error);
      setStatus(`Error: ${error.message}`);
    }
  };

  const loadModel = async (model: ModelConfig) => {
    try {
      setStatus(`Loading ${model.name}...`);
      console.log(`[Model] Loading ${model.name} (${model.id})...`);

      const modelsDir = new Directory(Paths.document, 'models');
      const modelFile = new File(modelsDir, model.modelFile);
      const mmprojFile = new File(modelsDir, model.mmprojFile);

      if (!modelFile.exists || !mmprojFile.exists) {
        const errorMsg = 'Model files not found';
        console.error(`[Model] ${errorMsg}`);
        setStatus(errorMsg);
        Alert.alert('Error', errorMsg);
        return;
      }

      console.log(`[Model] Model file: ${modelFile.uri}`);
      console.log(`[Model] Mmproj file: ${mmprojFile.uri}`);
      console.log(`[Model] Model size: ${modelFile.size} bytes`);
      console.log(`[Model] Mmproj size: ${mmprojFile.size} bytes`);

      // Release old context if exists
      if (contextRef.current) {
        console.log('[Model] Releasing old context...');
        await contextRef.current.release();
        contextRef.current = null;
      }

      const context = await initLlama({
        model: modelFile.uri,
        use_mlock: true,
        n_ctx: 8192,
        n_gpu_layers: 99,
      });

      console.log('[Model] Model initialized, loading multimodal...');

      await context.initMultimodal({
        path: mmprojFile.uri,
      });

      console.log('[Model] Multimodal initialized successfully');

      contextRef.current = context;
      setSelectedModel(model);
      setModelReady(true);
      setStatus('Model ready');
      console.log(`[Model] ${model.name} loaded and ready`);
    } catch (error: any) {
      console.error('[Model] Load error:', error);
      console.error('[Model] Error details:', JSON.stringify(error, null, 2));
      const errorMsg = `Failed to load model: ${error.message || 'Unknown error'}`;
      setStatus(errorMsg);
      Alert.alert('Model Load Failed', errorMsg);
    }
  };

  const downloadFile = async (
    url: string,
    filename: string
  ): Promise<boolean> => {
    try {
      const modelsDir = new Directory(Paths.document, 'models');

      // Create directory only if it doesn't exist
      if (!modelsDir.exists) {
        await modelsDir.create();
      }

      const downloadResumable = LegacyFileSystem.createDownloadResumable(
        url,
        `${LegacyFileSystem.documentDirectory}models/${filename}`,
        {},
        (downloadProgressData) => {
          const currentProgress =
            downloadProgressData.totalBytesWritten /
            downloadProgressData.totalBytesExpectedToWrite;
          setDownloadProgress(currentProgress);
        }
      );

      const downloadResult = await downloadResumable.downloadAsync();

      if (downloadResult?.uri) {
        const downloadedFile = new File(modelsDir, filename);
        if (
          downloadedFile.exists &&
          downloadedFile.size &&
          downloadedFile.size > 1000
        ) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Download error:', error);
      return false;
    }
  };

  const downloadModel = async (model: ModelConfig) => {
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      setStatus(`Downloading ${model.name} model...`);
      const modelSuccess = await downloadFile(model.modelUrl, model.modelFile);

      if (!modelSuccess) {
        setIsDownloading(false);
        Alert.alert('Download Failed', 'Failed to download model file.');
        return;
      }

      setStatus(`Downloading ${model.name} vision encoder...`);
      const mmprojSuccess = await downloadFile(
        model.mmprojUrl,
        model.mmprojFile
      );

      if (!mmprojSuccess) {
        setIsDownloading(false);
        Alert.alert('Download Failed', 'Failed to download vision encoder.');
        return;
      }

      // Download complete
      setIsDownloading(false);
      setDownloadedModels((prev) => [...prev, model.id]);

      // Load the model
      await loadModel(model);
    } catch (error: any) {
      setIsDownloading(false);
      Alert.alert('Error', error.message);
    }
  };

  const deleteModel = async (model: ModelConfig) => {
    Alert.alert(
      'Delete Model',
      `Delete ${model.name}? This will free up ${model.size} of storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Unload if active
              if (selectedModel?.id === model.id && contextRef.current) {
                await contextRef.current.release();
                contextRef.current = null;
                setSelectedModel(null);
                setModelReady(false);
              }

              // Delete files
              const modelsDir = new Directory(Paths.document, 'models');
              const modelFile = new File(modelsDir, model.modelFile);
              const mmprojFile = new File(modelsDir, model.mmprojFile);

              if (modelFile.exists) modelFile.delete();
              if (mmprojFile.exists) mmprojFile.delete();

              setDownloadedModels((prev) =>
                prev.filter((id) => id !== model.id)
              );

              Alert.alert('Deleted', `${model.name} has been removed.`);
            } catch (error: any) {
              Alert.alert('Error', `Failed to delete: ${error.message}`);
            }
          },
        },
      ]
    );
  };

  const pickImage = async (side: 'left' | 'right') => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!pickerResult.canceled) {
        const resized = await ImageManipulator.manipulateAsync(
          pickerResult.assets[0].uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );

        if (side === 'left') {
          setLeftImage(resized.uri);
        } else {
          setRightImage(resized.uri);
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const processImages = async () => {
    if (!leftImage || !rightImage || !contextRef.current) {
      Alert.alert(
        'Error',
        'Please select both images and ensure model is loaded'
      );
      return;
    }

    setIsProcessing(true);
    processingRef.current = true;
    setProgress(0);
    setResult(null);
    setResult2(null);
    setBackgroundWarning(false);

    try {
      // Step 1: Get OCR bounding boxes
      console.log('[Process] Step 1: Starting Vision OCR...');
      setStatus('Running Vision OCR...');
      setProgress(10);

      const ocrStartTime = Date.now();
      const ocrResult = await DualImageRecognizer({
        leftUri: leftImage,
        rightUri: rightImage,
      });
      const ocrDuration = ((Date.now() - ocrStartTime) / 1000).toFixed(1);

      // Log raw OCR results
      console.log('========== RAW OCR RESULTS ==========');
      console.log('LEFT PAGE:');
      console.log(JSON.stringify(ocrResult.leftTable, null, 2));
      console.log('\nRIGHT PAGE:');
      console.log(JSON.stringify(ocrResult.rightTable, null, 2));
      console.log('\nLEFT CELL DATA (first 20):');
      console.log(
        JSON.stringify(ocrResult.cellData.left.slice(0, 20), null, 2)
      );
      console.log('\nRIGHT CELL DATA (first 20):');
      console.log(
        JSON.stringify(ocrResult.cellData.right.slice(0, 20), null, 2)
      );
      console.log('=====================================\n');

      console.log(`[Process] OCR complete in ${ocrDuration}s:`, {
        leftCells: ocrResult.cellData.left.length,
        rightCells: ocrResult.cellData.right.length,
        leftColumns: ocrResult.leftTable.columnCount,
        rightColumns: ocrResult.rightTable.columnCount,
        leftRows: ocrResult.leftTable.rowCount,
        rightRows: ocrResult.rightTable.rowCount,
      });

      // Step 2: Format OCR data for LLM
      console.log('[Process] Step 2: Formatting OCR data for LLM...');
      setStatus('Preparing data for LLM...');
      setProgress(30);

      const ocrSummary = formatOCRForLLM(ocrResult);
      console.log('========== FORMATTED OCR FOR LLM ==========');
      console.log(ocrSummary);
      console.log('===========================================\n');
      console.log(`[Process] OCR summary length: ${ocrSummary.length} chars`);

      // ========== FIRST LLM CALL - COMMENTED OUT FOR NOW ==========
      /*
      // Step 3: Run LLM extraction
      console.log('[Process] Step 3: Starting LLM extraction...');
      setStatus('Extracting with Qwen3-VL (this may take 1-2 min)...');
      setProgress(50);

      const prompt = `${SYSTEM_PROMPT}

OCR BOUNDING BOX DATA (showing table structure and cell positions):
${ocrSummary}

CRITICAL INSTRUCTIONS:
1. Extract data from ALL ${ocrResult.leftTable.rowCount - 1} flight rows (excluding header row)
2. Process EVERY row from row 1 to row ${ocrResult.leftTable.rowCount - 1}
3. Do NOT skip rows - even if a row appears empty, include it with empty/null values
4. Use the bounding box data to understand row and column positions
5. For each row, extract data from BOTH left and right pages
6. Match rows by their physical position (row number)
7. Handle empty cells correctly using spatial information
8. Apply OCR error corrections as specified above
9. Validate that time columns sum correctly
10. Skip ONLY the summary rows at bottom (TOTALS THIS PAGE, AMT. FORWARDED, TOTALS TO DATE)

IMPORTANT: For each field you extract, provide:
- value: The extracted value
- confidence: Your confidence level (0.0-1.0)
- reasoning: Brief explanation of why you chose this value (e.g., "OCR read '2|8' in column 4, converted to 2.8", "Empty cell at row 3 col 5", "Corrected LB25 to LR25 per rules")

EXPECTED OUTPUT: A JSON array with ${ocrResult.leftTable.rowCount - 1} objects (one per flight row).

Return ONLY a JSON array with one object per flight entry. Each object should have this structure:
{
  "date": {"value": "MM-DD-YYYY", "confidence": 0.95, "reasoning": "OCR read clearly"},
  "aircraft": {"value": "LR25", "confidence": 0.9, "reasoning": "Corrected from LB25"},
  "ident": {"value": "N123AB", "confidence": 1.0, "reasoning": "Clear OCR"},
  "route": {"value": "HOU-DFW", "confidence": 0.85, "reasoning": "Combined FROM-TO"},
  "totalDuration": {"value": 2.8, "confidence": 0.95, "reasoning": "OCR '2|8' = 2.8"},
  "sel": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "ses": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "mel": {"value": 2.8, "confidence": 0.95, "reasoning": "Matches total, multi-engine aircraft"},
  "turbojet": {"value": 2.8, "confidence": 0.9, "reasoning": "LR25 is jet, matches total"},
  "turboprop": {"value": 0.0, "confidence": 1.0, "reasoning": "LR25 is jet not turboprop"},
  "heli": {"value": 0.0, "confidence": 1.0, "reasoning": "Not helicopter"},
  "glider": {"value": 0.0, "confidence": 1.0, "reasoning": "Not glider"},
  "landingsDay": {"value": 2, "confidence": 0.9, "reasoning": "Left side of LNDGS cell"},
  "landingsNight": {"value": 1, "confidence": 0.9, "reasoning": "Right side of LNDGS cell"},
  "night": {"value": 1.4, "confidence": 0.95, "reasoning": "OCR '1|4' = 1.4"},
  "actualInstrument": {"value": 0.2, "confidence": 0.85, "reasoning": "OCR '|2' = 0.2 (tenths only)"},
  "simulatedInstrument": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "appNo": {"value": 1, "confidence": 0.9, "reasoning": "Single digit in narrow column"},
  "appType": {"value": "ILS", "confidence": 0.95, "reasoning": "Text code in APP TYPE column"},
  "flightSim": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "crossCountry": {"value": 2.8, "confidence": 0.95, "reasoning": "Matches total for XC flight"},
  "solo": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "pic": {"value": 2.8, "confidence": 0.95, "reasoning": "Matches total, pilot in command"},
  "sic": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "dual": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "cfi": {"value": 0.0, "confidence": 1.0, "reasoning": "Empty cell"},
  "remarks": {"value": "91-135", "confidence": 0.9, "reasoning": "FAR reference in remarks column"}
}

REMINDER: Extract ALL ${ocrResult.leftTable.rowCount - 1} flight rows. Do not stop after the first row!

Return ONLY the JSON array, no explanations or markdown code fences.`;

      console.log('========== FULL PROMPT TO LLM ==========');
      console.log(prompt);
      console.log('========================================\n');

      console.log(`[Process] Prompt length: ${prompt.length} chars`);
      console.log('[Process] Starting LLM completion...');

      let tokenCount = 0;
      let lastLogTime = Date.now();
      const llmStartTime = Date.now();

      const completion = await contextRef.current!.completion(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: leftImage } },
                { type: 'image_url', image_url: { url: rightImage } },
              ],
            },
          ],
          n_predict: 8000,
          temperature: 0.1,
          stop: ['</s>', '\n\n\n'],
        },
        (data) => {
          // Progress callback - called for each token generated
          if (data.token) {
            tokenCount++;
            const progressPercent = 50 + Math.min((tokenCount / 8000) * 45, 45);
            setProgress(progressPercent);

            // Log every 50 tokens or every 5 seconds
            const now = Date.now();
            if (tokenCount % 50 === 0 || now - lastLogTime > 5000) {
              const elapsed = ((now - llmStartTime) / 1000).toFixed(1);
              const tokensPerSec = (
                (tokenCount / (now - llmStartTime)) *
                1000
              ).toFixed(1);
              console.log(
                `[Process] LLM progress: ${tokenCount} tokens in ${elapsed}s (${tokensPerSec} tok/s)`
              );
              setStatus(
                `Generating... ${tokenCount} tokens (${tokensPerSec} tok/s)`
              );
              lastLogTime = now;
            }
          }
        }
      );

      const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(1);
      const avgTokensPerSec = (
        (tokenCount / (Date.now() - llmStartTime)) *
        1000
      ).toFixed(1);
      console.log(
        `[Process] LLM complete in ${llmDuration}s: ${tokenCount} tokens (${avgTokensPerSec} tok/s avg)`
      );

      console.log('========== RAW LLM OUTPUT ==========');
      console.log(completion.text);
      console.log('====================================\n');
      console.log(`[Process] Output length: ${completion.text.length} chars`);

      setProgress(95);
      setStatus('Parsing results...');
      console.log('[Process] Step 4: Parsing LLM output...');

      // Parse LLM output
      const extracted = parseModelOutput(completion.text);

      console.log('========== EXTRACTED FLIGHT ENTRIES ==========');
      console.log(JSON.stringify(extracted, null, 2));
      console.log('==============================================\n');
      console.log(`[Process] Extracted ${extracted.length} flight entries`);

      // Parse and log CSV
      const csv1 = parseAndLogCSV(extracted, 'PROMPT 1');

      setResult({
        ocrData: ocrResult,
        extractedFlights: extracted,
        rawLLMOutput: completion.text,
        csv: csv1,
      });

      setProgress(50);
      setStatus(`First extraction complete! Now trying alternative prompt...`);
      console.log(
        '[Process] First extraction complete! Starting second extraction with alternative prompt...'
      );
      */

      // ========== SECOND LLM CALL WITH ALTERNATIVE PROMPT ==========

      // Use embedded alternative prompt
      console.log('[Process] Step 3: Using alternative prompt...');
      setStatus('Extracting with Qwen3-VL (alternative prompt)...');
      setProgress(50);

      // Build alternative prompt
      const alternativePrompt = `USER:  You are expert in flight log tables, extracting flight log data from 2 facing pages in landscape format. Apply the following template to the images and return the extracted values as JSON.  Use the OCR BOUNDING BOX DATA to understand the rows, columns, and cells to understand what is an empty cell.

      ${ALTERNATIVE_PROMPT}
      `;

      let tokenCount2 = 0;
      let lastLogTime2 = Date.now();
      const llmStartTime2 = Date.now();

      const completion2 = await contextRef.current!.completion(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: alternativePrompt },
                { type: 'image_url', image_url: { url: leftImage } },
                { type: 'image_url', image_url: { url: rightImage } },
              ],
            },
          ],
          n_predict: 8000,
          temperature: 0.1,
          stop: ['</s>', '\n\n\n'],
        },
        (data) => {
          if (data.token) {
            tokenCount2++;
            const progressPercent =
              50 + Math.min((tokenCount2 / 8000) * 50, 50);
            setProgress(progressPercent);

            const now = Date.now();
            if (tokenCount2 % 50 === 0 || now - lastLogTime2 > 5000) {
              const elapsed = ((now - llmStartTime2) / 1000).toFixed(1);
              const tokensPerSec = (
                (tokenCount2 / (now - llmStartTime2)) *
                1000
              ).toFixed(1);
              console.log(
                `[Process] LLM progress: ${tokenCount2} tokens in ${elapsed}s (${tokensPerSec} tok/s)`
              );
              setStatus(
                `Generating... ${tokenCount2} tokens (${tokensPerSec} tok/s)`
              );
              lastLogTime2 = now;
            }
          }
        }
      );

      const llmDuration2 = ((Date.now() - llmStartTime2) / 1000).toFixed(1);
      const avgTokensPerSec2 = (
        (tokenCount2 / (Date.now() - llmStartTime2)) *
        1000
      ).toFixed(1);
      console.log(
        `[Process] LLM2 complete in ${llmDuration2}s: ${tokenCount2} tokens (${avgTokensPerSec2} tok/s avg)`
      );

      console.log('========== RAW LLM OUTPUT ==========');
      console.log(completion2.text);
      console.log('====================================\n');

      setProgress(95);
      setStatus('Parsing results...');
      console.log('[Process] Step 4: Parsing LLM output...');

      const extracted2 = parseModelOutput(completion2.text);

      console.log('========== EXTRACTED FLIGHT ENTRIES ==========');
      console.log(JSON.stringify(extracted2, null, 2));
      console.log('==============================================\n');
      console.log(`[Process] Extracted ${extracted2.length} flight entries`);

      // Parse and log CSV for second prompt
      const csv2 = parseAndLogCSV(extracted2, 'ALTERNATIVE PROMPT');

      setResult2({
        ocrData: ocrResult,
        extractedFlights: extracted2,
        rawLLMOutput: completion2.text,
        csv: csv2,
      });

      setProgress(100);
      setStatus(`Complete! Extracted ${extracted2.length} flights`);
      console.log('[Process] Extraction complete!');
    } catch (error: any) {
      console.error('[Process] ERROR:', error);
      Alert.alert('Error', error.message);
      setStatus('Error occurred');
    } finally {
      setIsProcessing(false);
      processingRef.current = false;
      setBackgroundWarning(false);
    }
  };

  const formatOCRForLLM = (ocrResult: any): string => {
    const leftHeaders = ocrResult.leftTable.columns
      .map(
        (col: any, idx: number) =>
          `Col${idx}: ${col.cells[0]?.value || 'UNKNOWN'}`
      )
      .join(', ');

    const rightHeaders = ocrResult.rightTable.columns
      .map(
        (col: any, idx: number) =>
          `Col${idx}: ${col.cells[0]?.value || 'UNKNOWN'}`
      )
      .join(', ');

    let summary = `LEFT PAGE STRUCTURE:\n`;
    summary += `Columns (${ocrResult.leftTable.columnCount}): ${leftHeaders}\n`;
    summary += `Rows: ${ocrResult.leftTable.rowCount}\n\n`;

    summary += `RIGHT PAGE STRUCTURE:\n`;
    summary += `Columns (${ocrResult.rightTable.columnCount}): ${rightHeaders}\n`;
    summary += `Rows: ${ocrResult.rightTable.rowCount}\n\n`;

    summary += `CELL GRID (first 5 rows):\n`;
    for (let row = 1; row < Math.min(6, ocrResult.leftTable.rowCount); row++) {
      const leftCells = ocrResult.cellData.left
        .filter((c: any) => c.row === row)
        .sort((a: any, b: any) => a.column - b.column)
        .map((c: any) => c.value || '""')
        .join(' | ');

      const rightCells = ocrResult.cellData.right
        .filter((c: any) => c.row === row)
        .sort((a: any, b: any) => a.column - b.column)
        .map((c: any) => c.value || '""')
        .join(' | ');

      summary += `Row ${row}: ${leftCells} || ${rightCells}\n`;
    }

    return summary;
  };

  const parseModelOutput = (text: string): any[] => {
    try {
      // Remove markdown code fences if present
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

      const jsonMatch = cleanedText.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
    return [];
  };

  const shareResults = async () => {
    if (!result2) return;

    try {
      const csv = convertToCSV(result2.extractedFlights);
      const file = new File(Paths.cache, `flight-log-${Date.now()}.csv`);
      await file.write(csv);
      await Sharing.shareAsync(file.uri);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const shareDetailedResults = async () => {
    if (!result2) return;

    try {
      // Create comprehensive report
      let report = '========== FLIGHT LOG EXTRACTION REPORT ==========\n\n';

      report += '=== SUMMARY ===\n';
      report += `Extraction Date: ${new Date().toLocaleString()}\n`;
      report += `Flights Extracted: ${result2.extractedFlights.length}\n`;
      report += `OCR Cells Detected: ${result2.ocrData.metadata.totalCells}\n`;
      report += `Left Page Columns: ${result2.ocrData.leftTable.columnCount}\n`;
      report += `Right Page Columns: ${result2.ocrData.rightTable.columnCount}\n\n`;

      report += '=== RAW OCR RESULTS ===\n';
      report += 'LEFT PAGE STRUCTURE:\n';
      report += JSON.stringify(result2.ocrData.leftTable, null, 2) + '\n\n';
      report += 'RIGHT PAGE STRUCTURE:\n';
      report += JSON.stringify(result2.ocrData.rightTable, null, 2) + '\n\n';

      report += 'LEFT PAGE CELLS (first 30):\n';
      report +=
        JSON.stringify(result2.ocrData.cellData.left.slice(0, 30), null, 2) +
        '\n\n';
      report += 'RIGHT PAGE CELLS (first 30):\n';
      report +=
        JSON.stringify(result2.ocrData.cellData.right.slice(0, 30), null, 2) +
        '\n\n';

      report += '========== ALTERNATIVE PROMPT EXTRACTION ==========\n\n';

      report += '=== EXTRACTED FLIGHTS WITH REASONING ===\n';
      result2.extractedFlights.forEach((flight: any, idx: number) => {
        report += `\nFlight ${idx + 1}:\n`;
        report += JSON.stringify(flight, null, 2) + '\n';
      });
      report += '\n';

      report += '=== RAW LLM OUTPUT ===\n';
      report += result2.rawLLMOutput + '\n\n';

      report += '=== CSV FORMAT ===\n';
      report += convertToCSV(result2.extractedFlights) + '\n';

      report += '========== END REPORT ==========\n';
      report += convertToCSV(result.extractedFlights) + '\n';

      if (result2) {
        report +=
          '\n========== PROMPT 2: ALTERNATIVE (prompt.txt) ==========\n\n';

        report += '=== EXTRACTED FLIGHTS WITH REASONING (PROMPT 2) ===\n';
        result2.extractedFlights.forEach((flight: any, idx: number) => {
          report += `\nFlight ${idx + 1}:\n`;
          report += JSON.stringify(flight, null, 2) + '\n';
        });
        report += '\n';

        report += '=== RAW LLM OUTPUT (PROMPT 2) ===\n';
        report += result2.rawLLMOutput + '\n\n';

        report += '=== CSV FORMAT (PROMPT 2) ===\n';
        report += convertToCSV(result2.extractedFlights) + '\n';
      }

      report += '========== END REPORT ==========\n';

      // Save to file and share
      const file = new File(Paths.cache, `flight-log-${Date.now()}.txt`);
      await file.write(report);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        dialogTitle: 'Share Flight Log Report',
      });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const convertToCSV = (flights: any[]): string => {
    const headers = [
      'DATE',
      'AIRCRAFT',
      'IDENT',
      'ROUTE',
      'TOTAL',
      'SEL',
      'SES',
      'MEL',
      'TURBOJET',
      'HELI',
      'GLIDER',
      'TURBOPROP',
      'CUSTOM3',
      'DAY_LDG',
      'NIGHT_LDG',
      'NIGHT',
      'INST',
      'SIM_INST',
      'APPROACHES',
      'APP_TYPE',
      'FLIGHT_SIM',
      'XC',
      'SOLO',
      'PIC',
      'SIC',
      'DUAL',
      'CFI',
      'REMARKS',
    ];

    let csv = headers.join(',') + '\n';

    flights.forEach((flight) => {
      const row = headers.map((h) => {
        const key = h.toLowerCase().replace(/_/g, '');
        // Handle nested structure with reasoning (e.g., {value: "...", confidence: 0.9, reasoning: "..."})
        const fieldData = flight[key];
        if (
          fieldData &&
          typeof fieldData === 'object' &&
          'value' in fieldData
        ) {
          // Extract value from nested structure
          const val = fieldData.value;
          // Escape commas and quotes in CSV
          if (
            typeof val === 'string' &&
            (val.includes(',') || val.includes('"'))
          ) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val ?? '';
        }
        // Handle simple value
        const val = fieldData;
        if (
          typeof val === 'string' &&
          (val.includes(',') || val.includes('"'))
        ) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val ?? '';
      });
      csv += row.join(',') + '\n';
    });

    return csv;
  };

  const parseAndLogCSV = (flights: any[], promptLabel: string): string => {
    const csv = convertToCSV(flights);
    console.log(`========== CSV OUTPUT (${promptLabel}) ==========`);
    console.log(csv);
    console.log('==============================================\n');
    return csv;
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Hybrid Flight Log Extractor</Text>
          <TouchableOpacity onPress={() => setShowModelPicker(true)}>
            <Text style={styles.settingsButton}>⚙️</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>Vision OCR + Qwen3-VL</Text>
        <Text style={styles.status}>{status}</Text>
      </View>

      {backgroundWarning && (
        <View style={styles.backgroundWarning}>
          <Text style={styles.backgroundWarningText}>
            ⚠️ App is in background. Processing may be slower or paused. Keep
            app in foreground for best performance.
          </Text>
        </View>
      )}

      {!modelReady && (
        <View style={styles.modelWarning}>
          <Text style={styles.warningText}>
            ⚠️ Model not loaded. Tap ⚙️ to download Qwen3-VL-2B model.
          </Text>
        </View>
      )}

      <View style={styles.imageSection}>
        <View style={styles.imageContainer}>
          <Text style={styles.imageLabel}>Left Page</Text>
          {leftImage ? (
            <Image source={{ uri: leftImage }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderText}>No image</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.button}
            onPress={() => pickImage('left')}
          >
            <Text style={styles.buttonText}>
              {leftImage ? 'Change' : 'Select'} Left
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.imageContainer}>
          <Text style={styles.imageLabel}>Right Page</Text>
          {rightImage ? (
            <Image source={{ uri: rightImage }} style={styles.image} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderText}>No image</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.button}
            onPress={() => pickImage('right')}
          >
            <Text style={styles.buttonText}>
              {rightImage ? 'Change' : 'Select'} Right
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {isProcessing && (
        <View style={styles.progressSection}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.progressText}>{Math.round(progress)}%</Text>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.processButton,
          (!leftImage || !rightImage || !modelReady || isProcessing) &&
            styles.buttonDisabled,
        ]}
        onPress={processImages}
        disabled={!leftImage || !rightImage || !modelReady || isProcessing}
      >
        <Text style={styles.processButtonText}>
          {isProcessing ? 'Processing...' : 'Extract Flight Data'}
        </Text>
      </TouchableOpacity>

      {result && (
        <View style={styles.resultsSection}>
          <Text style={styles.resultsTitle}>Results - Comparison</Text>

          <View style={styles.statsCard}>
            <Text style={styles.statsText}>
              Prompt 1 (Current): {result.extractedFlights.length} flights
            </Text>
            {result2 && (
              <Text style={styles.statsText}>
                Prompt 2 (Alternative): {result2.extractedFlights.length}{' '}
                flights
              </Text>
            )}
            <Text style={styles.statsText}>
              OCR cells detected: {result.ocrData.metadata.totalCells}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>
            📋 Prompt 1: Current System Prompt
          </Text>

          <View style={styles.dataPreview}>
            <Text style={styles.previewTitle}>
              Extracted Flights (first 3):
            </Text>
            <ScrollView style={styles.previewScroll}>
              <Text style={styles.previewText}>
                {JSON.stringify(result.extractedFlights.slice(0, 3), null, 2)}
              </Text>
            </ScrollView>
          </View>

          <View style={styles.dataPreview}>
            <Text style={styles.previewTitle}>Raw LLM Output:</Text>
            <ScrollView style={styles.previewScroll}>
              <Text style={styles.previewText}>{result.rawLLMOutput}</Text>
            </ScrollView>
          </View>

          {result.csv && (
            <View style={styles.dataPreview}>
              <Text style={styles.previewTitle}>
                CSV Format (first 5 rows):
              </Text>
              <ScrollView style={styles.previewScroll}>
                <Text style={styles.previewText}>
                  {result.csv.split('\n').slice(0, 6).join('\n')}
                </Text>
              </ScrollView>
            </View>
          )}

          {result2 && (
            <>
              <Text style={styles.sectionTitle}>
                📋 Prompt 2: Alternative (prompt.txt)
              </Text>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  Extracted Flights (first 3):
                </Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>
                    {JSON.stringify(
                      result2.extractedFlights.slice(0, 3),
                      null,
                      2
                    )}
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>Raw LLM Output:</Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>{result2.rawLLMOutput}</Text>
                </ScrollView>
              </View>

              {result2.csv && (
                <View style={styles.dataPreview}>
                  <Text style={styles.previewTitle}>
                    CSV Format (first 5 rows):
                  </Text>
                  <ScrollView style={styles.previewScroll}>
                    <Text style={styles.previewText}>
                      {result2.csv.split('\n').slice(0, 6).join('\n')}
                    </Text>
                  </ScrollView>
                </View>
              )}
            </>
          )}

          <View style={styles.shareButtonsRow}>
            <TouchableOpacity
              style={[styles.shareButton, styles.shareButtonHalf]}
              onPress={shareResults}
            >
              <Text style={styles.shareButtonText}>📤 CSV (P1)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareButton, styles.shareButtonHalf]}
              onPress={shareDetailedResults}
            >
              <Text style={styles.shareButtonText}>📋 Full Report</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Model Picker Modal */}
      <Modal visible={showModelPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Model</Text>

            {MODELS.map((model) => {
              const isDownloaded = downloadedModels.includes(model.id);
              const isSelected = selectedModel?.id === model.id;
              const isCurrentlyDownloading = isDownloading && !isDownloaded;

              return (
                <View
                  key={model.id}
                  style={[
                    styles.modelOption,
                    isSelected && styles.modelOptionSelected,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.modelOptionMain}
                    onPress={async () => {
                      if (isCurrentlyDownloading) return;
                      setShowModelPicker(false);
                      if (isDownloaded) {
                        await loadModel(model);
                      } else {
                        await downloadModel(model);
                      }
                    }}
                  >
                    <View style={styles.modelInfo}>
                      <Text style={styles.modelName}>{model.name}</Text>
                      <Text style={styles.modelSize}>{model.size}</Text>
                    </View>
                    <Text style={styles.modelStatus}>
                      {isCurrentlyDownloading
                        ? `Downloading... ${Math.round(downloadProgress * 100)}%`
                        : isSelected
                          ? '✓ Active'
                          : isDownloaded
                            ? 'Downloaded'
                            : 'Tap to download'}
                    </Text>
                  </TouchableOpacity>
                  {isDownloaded && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => {
                        setShowModelPicker(false);
                        deleteModel(model);
                      }}
                    >
                      <Text style={styles.deleteButtonText}>🗑️</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowModelPicker(false)}
            >
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#2a2a2a',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  settingsButton: {
    fontSize: 28,
    color: 'white',
  },
  subtitle: {
    fontSize: 14,
    color: '#4CAF50',
    marginBottom: 8,
  },
  status: {
    fontSize: 12,
    color: '#999',
  },
  modelWarning: {
    margin: 20,
    padding: 16,
    backgroundColor: '#ff9800',
    borderRadius: 8,
  },
  warningText: {
    color: 'white',
    fontSize: 14,
  },
  backgroundWarning: {
    margin: 20,
    marginTop: 0,
    padding: 16,
    backgroundColor: '#FF5722',
    borderRadius: 8,
  },
  backgroundWarningText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  imageSection: {
    flexDirection: 'row',
    padding: 20,
    gap: 16,
  },
  imageContainer: {
    flex: 1,
  },
  imageLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#333',
    marginBottom: 12,
  },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#555',
    borderStyle: 'dashed',
  },
  placeholderText: {
    color: '#666',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  progressSection: {
    padding: 20,
    alignItems: 'center',
  },
  progressText: {
    color: 'white',
    fontSize: 18,
    marginTop: 12,
  },
  processButton: {
    margin: 20,
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#666',
  },
  processButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resultsSection: {
    padding: 20,
  },
  resultsTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF9800',
    marginTop: 20,
    marginBottom: 12,
  },
  statsCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  statsText: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 6,
  },
  dataPreview: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  previewTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  previewScroll: {
    maxHeight: 200,
  },
  previewText: {
    color: '#ccc',
    fontFamily: 'Courier',
    fontSize: 11,
  },
  shareButton: {
    backgroundColor: '#FF9800',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  shareButtonHalf: {
    flex: 1,
  },
  shareButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
    textAlign: 'center',
  },
  modelOption: {
    flexDirection: 'row',
    backgroundColor: '#333',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  modelOptionSelected: {
    backgroundColor: '#4CAF50',
  },
  modelOptionMain: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  modelSize: {
    color: '#999',
    fontSize: 12,
  },
  modelStatus: {
    color: '#ccc',
    fontSize: 12,
    marginLeft: 12,
  },
  deleteButton: {
    backgroundColor: '#d32f2f',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  deleteButtonText: {
    fontSize: 20,
  },
  modalCloseButton: {
    backgroundColor: '#555',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCloseButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
