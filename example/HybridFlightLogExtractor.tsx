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
import { DualImageRecognizer, DocumentRecognizer } from 'react-native-vision-camera-ocr';

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

// Helper function to extract a text column (like DATE, AIRCRAFT MAKE, etc.)
async function extractTextColumn(
  columnName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  leftImage: string,
  pixelThreshold: number = 1200
) {
  const ROW_SPACING = 36.25;
  const CROP_Y = 96;
  
  console.log(`[Process] Extracting ${columnName} column...`);
  console.log(`  Column: x=${x}, y=${y}, width=${width}`);

  // Crop the entire column for Vision OCR (start slightly above first data cell to include grid lines)
  const cropX = x - 5; // Expand left to include left grid line
  const cropWidth = width + 20; // Expand right to include right grid line (10 pixels on each side)
  const lastRowY = y + (13 * ROW_SPACING);
  const columnHeight = (lastRowY + height + 10) - CROP_Y;
  
  const columnBbox = {
    originX: cropX,
    originY: CROP_Y, // Start at Y=96 like DATE column
    width: cropWidth,
    height: columnHeight,
  };

  const croppedColumn = await ImageManipulator.manipulateAsync(
    leftImage,
    [{ crop: columnBbox }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );

  // Run Vision OCR on the cropped column
  const columnOCR = await DocumentRecognizer({
    uri: croppedColumn.uri,
    searchCells: [],
  });

  console.log(`  Vision detected: ${columnOCR.tables?.length || 0} tables`);

  const extractions: any[] = [];

  // Extract each of the 14 rows
  for (let i = 0; i < 14; i++) {
    const rowNum = i + 1;
    const cellY = y + (i * ROW_SPACING);

    try {
      // Crop the cell
      const cellBbox = {
        originX: x,
        originY: cellY,
        width: width,
        height: height,
      };

      const croppedCell = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: cellBbox }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      // Analyze pixels
      let fileSize = 0;
      try {
        const imageInfo = await LegacyFileSystem.getInfoAsync(croppedCell.uri);
        if (imageInfo.exists) {
          fileSize = (imageInfo as any).size || 0;
        }
      } catch (error: any) {
        // Ignore
      }

      // Try to match Vision text by Y position
      const cellYInCroppedImage = cellY - CROP_Y; // Offset from start of cropped image
      let visionText = '';
      let visionRow = -1;
      let visionColumn = -1;
      let visionConfidence = 0;
      let matchedByVision = false;

      if (columnOCR.tables && columnOCR.tables.length > 0) {
        const table = columnOCR.tables[0];
        for (const column of table.columns || []) {
          for (const cell of column.cells || []) {
            if (cell.boundingBox && cell.text && cell.text.trim()) {
              const visionCellY = cell.boundingBox.yMin;
              const yDiff = Math.abs(visionCellY - cellYInCroppedImage);
              
              if (yDiff < 20) { // 20px threshold like DATE
                visionText = cell.text.trim();
                visionRow = cell.rowIndex;
                visionColumn = cell.columnIndex;
                visionConfidence = cell.confidence || 0;
                matchedByVision = true;
                break;
              }
            }
          }
          if (matchedByVision) break;
        }
      }

      // Determine if cell has content (Vision OR pixel analysis)
      const pixelFallback = !matchedByVision && fileSize > pixelThreshold;
      const hasContent = matchedByVision || pixelFallback;
      
      const detectionMethod = matchedByVision ? 'Vision' : (pixelFallback ? 'Pixels' : 'None');

      extractions.push({
        row: rowNum,
        column: columnName,
        text: visionText,
        hasContent: hasContent,
        fileSize: fileSize,
        confidence: visionConfidence,
        matchedByPosition: matchedByVision,
        hasContentByPixels: pixelFallback,
        detectionMethod: detectionMethod,
        boundingBox: { x: x, y: cellY, width: width, height: height },
        croppedImageUri: croppedCell.uri,
        visionRow: visionRow,
        visionColumn: visionColumn,
      });
    } catch (error: any) {
      extractions.push({
        row: rowNum,
        column: columnName,
        hasContent: false,
        error: error.message,
      });
    }
  }

  console.log(`  ${columnName}: ${extractions.filter((c: any) => c.hasContent).length}/14 cells with content`);

  return {
    extractions,
    croppedColumnUri: croppedColumn.uri,
    columnBbox,
    ocrResult: {
      tablesCount: columnOCR.tables?.length || 0,
      rowCount: columnOCR.tables?.[0]?.rowCount || 0,
      columnCount: columnOCR.tables?.[0]?.columnCount || 0,
      rawText: columnOCR.rawText,
    },
  };
}

// Helper function to extract a flight duration column
async function extractFlightDurationColumn(
  columnName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  leftImage: string,
  pixelThreshold: number = 5800
) {
  const ROW_SPACING = 36.25;
  const CROP_Y = 96;
  
  // Sub-columns (estimate: ~65% for hours, ~35% for tenths)
  const sub1Width = Math.floor(width * 0.65);
  const sub2Width = width - sub1Width - 1;
  const sub1X = x;
  const sub2X = x + sub1Width + 1;

  console.log(`[Process] Extracting ${columnName} column...`);
  console.log(`  Full column: x=${x}, y=${y}, width=${width}`);

  // Crop the entire column for Vision OCR
  const cropX = x - 7;
  const cropWidth = width + 20;
  const lastRowY = y + (13 * ROW_SPACING);
  const columnHeight = (lastRowY + height + 10) - CROP_Y;
  
  const columnBbox = {
    originX: cropX,
    originY: CROP_Y,
    width: cropWidth,
    height: columnHeight,
  };

  const croppedColumn = await ImageManipulator.manipulateAsync(
    leftImage,
    [{ crop: columnBbox }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );

  // Run Vision OCR on the cropped column
  const columnOCR = await DocumentRecognizer({
    uri: croppedColumn.uri,
    searchCells: [],
  });

  console.log(`  Vision detected: ${columnOCR.tables?.length || 0} tables`);

  const extractions: any[] = [];

  // Extract each of the 14 rows
  for (let i = 0; i < 14; i++) {
    const rowNum = i + 1;
    const cellY = y + (i * ROW_SPACING);

    try {
      // Crop the full cell
      const fullCellBbox = {
        originX: x,
        originY: cellY,
        width: width,
        height: height,
      };

      const croppedFullCell = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: fullCellBbox }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      // Analyze pixels
      let fileSize = 0;
      try {
        const imageInfo = await LegacyFileSystem.getInfoAsync(croppedFullCell.uri);
        if (imageInfo.exists) {
          fileSize = (imageInfo as any).size || 0;
        }
      } catch (error: any) {
        // Ignore
      }

      // Crop sub-columns
      const croppedSub1 = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: { originX: sub1X, originY: cellY, width: sub1Width, height: height } }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      const croppedSub2 = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: { originX: sub2X, originY: cellY, width: sub2Width, height: height } }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      // STEP 1: Try to match Vision text by Y position
      const cellYInCroppedImage = cellY - CROP_Y;
      let visionText = '';
      let visionRow = -1;
      let visionColumn = -1;
      let visionConfidence = 0;
      let matchedByVision = false;

      if (columnOCR.tables && columnOCR.tables.length > 0) {
        const table = columnOCR.tables[0];
        for (const column of table.columns || []) {
          for (const cell of column.cells || []) {
            if (cell.boundingBox && cell.text && cell.text.trim()) {
              const visionCellY = cell.boundingBox.yMin;
              const visionCellHeight = cell.boundingBox.yMax - cell.boundingBox.yMin;
              const yDiff = Math.abs(visionCellY - cellYInCroppedImage);
              
              if (visionCellHeight <= 50 && yDiff < 10) {
                visionText = cell.text.trim();
                visionRow = cell.rowIndex;
                visionColumn = cell.columnIndex;
                visionConfidence = cell.confidence || 0;
                matchedByVision = true;
                break;
              }
            }
          }
          if (matchedByVision) break;
        }
      }

      // STEP 2: Try OCR on individual cell
      let cellHasVisionText = false;
      let cellVisionText = '';
      
      try {
        const cellOCR = await DocumentRecognizer({
          uri: croppedFullCell.uri,
          searchCells: [],
        });
        
        if (cellOCR.rawText && cellOCR.rawText.trim().length > 0) {
          const cleanText = cellOCR.rawText.trim();
          const isRealContent = cleanText.length > 0 && !cleanText.match(/^[|\-_\s]+$/);
          
          if (isRealContent) {
            cellHasVisionText = true;
            cellVisionText = cleanText;
          }
        }
      } catch (error: any) {
        // Ignore
      }

      if (cellHasVisionText && !matchedByVision) {
        visionText = cellVisionText;
        matchedByVision = true;
      }

      // STEP 3: Determine if cell has content
      const pixelFallback = !cellHasVisionText && !matchedByVision && fileSize > pixelThreshold;
      const hasContent = cellHasVisionText || matchedByVision || pixelFallback;
      
      const detectionMethod = cellHasVisionText ? 'Individual Cell OCR' : 
                             (matchedByVision ? 'Column Y-Position Match' : 
                             (pixelFallback ? 'Pixel Fallback' : 'None'));

      extractions.push({
        row: rowNum,
        column: columnName,
        hasContent: hasContent,
        fileSize: fileSize,
        visionText: visionText,
        visionRow: visionRow,
        visionColumn: visionColumn,
        visionConfidence: visionConfidence,
        matchedByVision: matchedByVision,
        cellHasVisionText: cellHasVisionText,
        detectionMethod: detectionMethod,
        boundingBox: { x: x, y: cellY, width: width, height: height },
        croppedImageUri: croppedFullCell.uri,
        croppedSub1Uri: croppedSub1.uri,
        croppedSub2Uri: croppedSub2.uri,
      });
    } catch (error: any) {
      extractions.push({
        row: rowNum,
        column: columnName,
        hasContent: false,
        error: error.message,
      });
    }
  }

  console.log(`  ${columnName}: ${extractions.filter((c: any) => c.hasContent).length}/14 cells with content`);

  return {
    extractions,
    croppedColumnUri: croppedColumn.uri,
    columnBbox,
    ocrResult: {
      tablesCount: columnOCR.tables?.length || 0,
      rowCount: columnOCR.tables?.[0]?.rowCount || 0,
      columnCount: columnOCR.tables?.[0]?.columnCount || 0,
      rawText: columnOCR.rawText,
    },
  };
}

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
        // Don't resize - use original dimensions to match coordinate system
        if (side === 'left') {
          setLeftImage(pickerResult.assets[0].uri);
        } else {
          setRightImage(pickerResult.assets[0].uri);
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

      // ========== EXTRACT DATE COLUMN FROM TABLE STRUCTURE ==========
      console.log('[Process] Step 2: Extracting DATE column cells...');
      setStatus('Finding DATE header...');
      setProgress(40);

      // Find the leftmost cell in the header row (row 0) - this should be DATE
      const headerCells = ocrResult.cellData.left.filter((cell: any) => cell.row === 0);
      if (headerCells.length === 0) {
        throw new Error('No header cells found');
      }
      
      // Sort by X position and take the leftmost
      const dateHeader = headerCells.sort((a: any, b: any) => 
        a.boundingBox.x - b.boundingBox.x
      )[0];

      console.log('[Process] Found leftmost header cell (DATE):', {
        text: dateHeader.value,
        row: dateHeader.row,
        column: dateHeader.column,
        bbox: dateHeader.boundingBox,
      });

      // Your actual coordinates from original document (973x724):
      // Header Cell: 14,49,58,49
      // Row 1 Cell:  14,102,58,32
      // Row 2 Cell:  14,138,57,33
      // Row 3 Cell:  14,176,57,32
      // ...
      // Row 14 Cell: 14,573,58,31
      
      // Final optimized dimensions:
      // - X position: 11 pixels
      // - Width: 63 pixels
      // - Y position: 98 pixels
      // - Cell height: 40 pixels
      // - Row spacing: 36.25 pixels
      const COLUMN_LEFT = 11;
      const CELL_WIDTH = 63;
      const CELL_HEIGHT = 40;
      const FIRST_ROW_Y = 98;
      const ROW_SPACING = 36.25;
      
      console.log('[Process] Creating 14 date cell bounding boxes...');
      console.log(`  Using original image coordinates (973x724)`);
      console.log(`  Column left: ${COLUMN_LEFT}`);
      console.log(`  Cell dimensions: ${CELL_WIDTH}x${CELL_HEIGHT}`);
      console.log(`  First row Y: ${FIRST_ROW_Y}`);
      console.log(`  Row spacing: ${ROW_SPACING}px`);

      setStatus('Cropping entire DATE column...');
      setProgress(50);

      // Calculate the bounding box for the entire DATE column (all 14 rows)
      // Start with first data cell (not header) to avoid multi-line header confusion
      const EXPAND_BOTTOM = 10; // Expand bottom to capture bottom grid line
      
      const lastRowY = FIRST_ROW_Y + (13 * ROW_SPACING); // Row 14 (index 13)
      const columnHeight = (lastRowY + CELL_HEIGHT + EXPAND_BOTTOM) - FIRST_ROW_Y;
      
      // Start from first data cell, not the header
      const fullColumnBbox = {
        originX: 7, // Shift left to x=7
        originY: FIRST_ROW_Y, // Start at first data cell (row 1)
        width: 80, // Wider to help Vision detect table
        height: columnHeight,
      };
      
      console.log('[Process] Column bbox (starting at first data cell, not header):');
      console.log(`  X: ${fullColumnBbox.originX}, Y: ${fullColumnBbox.originY} (first data cell)`);
      console.log(`  Width: ${fullColumnBbox.width}, Height: ${fullColumnBbox.height}`);
      console.log(`  Excludes header to avoid multi-line confusion`);

      console.log('[Process] Full DATE column bbox (with header and grid lines):', fullColumnBbox);
      console.log(`  Includes header, covers rows 1-14, total height: ${columnHeight}px`);

      // Crop the entire DATE column
      const croppedColumn = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: fullColumnBbox }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      console.log('[Process] Cropped DATE column image:', croppedColumn.uri);
      setStatus('Running Vision OCR on DATE column...');
      setProgress(60);

      // Run Vision OCR on the cropped DATE column
      const columnOCR = await DocumentRecognizer({
        uri: croppedColumn.uri,
        searchCells: [],
      });

      console.log('========== DATE COLUMN OCR RESULTS ==========');
      console.log('Full OCR result:', JSON.stringify(columnOCR, null, 2));
      console.log('Tables detected:', columnOCR.tables?.length || 0);
      if (columnOCR.tables && columnOCR.tables.length > 0) {
        const table = columnOCR.tables[0];
        console.log(`Table structure: ${table.rowCount} rows x ${table.columnCount} columns`);
        console.log('Table data:', JSON.stringify(table, null, 2));
      }
      console.log('Cell confidences:', columnOCR.cellConfidences?.length || 0);
      if (columnOCR.cellConfidences && columnOCR.cellConfidences.length > 0) {
        console.log('Cell confidences data:', JSON.stringify(columnOCR.cellConfidences, null, 2));
      }
      console.log('Raw text length:', columnOCR.rawText?.length || 0);
      console.log('Raw text:', columnOCR.rawText);
      console.log('Matched cells:', columnOCR.matchedCells?.length || 0);
      console.log('Column data:', columnOCR.columnData?.length || 0);
      console.log('============================================\n');

      setStatus('Extracting 14 date cells...');
      setProgress(70);

      const dateExtractions: any[] = [];

      // Extract text from the column OCR results
      let columnTexts: Array<{text: string, row: number, column: number, confidence: number}> = [];
      
      console.log('[Process] Analyzing Vision OCR results...');
      console.log(`  Tables: ${columnOCR.tables?.length || 0}`);
      console.log(`  Cell confidences: ${columnOCR.cellConfidences?.length || 0}`);
      console.log(`  Raw text: ${columnOCR.rawText ? 'present' : 'empty'}`);
      
      if (columnOCR.tables && columnOCR.tables.length > 0) {
        const table = columnOCR.tables[0];
        console.log('[Process] Extracting from table structure...');
        console.log(`  Table has ${table.rowCount} rows x ${table.columnCount} columns`);
        console.log(`  Vision detected ${table.rowCount} rows, but we need 14 rows`);
        console.log(`  This likely means Vision couldn't read some handwritten dates`);
        
        // Get all cells from the table
        table.columns?.forEach((column: any) => {
          console.log(`  Column ${column.columnIndex} has ${column.cells?.length || 0} cells`);
          column.cells?.forEach((cell: any) => {
            console.log(`    Cell [${cell.rowIndex},${cell.columnIndex}]: "${cell.text}" (bbox: ${JSON.stringify(cell.boundingBox)})`);
            if (cell.text && cell.text.trim()) {
              columnTexts.push({
                text: cell.text.trim(),
                row: cell.rowIndex,
                column: cell.columnIndex,
                confidence: cell.confidence || 0,
              });
            }
          });
        });
        
        // If Vision detected fewer rows than expected, we need to map them to our 14 logical rows
        // We'll use the Y positions of Vision's detected cells to figure out which of our 14 rows they correspond to
        console.log(`[Process] Mapping Vision's ${table.rowCount} detected rows to our 14 logical rows...`);
      } else if (columnOCR.cellConfidences && columnOCR.cellConfidences.length > 0) {
        console.log('[Process] Extracting from cellConfidences...');
        columnOCR.cellConfidences.forEach((cell: any) => {
          if (cell.text && cell.text.trim()) {
            console.log(`  Cell [${cell.rowIndex},${cell.columnIndex}]: "${cell.text}" (conf: ${cell.confidence})`);
            columnTexts.push({
              text: cell.text.trim(),
              row: cell.rowIndex,
              column: cell.columnIndex,
              confidence: cell.confidence,
            });
          }
        });
      } else if (columnOCR.rawText && columnOCR.rawText.trim()) {
        console.log('[Process] Extracting from rawText (no table structure detected)...');
        const lines = columnOCR.rawText.split(/[\n\r]+/).filter((l: string) => l.trim());
        console.log(`  Found ${lines.length} text lines`);
        lines.forEach((line: string, idx: number) => {
          console.log(`  Line ${idx}: "${line.trim()}"`);
          columnTexts.push({
            text: line.trim(),
            row: idx,
            column: 0,
            confidence: 0,
          });
        });
      } else {
        console.log('[Process] WARNING: No text data found in Vision OCR result!');
      }

      console.log(`[Process] Found ${columnTexts.length} text items in DATE column`);
      console.log('Column texts:', JSON.stringify(columnTexts, null, 2));

      // Now create our 14 date cells with individual crops and Vision mapping
      // Since Vision may detect fewer rows than 14, we need to map based on Y position
      for (let i = 0; i < 14; i++) {
        const rowNum = i + 1;
        const cellY = FIRST_ROW_Y + (i * ROW_SPACING);
        
        console.log(`[Process] Processing date cell ${rowNum}/14 (Y=${cellY})...`);

        try {
          // Create bounding box for this cell
          const cellBbox = {
            originX: COLUMN_LEFT,
            originY: cellY,
            width: CELL_WIDTH,
            height: CELL_HEIGHT,
          };

          // Crop this specific cell for visual verification and pixel analysis
          const croppedCell = await ImageManipulator.manipulateAsync(
            leftImage,
            [{ crop: cellBbox }],
            { compress: 1, format: ImageManipulator.SaveFormat.PNG }
          );

          // Analyze pixels to detect if cell has content (handwriting)
          // We'll check if there are enough dark pixels to indicate ink
          let hasContentByPixels = false;
          let darkPixelPercentage = 0;
          
          try {
            // Get image data to analyze pixels
            const imageInfo = await LegacyFileSystem.getInfoAsync(croppedCell.uri);
            if (imageInfo.exists) {
              // For now, we'll use a simple heuristic based on file size
              // A cell with handwriting will have more data than an empty cell
              // This is a rough approximation - ideally we'd analyze actual pixel data
              const fileSize = (imageInfo as any).size || 0;
              
              // Typical empty cell: ~500-1000 bytes
              // Cell with handwriting: ~1500+ bytes
              // These thresholds may need tuning
              hasContentByPixels = fileSize > 1200;
              darkPixelPercentage = Math.min(100, (fileSize / 2000) * 100);
              
              console.log(`  File size: ${fileSize} bytes -> ${hasContentByPixels ? 'HAS CONTENT' : 'EMPTY'}`);
            }
          } catch (error: any) {
            console.log(`  Could not analyze pixels: ${error.message}`);
            // Fall back to Vision detection
            hasContentByPixels = false;
          }

          // Find the corresponding text from column OCR by matching Y position
          // Vision's bounding boxes are relative to the cropped column image
          // Our cellY is relative to the original image, so we need to adjust
          const cellYInCroppedImage = cellY - FIRST_ROW_Y; // Offset from start of cropped image
          
          let cellText = '';
          let visionRow = -1;
          let visionColumn = -1;
          let confidence = 0;
          let matchedByPosition = false;
          
          // Try to find a Vision cell whose Y position is close to this logical row
          if (columnOCR.tables && columnOCR.tables.length > 0) {
            const table = columnOCR.tables[0];
            for (const column of table.columns || []) {
              for (const cell of column.cells || []) {
                if (cell.boundingBox && cell.text && cell.text.trim()) {
                  // Check if this Vision cell's Y position matches our logical row
                  const visionCellY = cell.boundingBox.yMin;
                  const yDiff = Math.abs(visionCellY - cellYInCroppedImage);
                  
                  // If within 20 pixels, consider it a match
                  if (yDiff < 20) {
                    cellText = cell.text.trim();
                    visionRow = cell.rowIndex;
                    visionColumn = cell.columnIndex;
                    confidence = cell.confidence || 0;
                    matchedByPosition = true;
                    console.log(`  Matched by Y position: Vision cell at Y=${visionCellY} matches our Y=${cellYInCroppedImage} (diff=${yDiff}px)`);
                    break;
                  }
                }
              }
              if (matchedByPosition) break;
            }
          }
          
          // Determine if cell has content: use pixel analysis OR Vision detection
          const hasContent = hasContentByPixels || matchedByPosition;
          
          if (!matchedByPosition && hasContentByPixels) {
            console.log(`  Vision missed this cell, but pixel analysis detected content`);
          } else if (!hasContent) {
            console.log(`  No content detected by Vision or pixel analysis`);
          }

          dateExtractions.push({
            row: rowNum,
            column: 0,
            text: cellText,
            confidence: confidence,
            boundingBox: {
              x: cellBbox.originX,
              y: cellBbox.originY,
              width: cellBbox.width,
              height: cellBbox.height,
            },
            croppedImageUri: croppedCell.uri,
            visionRow: visionRow,
            visionColumn: visionColumn,
            matchedByPosition: matchedByPosition,
            hasContentByPixels: hasContentByPixels,
            hasContent: hasContent,
            darkPixelPercentage: darkPixelPercentage,
          });

          console.log(`  Row ${rowNum}: ${hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (Vision: "${cellText}", Pixels: ${hasContentByPixels})`);
        } catch (error: any) {
          console.error(`  Error processing cell ${rowNum}:`, error.message);
          dateExtractions.push({
            row: rowNum,
            column: 0,
            text: '',
            confidence: 0,
            boundingBox: {
              x: COLUMN_LEFT,
              y: cellY,
              width: CELL_WIDTH,
              height: CELL_HEIGHT,
            },
            error: error.message,
          });
        }

        setProgress(70 + (i / 14) * 25);
      }

      console.log('========== FINAL DATE EXTRACTIONS ==========');
      console.log(JSON.stringify(dateExtractions, null, 2));
      console.log('===========================================\n');

      // ========== EXTRACT TURBOJET COLUMN ==========
      console.log('[Process] Step 3: Extracting TURBOJET column cells...');
      setStatus('Extracting TURBOJET column...');
      setProgress(50);

      // TURBOJET column coordinates from user
      // Full column: x=566, y=101, width=67, height=34
      // Sub-column 1 (hours): x=566, width=44
      // Sub-column 2 (tenths): x=612, width=21
      const TURBOJET_X = 566;
      const TURBOJET_Y = 101; // First row Y
      const TURBOJET_FULL_WIDTH = 67;
      const TURBOJET_CELL_HEIGHT = 34;
      const TURBOJET_ROW_SPACING = 36.25; // Same as DATE column
      
      const TURBOJET_SUB1_X = 566;
      const TURBOJET_SUB1_WIDTH = 44;
      const TURBOJET_SUB2_X = 612;
      const TURBOJET_SUB2_WIDTH = 21;

      console.log('[Process] TURBOJET column has 2 sub-columns:');
      console.log(`  Sub-column 1 (hours): x=${TURBOJET_SUB1_X}, width=${TURBOJET_SUB1_WIDTH}`);
      console.log(`  Sub-column 2 (tenths): x=${TURBOJET_SUB2_X}, width=${TURBOJET_SUB2_WIDTH}`);

      // Crop the entire TURBOJET column for Vision OCR
      // Expand to include grid lines and adjacent columns for better table detection
      const TURBOJET_CROP_Y = 96; // Adjusted for image slant
      const lastTurbojetRowY = TURBOJET_Y + (13 * TURBOJET_ROW_SPACING);
      const turbojetColumnHeight = (lastTurbojetRowY + TURBOJET_CELL_HEIGHT + 10) - TURBOJET_CROP_Y;
      
      const turbojetColumnBbox = {
        originX: TURBOJET_X - 7, // 3 pixels to the right from -10
        originY: TURBOJET_CROP_Y, // Start at Y=96 to account for image slant
        width: TURBOJET_FULL_WIDTH + 30, // Reduced from +50, now only 30 pixels wider
        height: turbojetColumnHeight,
      };

      console.log('[Process] Cropping TURBOJET column (expanded for Vision table detection):', turbojetColumnBbox);
      console.log(`  Original: x=${TURBOJET_X}, y=${TURBOJET_Y}, width=${TURBOJET_FULL_WIDTH}`);
      console.log(`  Expanded: x=${turbojetColumnBbox.originX}, y=${turbojetColumnBbox.originY}, width=${turbojetColumnBbox.width}`);

      const croppedTurbojetColumn = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: turbojetColumnBbox }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      console.log('[Process] Cropped TURBOJET column image:', croppedTurbojetColumn.uri);

      // Run Vision OCR on the cropped TURBOJET column
      const turbojetOCR = await DocumentRecognizer({
        uri: croppedTurbojetColumn.uri,
        searchCells: [],
      });

      console.log('========== TURBOJET COLUMN OCR RESULTS ==========');
      console.log('Tables detected:', turbojetOCR.tables?.length || 0);
      if (turbojetOCR.tables && turbojetOCR.tables.length > 0) {
        const table = turbojetOCR.tables[0];
        console.log(`Table structure: ${table.rowCount} rows x ${table.columnCount} columns`);
        console.log('Table data:', JSON.stringify(table, null, 2));
      }
      console.log('Cell confidences:', turbojetOCR.cellConfidences?.length || 0);
      console.log('Raw text:', turbojetOCR.rawText);
      console.log('=================================================\n');

      // Extract Vision text from TURBOJET column
      let turbojetVisionTexts: Array<{text: string, row: number, column: number, confidence: number}> = [];
      
      if (turbojetOCR.tables && turbojetOCR.tables.length > 0) {
        const table = turbojetOCR.tables[0];
        console.log('[Process] Extracting Vision text from TURBOJET table...');
        
        table.columns?.forEach((column: any) => {
          console.log(`  Column ${column.columnIndex} has ${column.cells?.length || 0} cells`);
          column.cells?.forEach((cell: any) => {
            console.log(`    Cell [${cell.rowIndex},${cell.columnIndex}]: "${cell.text}" (bbox: ${JSON.stringify(cell.boundingBox)})`);
            if (cell.text && cell.text.trim()) {
              turbojetVisionTexts.push({
                text: cell.text.trim(),
                row: cell.rowIndex,
                column: cell.columnIndex,
                confidence: cell.confidence || 0,
              });
            }
          });
        });
      }

      console.log(`[Process] Found ${turbojetVisionTexts.length} Vision text items in TURBOJET column`);

      setStatus('Extracting 14 TURBOJET cells...');
      setProgress(60);

      const turbojetExtractions: any[] = [];

      // Extract each of the 14 rows
      for (let i = 0; i < 14; i++) {
        const rowNum = i + 1;
        const cellY = TURBOJET_Y + (i * TURBOJET_ROW_SPACING);
        
        console.log(`[Process] Processing TURBOJET cell ${rowNum}/14 (Y=${cellY})...`);

        try {
          // Crop the full cell (both sub-columns)
          const fullCellBbox = {
            originX: TURBOJET_X,
            originY: cellY,
            width: TURBOJET_FULL_WIDTH,
            height: TURBOJET_CELL_HEIGHT,
          };

          const croppedFullCell = await ImageManipulator.manipulateAsync(
            leftImage,
            [{ crop: fullCellBbox }],
            { compress: 1, format: ImageManipulator.SaveFormat.PNG }
          );

          // Analyze pixels for full cell using PNG file size as heuristic
          // Cells with handwritten content will have more complex pixel patterns
          let hasContentByPixels = false;
          let fileSize = 0;
          
          try {
            const imageInfo = await LegacyFileSystem.getInfoAsync(croppedFullCell.uri);
            
            if (imageInfo.exists) {
              fileSize = (imageInfo as any).size || 0;
              
              // Empirical thresholds for TURBOJET cells with shaded background:
              // Empty rows: 4256-4796 bytes
              // Content rows: 5586-6525 bytes
              // Borderline rows 8-9: 5399-5400 bytes (actually empty)
              // Set threshold between empty (4796) and real content (5586)
              const CONTENT_THRESHOLD = 5500; // Bytes - raised to avoid false positives on rows 8-9
              
              hasContentByPixels = fileSize > CONTENT_THRESHOLD;
              
              console.log(`  Pixel analysis: ${fileSize} bytes -> ${hasContentByPixels ? 'HAS CONTENT' : 'EMPTY'} (threshold: ${CONTENT_THRESHOLD})`);
            }
          } catch (error: any) {
            console.log(`  Could not analyze pixels: ${error.message}`);
          }

          // Also crop individual sub-columns for visual inspection
          const sub1Bbox = {
            originX: TURBOJET_SUB1_X,
            originY: cellY,
            width: TURBOJET_SUB1_WIDTH,
            height: TURBOJET_CELL_HEIGHT,
          };

          const sub2Bbox = {
            originX: TURBOJET_SUB2_X,
            originY: cellY,
            width: TURBOJET_SUB2_WIDTH,
            height: TURBOJET_CELL_HEIGHT,
          };

          const croppedSub1 = await ImageManipulator.manipulateAsync(
            leftImage,
            [{ crop: sub1Bbox }],
            { compress: 1, format: ImageManipulator.SaveFormat.PNG }
          );

          const croppedSub2 = await ImageManipulator.manipulateAsync(
            leftImage,
            [{ crop: sub2Bbox }],
            { compress: 1, format: ImageManipulator.SaveFormat.PNG }
          );

          // Analyze sub-columns with same approach
          let sub1HasContent = false;
          let sub2HasContent = false;
          let sub1FileSize = 0;
          let sub2FileSize = 0;

          try {
            const sub1Info = await LegacyFileSystem.getInfoAsync(croppedSub1.uri);
            const sub2Info = await LegacyFileSystem.getInfoAsync(croppedSub2.uri);
            
            if (sub1Info.exists) {
              sub1FileSize = (sub1Info as any).size || 0;
              // Sub-column 1 is wider
              // Empty: 2840-3183, Content: 3581-4301
              // Threshold between empty (3183) and content (3581)
              sub1HasContent = sub1FileSize > 3400;
              console.log(`  Sub1 analysis: ${sub1FileSize} bytes -> ${sub1HasContent ? 'HAS CONTENT' : 'EMPTY'}`);
            }
            
            if (sub2Info.exists) {
              sub2FileSize = (sub2Info as any).size || 0;
              // Sub-column 2 is narrower
              // Empty: 1425-1840, Content: 2143-2421
              // Threshold between empty (1840) and content (2143)
              sub2HasContent = sub2FileSize > 2000;
              console.log(`  Sub2 analysis: ${sub2FileSize} bytes -> ${sub2HasContent ? 'HAS CONTENT' : 'EMPTY'}`);
            }
          } catch (error: any) {
            console.log(`  Could not analyze sub-columns: ${error.message}`);
          }

          // STEP 1: Try to match Vision text by Y position from column-level OCR
          const cellYInCroppedImage = cellY - TURBOJET_CROP_Y;
          let visionText = '';
          let visionRow = -1;
          let visionColumn = -1;
          let visionConfidence = 0;
          let matchedByVision = false;

          if (turbojetOCR.tables && turbojetOCR.tables.length > 0) {
            const table = turbojetOCR.tables[0];
            for (const column of table.columns || []) {
              for (const cell of column.cells || []) {
                if (cell.boundingBox && cell.text && cell.text.trim()) {
                  const visionCellY = cell.boundingBox.yMin;
                  const visionCellHeight = cell.boundingBox.yMax - cell.boundingBox.yMin;
                  const yDiff = Math.abs(visionCellY - cellYInCroppedImage);
                  
                  // Reject merged cells - Vision sometimes merges multiple rows
                  // Normal cell height should be around 34-40 pixels
                  // Merged cells can be 100+ pixels tall
                  const MAX_CELL_HEIGHT = 50; // Reject cells taller than this
                  
                  if (visionCellHeight > MAX_CELL_HEIGHT) {
                    console.log(`  Rejecting Vision cell: height=${visionCellHeight}px (merged cell, max=${MAX_CELL_HEIGHT}px)`);
                    continue;
                  }
                  
                  // Very tight threshold for TURBOJET to avoid false matches
                  if (yDiff < 10) {
                    visionText = cell.text.trim();
                    visionRow = cell.rowIndex;
                    visionColumn = cell.columnIndex;
                    visionConfidence = cell.confidence || 0;
                    matchedByVision = true;
                    console.log(`  Matched Vision text: "${visionText}" at Y=${visionCellY} (diff=${yDiff}px, height=${visionCellHeight}px)`);
                    break;
                  }
                }
              }
              if (matchedByVision) break;
            }
          }
          
          if (!matchedByVision) {
            console.log(`  No Vision match found for Y=${cellYInCroppedImage} (threshold: 10px)`);
          }

          // STEP 2: Try OCR on individual cell crop to detect content
          // This avoids the shaded background issue and Vision's row merging
          let cellHasVisionText = false;
          let cellVisionText = '';
          
          try {
            // Run Vision OCR on the individual cell crop
            const cellOCR = await DocumentRecognizer({
              uri: croppedFullCell.uri,
              searchCells: [],
            });
            
            // Check if there's actual text content (not just whitespace or grid lines)
            if (cellOCR.rawText && cellOCR.rawText.trim().length > 0) {
              // Filter out common OCR artifacts from grid lines
              const cleanText = cellOCR.rawText.trim();
              const isRealContent = cleanText.length > 0 && 
                                   !cleanText.match(/^[|\-_\s]+$/); // Not just lines/spaces
              
              if (isRealContent) {
                cellHasVisionText = true;
                cellVisionText = cleanText;
                console.log(`  Individual cell Vision OCR: "${cellVisionText}"`);
              } else {
                console.log(`  Individual cell Vision OCR found only grid lines/artifacts: "${cleanText}"`);
              }
            } else {
              console.log(`  Individual cell Vision OCR: no text found`);
            }
          } catch (error: any) {
            console.log(`  Could not run Vision OCR on individual cell: ${error.message}`);
          }

          // Use individual cell Vision text if available and no column-level match
          if (cellHasVisionText && !matchedByVision) {
            visionText = cellVisionText;
            matchedByVision = true;
            console.log(`  Using individual cell Vision text: "${visionText}"`);
          }

          // STEP 3: Determine if cell has content
          // Primary: Vision OCR (most reliable when it works)
          // Fallback: Pixel analysis for cases where Vision can't read handwriting
          // Use conservative threshold to avoid false positives
          
          // Pixel analysis as fallback: only trust it for clearly high file sizes
          // Empty rows: 4256-4796 bytes
          // Borderline (actually empty): 5399-5400 bytes
          // Clear content: 5586-6525 bytes
          // Use threshold of 5800 to only catch clear content cases
          const pixelFallback = !cellHasVisionText && !matchedByVision && fileSize > 5800;
          
          const hasContent = cellHasVisionText || matchedByVision || pixelFallback;
          
          const detectionMethod = cellHasVisionText ? 'Individual Cell OCR' : 
                                 (matchedByVision ? 'Column Y-Position Match' : 
                                 (pixelFallback ? 'Pixel Fallback' : 'None'));
          
          console.log(`  Detection: cellOCR=${cellHasVisionText}, columnMatch=${matchedByVision}, pixelFallback=${pixelFallback} (${fileSize}b > 5800) -> ${hasContent ? 'HAS CONTENT' : 'EMPTY'}`);

          turbojetExtractions.push({
            row: rowNum,
            column: 'TURBOJET',
            hasContent: hasContent,
            hasContentByPixels: hasContentByPixels,
            fileSize: fileSize,
            sub1HasContent: sub1HasContent,
            sub1FileSize: sub1FileSize,
            sub2HasContent: sub2HasContent,
            sub2FileSize: sub2FileSize,
            visionText: visionText,
            visionRow: visionRow,
            visionColumn: visionColumn,
            visionConfidence: visionConfidence,
            matchedByVision: matchedByVision,
            cellHasVisionText: cellHasVisionText,
            detectionMethod: detectionMethod,
            boundingBox: {
              x: fullCellBbox.originX,
              y: fullCellBbox.originY,
              width: fullCellBbox.width,
              height: fullCellBbox.height,
            },
            croppedImageUri: croppedFullCell.uri,
            croppedSub1Uri: croppedSub1.uri,
            croppedSub2Uri: croppedSub2.uri,
          });

          console.log(`  Row ${rowNum}: ${hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${detectionMethod})`);
        } catch (error: any) {
          console.error(`  Error processing TURBOJET cell ${rowNum}:`, error.message);
          turbojetExtractions.push({
            row: rowNum,
            column: 'TURBOJET',
            hasContent: false,
            error: error.message,
          });
        }

        setProgress(60 + (i / 14) * 30);
      }

      console.log('========== FINAL TURBOJET EXTRACTIONS ==========');
      console.log(JSON.stringify(turbojetExtractions, null, 2));
      console.log('================================================\n');

      // ========== EXTRACT TURBOPROP COLUMN ==========
      console.log('[Process] Step 4: Extracting TURBOPROP column cells...');
      setStatus('Extracting TURBOPROP column...');
      setProgress(70);

      // TURBOPROP column coordinates from user
      const TURBOPROP_X = 775;
      const TURBOPROP_Y = 101;
      const TURBOPROP_FULL_WIDTH = 74;
      const TURBOPROP_CELL_HEIGHT = 34;
      const TURBOPROP_ROW_SPACING = 36.25; // Same as other columns
      
      // Slant compensation: image appears slanted, rows on right are slightly higher
      // TURBOPROP is ~209px right of TURBOJET, compensate Y by moving up slightly
      const SLANT_Y_ADJUSTMENT = -2; // Move up 2 pixels to compensate for slant
      
      // Sub-columns (similar to TURBOJET)
      const TURBOPROP_SUB1_X = 775;
      const TURBOPROP_SUB1_WIDTH = 48; // Estimate - adjust if needed
      const TURBOPROP_SUB2_X = 775 + 48 + 1; // After sub1 + divider line
      const TURBOPROP_SUB2_WIDTH = 74 - 48 - 1; // Remaining width

      console.log('[Process] TURBOPROP column has 2 sub-columns:');
      console.log(`  Full column: x=${TURBOPROP_X}, y=${TURBOPROP_Y}, width=${TURBOPROP_FULL_WIDTH}`);
      console.log(`  Sub-column 1 (hours): x=${TURBOPROP_SUB1_X}, width=${TURBOPROP_SUB1_WIDTH}`);
      console.log(`  Sub-column 2 (tenths): x=${TURBOPROP_SUB2_X}, width=${TURBOPROP_SUB2_WIDTH}`);

      // Crop the entire TURBOPROP column for Vision OCR
      // Expand to include grid lines for better table detection
      const TURBOPROP_CROP_X = TURBOPROP_X - 12; // Expand left (5 more pixels than before)
      const TURBOPROP_CROP_Y = 96; // Start slightly above first cell
      const TURBOPROP_CROP_WIDTH = TURBOPROP_FULL_WIDTH + 20; // Expand right
      
      const lastTurbopropRowY = TURBOPROP_Y + (13 * TURBOPROP_ROW_SPACING);
      const turbopropColumnHeight = (lastTurbopropRowY + TURBOPROP_CELL_HEIGHT + 10) - TURBOPROP_CROP_Y;
      
      const turbopropColumnBbox = {
        originX: TURBOPROP_CROP_X,
        originY: TURBOPROP_CROP_Y,
        width: TURBOPROP_CROP_WIDTH,
        height: turbopropColumnHeight,
      };

      console.log('[Process] Cropping TURBOPROP column (expanded for Vision table detection):', turbopropColumnBbox);
      console.log(`  Original: x=${TURBOPROP_X}, y=${TURBOPROP_Y}, width=${TURBOPROP_FULL_WIDTH}`);
      console.log(`  Expanded: x=${turbopropColumnBbox.originX}, y=${turbopropColumnBbox.originY}, width=${turbopropColumnBbox.width}`);

      const croppedTurbopropColumn = await ImageManipulator.manipulateAsync(
        leftImage,
        [{ crop: turbopropColumnBbox }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );

      console.log('[Process] Cropped TURBOPROP column image:', croppedTurbopropColumn.uri);

      // Run Vision OCR on the cropped TURBOPROP column
      setStatus('Running Vision OCR on TURBOPROP column...');
      const turbopropOCR = await DocumentRecognizer({
        uri: croppedTurbopropColumn.uri,
        searchCells: [],
      });

      console.log('========== TURBOPROP COLUMN OCR RESULTS ==========');
      console.log('Tables detected:', turbopropOCR.tables?.length || 0);
      if (turbopropOCR.tables && turbopropOCR.tables.length > 0) {
        const table = turbopropOCR.tables[0];
        console.log(`Table structure: ${table.rowCount} rows x ${table.columnCount} columns`);
        console.log('Table data:', JSON.stringify(table, null, 2));
      }
      console.log('Cell confidences:', turbopropOCR.cellConfidences?.length || 0);
      console.log('Raw text:', turbopropOCR.rawText);
      console.log('=================================================\n');

      // Extract Vision text from TURBOPROP column
      setStatus('Extracting 14 TURBOPROP cells...');
      let turbopropVisionTexts: Array<{text: string, row: number, column: number, confidence: number}> = [];
      
      console.log('[Process] Extracting Vision text from TURBOPROP table...');
      if (turbopropOCR.tables && turbopropOCR.tables.length > 0) {
        const table = turbopropOCR.tables[0];
        table.columns?.forEach((column: any) => {
          console.log(`  Column ${column.columnIndex} has ${column.cells?.length || 0} cells`);
          column.cells?.forEach((cell: any) => {
            console.log(`    Cell [${cell.rowIndex},${cell.columnIndex}]: "${cell.text}" (bbox: ${JSON.stringify(cell.boundingBox)})`);
            if (cell.text && cell.text.trim()) {
              turbopropVisionTexts.push({
                text: cell.text.trim(),
                row: cell.rowIndex,
                column: cell.columnIndex,
                confidence: cell.confidence || 0,
              });
            }
          });
        });
      }

      console.log(`[Process] Found ${turbopropVisionTexts.length} Vision text items in TURBOPROP column`);

      setStatus('Extracting 14 TURBOPROP cells...');
      setProgress(75);

      const turbopropExtractions: any[] = [];

      // Extract each of the 14 rows
      for (let i = 0; i < 14; i++) {
        const rowNum = i + 1;
        const cellY = TURBOPROP_Y + (i * TURBOPROP_ROW_SPACING) + SLANT_Y_ADJUSTMENT;
        
        console.log(`[Process] Processing TURBOPROP cell ${rowNum}/14 (Y=${cellY})...`);

        try {
          // Crop the full cell (both sub-columns)
          const fullCellBbox = {
            originX: TURBOPROP_X,
            originY: cellY,
            width: TURBOPROP_FULL_WIDTH,
            height: TURBOPROP_CELL_HEIGHT,
          };

          const croppedFullCell = await ImageManipulator.manipulateAsync(
            leftImage,
            [{ crop: fullCellBbox }],
            { compress: 1, format: ImageManipulator.SaveFormat.PNG }
          );

          // Analyze pixels for full cell using PNG file size as heuristic
          let hasContentByPixels = false;
          let fileSize = 0;
          
          try {
            const imageInfo = await LegacyFileSystem.getInfoAsync(croppedFullCell.uri);
            
            if (imageInfo.exists) {
              fileSize = (imageInfo as any).size || 0;
              const CONTENT_THRESHOLD = 5500;
              hasContentByPixels = fileSize > CONTENT_THRESHOLD;
              console.log(`  Pixel analysis: ${fileSize} bytes -> ${hasContentByPixels ? 'HAS CONTENT' : 'EMPTY'} (threshold: ${CONTENT_THRESHOLD})`);
            }
          } catch (error: any) {
            console.log(`  Could not analyze pixels: ${error.message}`);
          }

          // Also crop individual sub-columns for visual inspection
          const sub1Bbox = {
            originX: TURBOPROP_SUB1_X,
            originY: cellY,
            width: TURBOPROP_SUB1_WIDTH,
            height: TURBOPROP_CELL_HEIGHT,
          };

          const sub2Bbox = {
            originX: TURBOPROP_SUB2_X,
            originY: cellY,
            width: TURBOPROP_SUB2_WIDTH,
            height: TURBOPROP_CELL_HEIGHT,
          };

          const croppedSub1 = await ImageManipulator.manipulateAsync(
            leftImage,
            [{ crop: sub1Bbox }],
            { compress: 1, format: ImageManipulator.SaveFormat.PNG }
          );

          const croppedSub2 = await ImageManipulator.manipulateAsync(
            leftImage,
            [{ crop: sub2Bbox }],
            { compress: 1, format: ImageManipulator.SaveFormat.PNG }
          );

          // Analyze sub-columns
          let sub1HasContent = false;
          let sub2HasContent = false;
          let sub1FileSize = 0;
          let sub2FileSize = 0;

          try {
            const sub1Info = await LegacyFileSystem.getInfoAsync(croppedSub1.uri);
            const sub2Info = await LegacyFileSystem.getInfoAsync(croppedSub2.uri);
            
            if (sub1Info.exists) {
              sub1FileSize = (sub1Info as any).size || 0;
              sub1HasContent = sub1FileSize > 3400;
              console.log(`  Sub1 analysis: ${sub1FileSize} bytes -> ${sub1HasContent ? 'HAS CONTENT' : 'EMPTY'}`);
            }
            
            if (sub2Info.exists) {
              sub2FileSize = (sub2Info as any).size || 0;
              sub2HasContent = sub2FileSize > 2000;
              console.log(`  Sub2 analysis: ${sub2FileSize} bytes -> ${sub2HasContent ? 'HAS CONTENT' : 'EMPTY'}`);
            }
          } catch (error: any) {
            console.log(`  Could not analyze sub-columns: ${error.message}`);
          }

          // STEP 1: Try to match Vision text by Y position from column-level OCR
          const cellYInCroppedImage = cellY - TURBOPROP_CROP_Y;
          let visionText = '';
          let visionRow = -1;
          let visionColumn = -1;
          let visionConfidence = 0;
          let matchedByVision = false;

          if (turbopropOCR.tables && turbopropOCR.tables.length > 0) {
            const table = turbopropOCR.tables[0];
            for (const column of table.columns || []) {
              for (const cell of column.cells || []) {
                if (cell.boundingBox && cell.text && cell.text.trim()) {
                  const visionCellY = cell.boundingBox.yMin;
                  const visionCellHeight = cell.boundingBox.yMax - cell.boundingBox.yMin;
                  const yDiff = Math.abs(visionCellY - cellYInCroppedImage);
                  
                  // Reject merged cells
                  const MAX_CELL_HEIGHT = 50;
                  
                  if (visionCellHeight > MAX_CELL_HEIGHT) {
                    console.log(`  Rejecting Vision cell: height=${visionCellHeight}px (merged cell, max=${MAX_CELL_HEIGHT}px)`);
                    continue;
                  }
                  
                  // Tight threshold
                  if (yDiff < 10) {
                    visionText = cell.text.trim();
                    visionRow = cell.rowIndex;
                    visionColumn = cell.columnIndex;
                    visionConfidence = cell.confidence || 0;
                    matchedByVision = true;
                    console.log(`  Matched Vision text: "${visionText}" at Y=${visionCellY} (diff=${yDiff}px, height=${visionCellHeight}px)`);
                    break;
                  }
                }
              }
              if (matchedByVision) break;
            }
          }
          
          if (!matchedByVision) {
            console.log(`  No Vision match found for Y=${cellYInCroppedImage} (threshold: 10px)`);
          }

          // STEP 2: Try OCR on individual cell crop
          let cellHasVisionText = false;
          let cellVisionText = '';
          
          try {
            const cellOCR = await DocumentRecognizer({
              uri: croppedFullCell.uri,
              searchCells: [],
            });
            
            if (cellOCR.rawText && cellOCR.rawText.trim().length > 0) {
              const cleanText = cellOCR.rawText.trim();
              const isRealContent = cleanText.length > 0 && 
                                   !cleanText.match(/^[|\-_\s]+$/);
              
              if (isRealContent) {
                cellHasVisionText = true;
                cellVisionText = cleanText;
                console.log(`  Individual cell Vision OCR: "${cellVisionText}"`);
              } else {
                console.log(`  Individual cell Vision OCR found only grid lines/artifacts: "${cleanText}"`);
              }
            } else {
              console.log(`  Individual cell Vision OCR: no text found`);
            }
          } catch (error: any) {
            console.log(`  Could not run Vision OCR on individual cell: ${error.message}`);
          }

          // Use individual cell Vision text if available and no column-level match
          if (cellHasVisionText && !matchedByVision) {
            visionText = cellVisionText;
            matchedByVision = true;
            console.log(`  Using individual cell Vision text: "${visionText}"`);
          }

          // STEP 3: Determine if cell has content
          // Primary: Vision OCR, Fallback: Pixel analysis with conservative threshold
          // TURBOPROP has lighter shading than TURBOJET, so lower threshold
          // Empty rows: 3072-3516 bytes
          // Content rows: 3927-4344 bytes
          // Use threshold of 3850 to catch content rows Vision misses
          const pixelFallback = !cellHasVisionText && !matchedByVision && fileSize > 3850;
          
          const hasContent = cellHasVisionText || matchedByVision || pixelFallback;
          
          const detectionMethod = cellHasVisionText ? 'Individual Cell OCR' : 
                                 (matchedByVision ? 'Column Y-Position Match' : 
                                 (pixelFallback ? 'Pixel Fallback' : 'None'));
          
          console.log(`  Detection: cellOCR=${cellHasVisionText}, columnMatch=${matchedByVision}, pixelFallback=${pixelFallback} (${fileSize}b > 5800) -> ${hasContent ? 'HAS CONTENT' : 'EMPTY'}`);

          turbopropExtractions.push({
            row: rowNum,
            column: 'TURBOPROP',
            hasContent: hasContent,
            hasContentByPixels: hasContentByPixels,
            fileSize: fileSize,
            sub1HasContent: sub1HasContent,
            sub1FileSize: sub1FileSize,
            sub2HasContent: sub2HasContent,
            sub2FileSize: sub2FileSize,
            visionText: visionText,
            visionRow: visionRow,
            visionColumn: visionColumn,
            visionConfidence: visionConfidence,
            matchedByVision: matchedByVision,
            cellHasVisionText: cellHasVisionText,
            detectionMethod: detectionMethod,
            boundingBox: {
              x: fullCellBbox.originX,
              y: fullCellBbox.originY,
              width: fullCellBbox.width,
              height: fullCellBbox.height,
            },
            croppedImageUri: croppedFullCell.uri,
            croppedSub1Uri: croppedSub1.uri,
            croppedSub2Uri: croppedSub2.uri,
          });

          console.log(`  Row ${rowNum}: ${hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${detectionMethod})`);
        } catch (error: any) {
          console.error(`  Error processing TURBOPROP cell ${rowNum}:`, error.message);
          turbopropExtractions.push({
            row: rowNum,
            column: 'TURBOPROP',
            hasContent: false,
            error: error.message,
          });
        }

        setProgress(75 + (i / 14) * 15);
      }

      console.log('========== FINAL TURBOPROP EXTRACTIONS ==========');
      console.log(JSON.stringify(turbopropExtractions, null, 2));
      console.log('================================================\n');

      // ========== EXTRACT TEXT COLUMNS ==========
      console.log('[Process] Step 5: Extracting text columns...');
      setStatus('Extracting text columns...');
      setProgress(85);

      // Extract 3 text columns using helper function (similar to DATE)
      // All are non-shaded and should have values in all rows
      const aircraftMakeResult = await extractTextColumn('AIRCRAFT MAKE AND MODEL', 74, 101, 55, 34, leftImage, 1200);
      const aircraftIdentResult = await extractTextColumn('AIRCRAFT IDENT', 131, 101, 55, 34, leftImage, 1200);
      const fromToResult = await extractTextColumn('FROM-TO', 188, 101, 102, 34, leftImage, 1200);

      const aircraftMakeExtractions = aircraftMakeResult.extractions;
      const aircraftIdentExtractions = aircraftIdentResult.extractions;
      const fromToExtractions = fromToResult.extractions;

      // ========== EXTRACT ALL FLIGHT DURATION COLUMNS ==========
      console.log('[Process] Step 6: Extracting flight duration columns...');
      setStatus('Extracting flight duration columns...');
      setProgress(90);

      // Extract all 6 flight duration columns using helper function
      // Pixel thresholds tuned based on shading:
      // - Shaded columns (TOTAL, SES, GLIDER) need higher thresholds due to gray background
      // - Non-shaded columns (SEL, MEL, HELI) can use lower thresholds
      const totalResult = await extractFlightDurationColumn('TOTAL DURATION', 292, 100, 66, 34, leftImage, 5500); // Shaded, all have content
      const selResult = await extractFlightDurationColumn('SINGLE-ENGINE LAND', 360, 101, 65, 34, leftImage, 5800);
      const sesResult = await extractFlightDurationColumn('SINGLE-ENGINE SEA', 428, 101, 65, 34, leftImage, 10000); // Shaded, all empty - very high threshold
      const melResult = await extractFlightDurationColumn('MULTI-ENGINE LAND', 496, 101, 67, 34, leftImage, 3000); // Non-shaded, all have content - very low threshold
      const heliResult = await extractFlightDurationColumn('ROTORCRAFT HELICOPTER', 636, 101, 67, 34, leftImage, 5800); // Non-shaded
      const gliderResult = await extractFlightDurationColumn('GLIDER', 706, 101, 68, 34, leftImage, 10000); // Shaded, all empty - very high threshold

      const totalExtractions = totalResult.extractions;
      const selExtractions = selResult.extractions;
      const sesExtractions = sesResult.extractions;
      const melExtractions = melResult.extractions;
      const heliExtractions = heliResult.extractions;
      const gliderExtractions = gliderResult.extractions;

      setProgress(95);
      setStatus('Finalizing results...');

      // Create a cell presence map for the LLM
      const cellPresenceMap = dateExtractions.map((cell: any) => ({
        row: cell.row,
        hasContent: cell.hasContent, // Detected by Vision OR pixel analysis
        visionText: cell.text || '', // What Vision read (even if wrong)
        confidence: cell.confidence,
        detectionMethod: cell.matchedByPosition ? 'Vision' : (cell.hasContentByPixels ? 'Pixels' : 'None'),
      }));

      setProgress(100);
      setStatus(`Complete! Extracted ${dateExtractions.length} DATE, 3 text columns, ${turbojetExtractions.length} TURBOJET, ${turbopropExtractions.length} TURBOPROP, and 6 flight duration columns`);
      console.log('[Process] Column extraction complete!');
      console.log(`[Process] DATE: ${cellPresenceMap.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] AIRCRAFT MAKE: ${aircraftMakeExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] AIRCRAFT IDENT: ${aircraftIdentExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] FROM-TO: ${fromToExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] TURBOJET: ${turbojetExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] TURBOPROP: ${turbopropExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] TOTAL DURATION: ${totalExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] SINGLE-ENGINE LAND: ${selExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] SINGLE-ENGINE SEA: ${sesExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] MULTI-ENGINE LAND: ${melExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] ROTORCRAFT HELICOPTER: ${heliExtractions.filter((c: any) => c.hasContent).length}/14 cells`);
      console.log(`[Process] GLIDER: ${gliderExtractions.filter((c: any) => c.hasContent).length}/14 cells`);

      console.log('========== CELL PRESENCE MAP ==========');
      console.log('This map tells the LLM which cells have content vs which are empty:');
      console.log('\nDATE Column:');
      cellPresenceMap.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (detected by: ${cell.detectionMethod})`);
      });
      console.log('\nAIRCRAFT MAKE AND MODEL Column:');
      aircraftMakeExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod}) Vision: "${cell.text}"`);
      });
      console.log('\nAIRCRAFT IDENT Column:');
      aircraftIdentExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod}) Vision: "${cell.text}"`);
      });
      console.log('\nFROM-TO Column:');
      fromToExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod}) Vision: "${cell.text}"`);
      });
      console.log('\nTURBOJET Column:');
      turbojetExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (Full: ${cell.hasContentByPixels}, Sub1: ${cell.sub1HasContent}, Sub2: ${cell.sub2HasContent})`);
      });
      console.log('\nTURBOPROP Column:');
      turbopropExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nTOTAL DURATION Column:');
      totalExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nSINGLE-ENGINE LAND Column:');
      selExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nSINGLE-ENGINE SEA Column:');
      sesExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nMULTI-ENGINE LAND Column:');
      melExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nROTORCRAFT HELICOPTER Column:');
      heliExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('\nGLIDER Column:');
      gliderExtractions.forEach((cell: any) => {
        console.log(`  Row ${cell.row}: ${cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${cell.detectionMethod})`);
      });
      console.log('=======================================\n');

      // Set results for display
      setResult2({
        ocrData: {
          dateColumnIndex: 0,
          dateHeader: dateHeader,
          dateCells: dateExtractions,
          cellPresenceMap: cellPresenceMap,
          croppedColumnUri: croppedColumn.uri,
          columnBbox: fullColumnBbox,
          columnOCRResult: {
            tablesCount: columnOCR.tables?.length || 0,
            rowCount: columnOCR.tables?.[0]?.rowCount || 0,
            columnCount: columnOCR.tables?.[0]?.columnCount || 0,
            cellConfidencesCount: columnOCR.cellConfidences?.length || 0,
            rawText: columnOCR.rawText,
          },
          // Add AIRCRAFT MAKE column data
          aircraftMakeCells: aircraftMakeExtractions,
          croppedAircraftMakeColumnUri: aircraftMakeResult.croppedColumnUri,
          aircraftMakeColumnBbox: aircraftMakeResult.columnBbox,
          aircraftMakeOCRResult: aircraftMakeResult.ocrResult,
          // Add AIRCRAFT IDENT column data
          aircraftIdentCells: aircraftIdentExtractions,
          croppedAircraftIdentColumnUri: aircraftIdentResult.croppedColumnUri,
          aircraftIdentColumnBbox: aircraftIdentResult.columnBbox,
          aircraftIdentOCRResult: aircraftIdentResult.ocrResult,
          // Add FROM-TO column data
          fromToCells: fromToExtractions,
          croppedFromToColumnUri: fromToResult.croppedColumnUri,
          fromToColumnBbox: fromToResult.columnBbox,
          fromToOCRResult: fromToResult.ocrResult,
          // Add TURBOJET column data
          turbojetCells: turbojetExtractions,
          croppedTurbojetColumnUri: croppedTurbojetColumn.uri,
          turbojetColumnBbox: turbojetColumnBbox,
          turbojetOCRResult: {
            tablesCount: turbojetOCR.tables?.length || 0,
            rowCount: turbojetOCR.tables?.[0]?.rowCount || 0,
            columnCount: turbojetOCR.tables?.[0]?.columnCount || 0,
            rawText: turbojetOCR.rawText,
          },
          // Add TURBOPROP column data
          turbopropCells: turbopropExtractions,
          croppedTurbopropColumnUri: croppedTurbopropColumn.uri,
          turbopropColumnBbox: turbopropColumnBbox,
          turbopropOCRResult: {
            tablesCount: turbopropOCR.tables?.length || 0,
            rowCount: turbopropOCR.tables?.[0]?.rowCount || 0,
            columnCount: turbopropOCR.tables?.[0]?.columnCount || 0,
            rawText: turbopropOCR.rawText,
          },
          // Add TOTAL DURATION column data
          totalCells: totalExtractions,
          croppedTOTALColumnUri: totalResult.croppedColumnUri,
          totalColumnBbox: totalResult.columnBbox,
          totalOCRResult: totalResult.ocrResult,
          // Add SINGLE-ENGINE LAND column data
          selCells: selExtractions,
          croppedSELColumnUri: selResult.croppedColumnUri,
          selColumnBbox: selResult.columnBbox,
          selOCRResult: selResult.ocrResult,
          // Add SINGLE-ENGINE SEA column data
          sesCells: sesExtractions,
          croppedSESColumnUri: sesResult.croppedColumnUri,
          sesColumnBbox: sesResult.columnBbox,
          sesOCRResult: sesResult.ocrResult,
          // Add MULTI-ENGINE LAND column data
          melCells: melExtractions,
          croppedMELColumnUri: melResult.croppedColumnUri,
          melColumnBbox: melResult.columnBbox,
          melOCRResult: melResult.ocrResult,
          // Add ROTORCRAFT HELICOPTER column data
          heliCells: heliExtractions,
          croppedHELIColumnUri: heliResult.croppedColumnUri,
          heliColumnBbox: heliResult.columnBbox,
          heliOCRResult: heliResult.ocrResult,
          // Add GLIDER column data
          gliderCells: gliderExtractions,
          croppedGLIDERColumnUri: gliderResult.croppedColumnUri,
          gliderColumnBbox: gliderResult.columnBbox,
          gliderOCRResult: gliderResult.ocrResult,
        },
        extractedFlights: dateExtractions,
        cellPresenceMap: cellPresenceMap,
        turbojetPresenceMap: turbojetExtractions.map((c: any) => ({
          row: c.row,
          hasContent: c.hasContent,
          detectionMethod: c.detectionMethod,
          visionText: c.visionText,
          sub1HasContent: c.sub1HasContent,
          sub2HasContent: c.sub2HasContent,
        })),
        turbopropPresenceMap: turbopropExtractions.map((c: any) => ({
          row: c.row,
          hasContent: c.hasContent,
          detectionMethod: c.detectionMethod,
          visionText: c.visionText,
          sub1HasContent: c.sub1HasContent,
          sub2HasContent: c.sub2HasContent,
        })),
        selPresenceMap: selExtractions.map((c: any) => ({
          row: c.row,
          hasContent: c.hasContent,
          detectionMethod: c.detectionMethod,
          visionText: c.visionText,
          sub1HasContent: c.sub1HasContent,
          sub2HasContent: c.sub2HasContent,
        })),
        rawLLMOutput: `Column Extraction Results\n\n` +
          `DATE Column: ${cellPresenceMap.filter((c: any) => c.hasContent).length}/14 cells with content\n` +
          `AIRCRAFT MAKE Column: ${aircraftMakeExtractions.filter((c: any) => c.hasContent).length}/14 cells with content\n` +
          `AIRCRAFT IDENT Column: ${aircraftIdentExtractions.filter((c: any) => c.hasContent).length}/14 cells with content\n` +
          `FROM-TO Column: ${fromToExtractions.filter((c: any) => c.hasContent).length}/14 cells with content\n` +
          `TURBOJET Column: ${turbojetExtractions.filter((c: any) => c.hasContent).length}/14 cells with content\n` +
          `TURBOPROP Column: ${turbopropExtractions.filter((c: any) => c.hasContent).length}/14 cells with content\n` +
          `SINGLE-ENGINE LAND Column: ${selExtractions.filter((c: any) => c.hasContent).length}/14 cells with content\n\n` +
          `DATE Column:\n` +
          cellPresenceMap.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''}`
          ).join('\n') +
          `\n\nAIRCRAFT MAKE Column:\n` +
          aircraftMakeExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.text ? `Vision: "${c.text}"` : ''}`
          ).join('\n') +
          `\n\nAIRCRAFT IDENT Column:\n` +
          aircraftIdentExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.text ? `Vision: "${c.text}"` : ''}`
          ).join('\n') +
          `\n\nFROM-TO Column:\n` +
          fromToExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.text ? `Vision: "${c.text}"` : ''}`
          ).join('\n') +
          `\n\nTURBOJET Column:\n` +
          turbojetExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''}`
          ).join('\n') +
          `\n\nTURBOPROP Column:\n` +
          turbopropExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''}`
          ).join('\n') +
          `\n\nSINGLE-ENGINE LAND Column:\n` +
          selExtractions.map((c: any) => 
            `Row ${c.row}: ${c.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'} (${c.detectionMethod}) ${c.visionText ? `Vision: "${c.visionText}"` : ''}`
          ).join('\n'),
        csv: 'Row,Date,Aircraft_Make_Model,Aircraft_Ident,From_To,Total_Duration,Single_Engine_Land,Single_Engine_Sea,Multi_Engine_Land,Turbojet,Turboprop,Rotorcraft_Helicopter,Glider\n' + 
          dateExtractions.map((d: any, idx: number) => {
            const make = aircraftMakeExtractions[idx];
            const ident = aircraftIdentExtractions[idx];
            const fromTo = fromToExtractions[idx];
            const total = totalExtractions[idx];
            const sel = selExtractions[idx];
            const ses = sesExtractions[idx];
            const mel = melExtractions[idx];
            const tj = turbojetExtractions[idx];
            const tp = turbopropExtractions[idx];
            const heli = heliExtractions[idx];
            const glider = gliderExtractions[idx];
            
            // Helper function to get value with default
            const getValue = (cell: any, defaultValue: string) => {
              if (!cell.hasContent) return '';
              const text = cell.text || cell.visionText || '';
              return text.trim() || defaultValue;
            };
            
            return `${d.row},` +
              `"${getValue(d, '1/1')}",` +
              `"${getValue(make, 'MODEL')}",` +
              `"${getValue(ident, 'IDENT')}",` +
              `"${getValue(fromTo, 'FROM-TO')}",` +
              `"${getValue(total, '0.0')}",` +
              `"${getValue(sel, '0.0')}",` +
              `"${getValue(ses, '0.0')}",` +
              `"${getValue(mel, '0.0')}",` +
              `"${getValue(tj, '0.0')}",` +
              `"${getValue(tp, '0.0')}",` +
              `"${getValue(heli, '0.0')}",` +
              `"${getValue(glider, '0.0')}"`;
          }).join('\n'),
      });

      // Return immediately - we have what we need
      return;

      // ========== OLD CODE BELOW (SKIPPED) ==========

      // ========== SKIP LLM - RETURN OCR RESULTS ONLY ==========
      console.log('[Process] Skipping LLM extraction, returning OCR results...');
      setStatus('OCR Complete - Preparing results...');
      setProgress(95);

      // Format OCR data as "extracted flights" for display
      const ocrFlights: any[] = [];
      for (let row = 1; row < ocrResult.leftTable.rowCount; row++) {
        const leftCells = ocrResult.cellData.left
          .filter((c: any) => c.row === row)
          .sort((a: any, b: any) => a.column - b.column);
        
        const rightCells = ocrResult.cellData.right
          .filter((c: any) => c.row === row)
          .sort((a: any, b: any) => a.column - b.column);

        ocrFlights.push({
          row: row,
          leftCells: leftCells.map((c: any) => c.value || ''),
          rightCells: rightCells.map((c: any) => c.value || ''),
        });
      }

      // Create CSV from OCR data
      const ocrCsv = 'Row,Left Cells,Right Cells\n' + 
        ocrFlights.map(f => 
          `${f.row},"${f.leftCells.join(' | ')}","${f.rightCells.join(' | ')}"`
        ).join('\n');

      console.log('========== OCR FLIGHTS ==========');
      console.log(JSON.stringify(ocrFlights, null, 2));
      console.log('=================================\n');

      setResult2({
        ocrData: ocrResult,
        extractedFlights: ocrFlights,
        rawLLMOutput: 'LLM extraction skipped - OCR results only',
        csv: ocrCsv,
      });

      setProgress(100);
      setStatus(`Complete! OCR extracted ${ocrFlights.length} rows`);
      console.log('[Process] OCR extraction complete!');
      
      // Skip all LLM processing below
      return;

      // ========== LLM CODE BELOW (SKIPPED) ==========

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

      // ========== MULTI-PASS COLUMN EXTRACTION ==========
      
      console.log('[Process] Step 3: Using column-batched extraction...');
      setStatus('Extracting columns in batches...');
      setProgress(50);

      const allFlights: any[] = [];
      const batchOutputs: string[] = [];
      
      // Define column batches - extract 4-5 columns at a time
      const columnBatches = [
        {
          name: 'Basic Info',
          prompt: `Extract these columns from the flight log (left page):
1. DATE (M/D format)
2. AIRCRAFT MAKE AND MODEL (e.g., LR25, BE-200)
3. AIRCRAFT IDENT (N-number)
4. FROM-TO (airport codes)
5. TOTAL DURATION (hours.tenths, e.g., 2|8 = 2.8)

Return JSON array with one object per row. Use empty string for blank cells.
Format: [{"date": "9/10", "aircraft": "LR25", "ident": "N308AJ", "route": "HOU-GLS", "total": "2.8"}, ...]`
        },
        {
          name: 'Aircraft Categories',
          prompt: `Extract these columns from the flight log (left page):
1. SINGLE-ENGINE LAND (hours.tenths or empty)
2. MULTI-ENGINE LAND (hours.tenths or empty)
3. TURBOJET (hours.tenths or empty - only for LR25, IA1124)
4. TURBOPROP (hours.tenths or empty - only for BE-200)
5. LANDINGS DAY (integer or empty)
6. LANDINGS NIGHT (integer or empty)

Return JSON array with one object per row. Use empty string for blank cells.
Format: [{"sel": "", "mel": "2.8", "turbojet": "2.8", "turboprop": "", "day_ldg": "4", "night_ldg": "1"}, ...]`
        },
        {
          name: 'Flight Conditions',
          prompt: `Extract these columns from the flight log (right page):
1. NIGHT (hours.tenths or empty)
2. ACTUAL INSTRUMENT (hours.tenths or empty - often 0.1, 0.2, 0.3)
3. SIMULATED INSTRUMENT (hours.tenths or empty)
4. APPROACHES (integer or empty)
5. APPROACH TYPE (text like ILS, VOR or empty)

Return JSON array with one object per row. Use empty string for blank cells.
Format: [{"night": "1.4", "inst": "0.2", "sim_inst": "", "approaches": "1", "app_type": "ILS"}, ...]`
        },
        {
          name: 'Pilot Time',
          prompt: `Extract these columns from the flight log (right page):
1. CROSS COUNTRY (hours.tenths or empty)
2. PILOT IN COMMAND (hours.tenths or empty)
3. SECOND IN COMMAND (hours.tenths or empty)
4. DUAL RECEIVED (hours.tenths or empty)
5. AS FLIGHT INSTRUCTOR (hours.tenths or empty)
6. REMARKS (text or empty)

Return JSON array with one object per row. Use empty string for blank cells.
Format: [{"xc": "2.8", "pic": "", "sic": "2.8", "dual": "", "cfi": "", "remarks": "91-135"}, ...]`
        }
      ];

      const startTime = Date.now();
      
      for (let i = 0; i < columnBatches.length; i++) {
        const batch = columnBatches[i];
        const baseProgress = 50 + (i / columnBatches.length) * 45;
        
        setStatus(`Extracting ${batch.name} (${i + 1}/${columnBatches.length})...`);
        setProgress(baseProgress);
        
        console.log(`[Process] Batch ${i + 1}/${columnBatches.length}: ${batch.name}`);
        
        let tokenCount = 0;
        let lastLogTime = Date.now();
        const batchStartTime = Date.now();

        const completion = await contextRef.current!.completion(
          {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: batch.prompt },
                  { type: 'image_url', image_url: { url: leftImage } },
                  { type: 'image_url', image_url: { url: rightImage } },
                ],
              },
            ],
            n_predict: 2000,
            temperature: 0.1,
            stop: ['</s>', '\n\n\n'],
          },
          (data) => {
            if (data.token) {
              tokenCount++;
              const progressPercent = baseProgress + Math.min((tokenCount / 2000) * (45 / columnBatches.length), (45 / columnBatches.length));
              setProgress(progressPercent);

              const now = Date.now();
              if (tokenCount % 50 === 0 || now - lastLogTime > 5000) {
                const elapsed = ((now - batchStartTime) / 1000).toFixed(1);
                const tokensPerSec = ((tokenCount / (now - batchStartTime)) * 1000).toFixed(1);
                console.log(`[Process] Batch ${i + 1} progress: ${tokenCount} tokens in ${elapsed}s (${tokensPerSec} tok/s)`);
                lastLogTime = now;
              }
            }
          }
        );

        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
        console.log(`[Process] Batch ${i + 1} complete in ${batchDuration}s: ${tokenCount} tokens`);
        console.log(`[Process] Batch ${i + 1} output:\n${completion.text}`);
        
        batchOutputs.push(`BATCH ${i + 1} (${batch.name}):\n${completion.text}`);
        
        // Parse this batch
        const batchData = parseModelOutput(completion.text);
        console.log(`[Process] Batch ${i + 1} parsed ${batchData.length} rows`);
        
        // Merge with existing data
        if (i === 0) {
          // First batch - initialize array
          allFlights.push(...batchData);
        } else {
          // Subsequent batches - merge columns
          for (let j = 0; j < Math.min(allFlights.length, batchData.length); j++) {
            allFlights[j] = { ...allFlights[j], ...batchData[j] };
          }
        }
      }

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Process] All batches complete in ${totalDuration}s: ${allFlights.length} flights`);

      setProgress(95);
      setStatus('Combining results...');

      console.log('========== COMBINED FLIGHT ENTRIES ==========');
      console.log(JSON.stringify(allFlights, null, 2));
      console.log('=============================================\n');

      // Parse and log CSV from LLM output
      const csv2 = parseAndLogCSV(allFlights, 'COLUMN-BATCHED EXTRACTION');

      // Generate CSV from extracted column data with defaults
      const extractedCSV = convertExtractedDataToCSV(ocrResult);
      console.log('========== EXTRACTED DATA CSV ==========');
      console.log(extractedCSV);
      console.log('========================================\n');

      setResult2({
        ocrData: ocrResult,
        extractedFlights: allFlights,
        rawLLMOutput: batchOutputs.join('\n\n'),
        csv: extractedCSV, // Use extracted data CSV instead of LLM CSV
      });

      setProgress(100);
      setStatus(`Complete! Extracted ${allFlights.length} flights`);
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

    summary += `CELL GRID (first 20 rows):\n`;
    for (let row = 1; row < Math.min(21, ocrResult.leftTable.rowCount); row++) {
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
    if (!result2 || !result2.csv) return;

    try {
      const file = new File(Paths.cache, `flight-log-${Date.now()}.csv`);
      await file.write(result2.csv);
      await Sharing.shareAsync(file.uri);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const shareDetailedResults = async () => {
    if (!result2) return;

    try {
      // Create comprehensive report
      let report = '========== DATE COLUMN EXTRACTION REPORT ==========\n\n';

      report += '=== SUMMARY ===\n';
      report += `Extraction Date: ${new Date().toLocaleString()}\n`;
      report += `Date Cells Extracted: ${result2.extractedFlights.length}\n\n`;

      report += '=== DATE CELLS ===\n';
      result2.ocrData.dateCells.forEach((cell: any, idx: number) => {
        report += `${idx + 1}. Row ${cell.row}: "${cell.text}"\n`;
        report += `   Bbox: (${cell.boundingBox.x}, ${cell.boundingBox.y}, ${cell.boundingBox.width}, ${cell.boundingBox.height})\n`;
        if (cell.croppedImageUri) {
          report += `   Image: ${cell.croppedImageUri}\n`;
        }
        if (cell.error) {
          report += `   Error: ${cell.error}\n`;
        }
      });
      report += '\n';

      report += '=== DATE CELLS (JSON) ===\n';
      report += JSON.stringify(result2.ocrData.dateCells, null, 2) + '\n\n';

      report += '=== CSV FORMAT ===\n';
      report += result2.csv + '\n\n';

      report += '========== END REPORT ==========\n';

      // Save to file and share
      const file = new File(Paths.cache, `date-column-${Date.now()}.txt`);
      await file.write(report);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        dialogTitle: 'Share DATE Column Report',
      });
    } catch (error: any) {
      console.error('[Share] Error:', error);
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

  const convertExtractedDataToCSV = (ocrData: any): string => {
    // Helper function to get value with defaults
    const getValue = (cell: any, columnType: string): string => {
      // If cell has no content, return empty string
      if (!cell || !cell.hasContent) {
        return '';
      }
      
      // If we have OCR text, use it
      if (cell.text && cell.text.trim()) {
        return cell.text.trim();
      }
      
      if (cell.visionText && cell.visionText.trim()) {
        return cell.visionText.trim();
      }
      
      // Cell has content but no OCR - use defaults
      switch (columnType) {
        case 'DATE':
          return '1/1';
        case 'AIRCRAFT_MAKE':
          return 'MODEL';
        case 'AIRCRAFT_IDENT':
          return 'IDENT';
        case 'FROM_TO':
          return 'FROM-TO';
        case 'DURATION':
          return '0.0';
        default:
          return '';
      }
    };

    const headers = [
      'Row',
      'Date',
      'Aircraft_Make_Model',
      'Aircraft_Ident',
      'From_To',
      'Total_Duration',
      'Single_Engine_Land',
      'Single_Engine_Sea',
      'Multi_Engine_Land',
      'Turbojet',
      'Turboprop',
      'Rotorcraft_Helicopter',
      'Glider',
    ];

    let csv = headers.join(',') + '\n';

    // Generate 14 rows
    for (let i = 0; i < 14; i++) {
      const rowNum = i + 1;
      
      const dateCell = ocrData.dateCells?.[i];
      const aircraftMakeCell = ocrData.aircraftMakeCells?.[i];
      const aircraftIdentCell = ocrData.aircraftIdentCells?.[i];
      const fromToCell = ocrData.fromToCells?.[i];
      const totalCell = ocrData.totalCells?.[i];
      const selCell = ocrData.selCells?.[i];
      const sesCell = ocrData.sesCells?.[i];
      const melCell = ocrData.melCells?.[i];
      const turbojetCell = ocrData.turbojetCells?.[i];
      const turbopropCell = ocrData.turbopropCells?.[i];
      const heliCell = ocrData.heliCells?.[i];
      const gliderCell = ocrData.gliderCells?.[i];

      const row = [
        rowNum,
        getValue(dateCell, 'DATE'),
        getValue(aircraftMakeCell, 'AIRCRAFT_MAKE'),
        getValue(aircraftIdentCell, 'AIRCRAFT_IDENT'),
        getValue(fromToCell, 'FROM_TO'),
        getValue(totalCell, 'DURATION'),
        getValue(selCell, 'DURATION'),
        getValue(sesCell, 'DURATION'),
        getValue(melCell, 'DURATION'),
        getValue(turbojetCell, 'DURATION'),
        getValue(turbopropCell, 'DURATION'),
        getValue(heliCell, 'DURATION'),
        getValue(gliderCell, 'DURATION'),
      ];

      csv += row.join(',') + '\n';
    }

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
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
    >
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

      {(result || result2) && (
        <View style={styles.resultsSection}>
          <Text style={styles.resultsTitle}>Results</Text>

          <View style={styles.statsCard}>
            {result && (
              <>
                <Text style={styles.statsText}>
                  Prompt 1 (Current): {result.extractedFlights.length} flights
                </Text>
                <Text style={styles.statsText}>
                  OCR cells detected: {result.ocrData.metadata.totalCells}
                </Text>
              </>
            )}
            {result2 && (
              <Text style={styles.statsText}>
                {result ? 'Prompt 2 (Alternative)' : 'DATE Column'}: {result2.extractedFlights.length} cells
              </Text>
            )}
          </View>

          {result && (
            <>
              <Text style={styles.sectionTitle}>
                📋 Prompt 1: Current System Prompt
              </Text>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  Extracted Flights (first 3):
                </Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>
                    {JSON.stringify(result.extractedFlights, null, 2)}
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
                      {result.csv}
                    </Text>
                  </ScrollView>
                </View>
              )}
            </>
          )}

          {result2 && (
            <>
              <Text style={styles.sectionTitle}>
                📋 DATE Column Cells (14 Rows)
              </Text>

              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  Extracted Text Items ({result2.extractedFlights.length}):
                </Text>
                <ScrollView style={styles.previewScroll}>
                  <Text style={styles.previewText}>
                    {JSON.stringify(
                      result2.extractedFlights,
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
                      {result2.csv}
                    </Text>
                  </ScrollView>
                </View>
              )}

              {/* Display cropped DATE column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  DATE Column (cropped with grid lines):
                </Text>
                {result2.ocrData.croppedColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.columnOCRResult.rowCount} rows x {result2.ocrData.columnOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Tables: {result2.ocrData.columnOCRResult.tablesCount}, Cells: {result2.ocrData.columnOCRResult.cellConfidencesCount}
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped AIRCRAFT MAKE column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT MAKE AND MODEL Column:
                </Text>
                {result2.ocrData.croppedAircraftMakeColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedAircraftMakeColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.aircraftMakeOCRResult.rowCount} rows x {result2.ocrData.aircraftMakeOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.ocrData.aircraftMakeCells?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped AIRCRAFT IDENT column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT IDENT Column:
                </Text>
                {result2.ocrData.croppedAircraftIdentColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedAircraftIdentColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.aircraftIdentOCRResult.rowCount} rows x {result2.ocrData.aircraftIdentOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.ocrData.aircraftIdentCells?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped FROM-TO column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  FROM-TO Column:
                </Text>
                {result2.ocrData.croppedFromToColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedFromToColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.fromToOCRResult.rowCount} rows x {result2.ocrData.fromToOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.ocrData.fromToCells?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display cropped TURBOJET column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOJET Column (2 sub-columns):
                </Text>
                {result2.ocrData.croppedTurbojetColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedTurbojetColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.turbojetOCRResult.rowCount} rows x {result2.ocrData.turbojetOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.turbojetPresenceMap?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display DATE cell images */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  DATE Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.dateCells.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {(cell.confidence * 100).toFixed(0)}%)
                          {'\n'}Pixels: {cell.hasContentByPixels ? '✓' : '✗'} ({cell.darkPixelPercentage?.toFixed(0) || 0}%)
                          {'\n'}Detection: {cell.matchedByPosition ? 'Vision' : (cell.hasContentByPixels ? 'Pixels' : 'None')}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox.x}, {cell.boundingBox.y}, {cell.boundingBox.width}, {cell.boundingBox.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display AIRCRAFT MAKE cell images */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT MAKE AND MODEL Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.aircraftMakeCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {((cell.confidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Detection: {cell.detectionMethod}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display AIRCRAFT IDENT cell images */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  AIRCRAFT IDENT Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.aircraftIdentCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {((cell.confidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Detection: {cell.detectionMethod}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display FROM-TO cell images */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  FROM-TO Cell Images (14 cells):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.fromToCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Vision: "{cell.text}" (conf: {((cell.confidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Detection: {cell.detectionMethod}
                        </Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display TURBOJET cell images */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOJET Cell Images (14 cells, 2 sub-columns each):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.turbojetCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Detection: {cell.detectionMethod || 'None'}
                          {'\n'}Vision: "{cell.visionText || ''}" (conf: {((cell.visionConfidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Cell OCR: {cell.cellHasVisionText ? '✓' : '✗'}
                          {'\n'}Pixels: Full={cell.hasContentByPixels ? '✓' : '✗'} ({cell.fileSize}b), Sub1={cell.sub1HasContent ? '✓' : '✗'} ({cell.sub1FileSize}b), Sub2={cell.sub2HasContent ? '✓' : '✗'} ({cell.sub2FileSize}b)
                        </Text>
                        <Text style={styles.cellImageLabel}>Full Cell:</Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <View style={{flexDirection: 'row', gap: 5}}>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub1:</Text>
                            {cell.croppedSub1Uri && (
                              <Image
                                source={{ uri: cell.croppedSub1Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub2:</Text>
                            {cell.croppedSub2Uri && (
                              <Image
                                source={{ uri: cell.croppedSub2Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                        </View>
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display cropped TURBOPROP column image */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOPROP Column (2 sub-columns):
                </Text>
                {result2.ocrData.croppedTurbopropColumnUri && (
                  <>
                    <Image
                      source={{ uri: result2.ocrData.croppedTurbopropColumnUri }}
                      style={styles.columnImage}
                      resizeMode="contain"
                    />
                    <Text style={styles.previewText}>
                      Vision detected: {result2.ocrData.turbopropOCRResult.rowCount} rows x {result2.ocrData.turbopropOCRResult.columnCount} columns
                    </Text>
                    <Text style={styles.previewText}>
                      Content detected: {result2.turbopropPresenceMap?.filter((c: any) => c.hasContent).length || 0}/14 cells
                    </Text>
                  </>
                )}
              </View>

              {/* Display TURBOPROP cell images */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>
                  TURBOPROP Cell Images (14 cells, 2 sub-columns each):
                </Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.turbopropCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>
                          Row {cell.row}: {cell.hasContent ? '✓ HAS CONTENT' : '✗ EMPTY'}
                        </Text>
                        <Text style={styles.cellImageVision}>
                          Detection: {cell.detectionMethod || 'None'}
                          {'\n'}Vision: "{cell.visionText || ''}" (conf: {((cell.visionConfidence || 0) * 100).toFixed(0)}%)
                          {'\n'}Cell OCR: {cell.cellHasVisionText ? '✓' : '✗'}
                          {'\n'}Pixels: Full={cell.hasContentByPixels ? '✓' : '✗'} ({cell.fileSize}b), Sub1={cell.sub1HasContent ? '✓' : '✗'} ({cell.sub1FileSize}b), Sub2={cell.sub2HasContent ? '✓' : '✗'} ({cell.sub2FileSize}b)
                        </Text>
                        <Text style={styles.cellImageLabel}>Full Cell:</Text>
                        {cell.croppedImageUri ? (
                          <Image
                            source={{ uri: cell.croppedImageUri }}
                            style={styles.cellImage}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={styles.cellImageError}>
                            {cell.error || 'No image'}
                          </Text>
                        )}
                        <View style={{flexDirection: 'row', gap: 5}}>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub1:</Text>
                            {cell.croppedSub1Uri && (
                              <Image
                                source={{ uri: cell.croppedSub1Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                          <View style={{flex: 1}}>
                            <Text style={styles.cellImageLabel}>Sub2:</Text>
                            {cell.croppedSub2Uri && (
                              <Image
                                source={{ uri: cell.croppedSub2Uri }}
                                style={styles.cellImage}
                                resizeMode="contain"
                              />
                            )}
                          </View>
                        </View>
                        <Text style={styles.cellImageBbox}>
                          ({cell.boundingBox?.x}, {cell.boundingBox?.y}, {cell.boundingBox?.width}, {cell.boundingBox?.height})
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display TOTAL DURATION column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>TOTAL DURATION Column:</Text>
                {result2.ocrData.croppedTOTALColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedTOTALColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.totalCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>TOTAL DURATION Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.totalCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display SINGLE-ENGINE LAND column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE LAND Column:</Text>
                {result2.ocrData.croppedSELColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedSELColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.selCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE LAND Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.selCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display SINGLE-ENGINE SEA column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE SEA Column:</Text>
                {result2.ocrData.croppedSESColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedSESColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.sesCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>SINGLE-ENGINE SEA Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.sesCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display MULTI-ENGINE LAND column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>MULTI-ENGINE LAND Column:</Text>
                {result2.ocrData.croppedMELColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedMELColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.melCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>MULTI-ENGINE LAND Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.melCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display ROTORCRAFT HELICOPTER column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>ROTORCRAFT HELICOPTER Column:</Text>
                {result2.ocrData.croppedHELIColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedHELIColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.heliCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>ROTORCRAFT HELICOPTER Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.heliCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Display GLIDER column and cells */}
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>GLIDER Column:</Text>
                {result2.ocrData.croppedGLIDERColumnUri && (
                  <Image source={{ uri: result2.ocrData.croppedGLIDERColumnUri }} style={styles.columnImage} resizeMode="contain" />
                )}
                <Text style={styles.previewText}>Content: {result2.ocrData.gliderCells?.filter((c: any) => c.hasContent).length || 0}/14 cells</Text>
              </View>
              <View style={styles.dataPreview}>
                <Text style={styles.previewTitle}>GLIDER Cell Images:</Text>
                <ScrollView style={styles.cellImagesScroll}>
                  <View style={styles.cellImagesGrid}>
                    {result2.ocrData.gliderCells?.map((cell: any, idx: number) => (
                      <View key={idx} style={styles.cellImageContainer}>
                        <Text style={styles.cellImageLabel}>Row {cell.row}: {cell.hasContent ? '✓' : '✗'} ({cell.detectionMethod})</Text>
                        {cell.croppedImageUri && <Image source={{ uri: cell.croppedImageUri }} style={styles.cellImage} resizeMode="contain" />}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <View style={styles.shareButtonsRow}>
                <TouchableOpacity
                  style={[styles.shareButton, styles.shareButtonHalf]}
                  onPress={shareResults}
                >
                  <Text style={styles.shareButtonText}>📤 CSV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.shareButton, styles.shareButtonHalf]}
                  onPress={shareDetailedResults}
                >
                  <Text style={styles.shareButtonText}>📋 Full Report</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
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
  scrollContent: {
    paddingBottom: 40,
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
  columnImage: {
    width: '100%',
    height: 400,
    backgroundColor: '#000',
    borderRadius: 4,
    marginVertical: 8,
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
  cellImagesScroll: {
    maxHeight: 400,
  },
  cellImagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  cellImageContainer: {
    width: '48%',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  cellImageLabel: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  cellImageVision: {
    color: '#2196F3',
    fontSize: 10,
    fontFamily: 'Courier',
    marginBottom: 4,
  },
  cellImage: {
    width: '100%',
    height: 60,
    backgroundColor: '#000',
    borderRadius: 4,
    marginBottom: 4,
  },
  cellImageBbox: {
    color: '#888',
    fontSize: 10,
    fontFamily: 'Courier',
  },
  cellImageError: {
    color: '#f44336',
    fontSize: 10,
    fontStyle: 'italic',
    padding: 8,
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
