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

export default function HybridFlightLogExtractor() {
  const [leftImage, setLeftImage] = useState<string | null>(null);
  const [rightImage, setRightImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [modelReady, setModelReady] = useState(false);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelConfig | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const contextRef = useRef<LlamaContext | null>(null);

  useEffect(() => {
    checkAndLoadModel();
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

      const modelsDir = new Directory(Paths.document, 'models');
      const modelFile = new File(modelsDir, model.modelFile);
      const mmprojFile = new File(modelsDir, model.mmprojFile);

      if (!modelFile.exists || !mmprojFile.exists) {
        setStatus('Model files not found');
        return;
      }

      // Release old context if exists
      if (contextRef.current) {
        await contextRef.current.release();
        contextRef.current = null;
      }

      const context = await initLlama({
        model: modelFile.uri,
        use_mlock: true,
        n_ctx: 8192,
        n_gpu_layers: 99,
      });

      await context.initMultimodal({
        path: mmprojFile.uri,
      });

      contextRef.current = context;
      setSelectedModel(model);
      setModelReady(true);
      setStatus('Model ready');
    } catch (error: any) {
      console.error('Model load error:', error);
      setStatus(`Error: ${error.message}`);
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
    setProgress(0);
    setResult(null);

    try {
      // Step 1: Get OCR bounding boxes
      setStatus('Running Vision OCR...');
      setProgress(10);

      const ocrResult = await DualImageRecognizer({
        leftUri: leftImage,
        rightUri: rightImage,
      });

      console.log('OCR complete:', {
        leftCells: ocrResult.cellData.left.length,
        rightCells: ocrResult.cellData.right.length,
      });

      // Step 2: Format OCR data for LLM
      setStatus('Preparing data for LLM...');
      setProgress(30);

      const ocrSummary = formatOCRForLLM(ocrResult);

      // Step 3: Run LLM extraction
      setStatus('Extracting with Qwen3-VL...');
      setProgress(50);

      const prompt = `${SYSTEM_PROMPT}

OCR BOUNDING BOX DATA (showing table structure and cell positions):
${ocrSummary}

INSTRUCTIONS:
1. Use the bounding box data to understand row and column positions
2. For each row, extract data from BOTH left and right pages
3. Match rows by their physical position (row number)
4. Handle empty cells correctly using spatial information
5. Apply OCR error corrections as specified above
6. Validate that time columns sum correctly

Return ONLY a JSON array with one object per flight entry. Each object should have these fields:
{
  "date": "MM-DD-YYYY",
  "aircraft": "aircraft make/model",
  "ident": "N-number",
  "route": "FROM-TO",
  "totalDuration": 0.0,
  "sel": 0.0,
  "ses": 0.0,
  "mel": 0.0,
  "turbojet": 0.0,
  "turboprop": 0.0,
  "heli": 0.0,
  "glider": 0.0,
  "landingsDay": 0,
  "landingsNight": 0,
  "night": 0.0,
  "actualInstrument": 0.0,
  "simulatedInstrument": 0.0,
  "appNo": 0,
  "appType": "",
  "flightSim": 0.0,
  "crossCountry": 0.0,
  "solo": 0.0,
  "pic": 0.0,
  "sic": 0.0,
  "dual": 0.0,
  "cfi": 0.0,
  "remarks": ""
}

Return ONLY the JSON array, no explanations or markdown.`;

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
          n_predict: 4000,
          temperature: 0.1,
          stop: ['</s>', '\n\n\n'],
        },
        (data) => {
          // Progress callback
          if (data.token) {
            setProgress(50 + (data.token.length / 4000) * 40);
          }
        }
      );

      setProgress(95);
      setStatus('Parsing results...');

      // Parse LLM output
      const extracted = parseModelOutput(completion.text);

      setResult({
        ocrData: ocrResult,
        extractedFlights: extracted,
        rawLLMOutput: completion.text,
      });

      setProgress(100);
      setStatus('Complete!');
    } catch (error: any) {
      console.error('Processing error:', error);
      Alert.alert('Error', error.message);
      setStatus('Error occurred');
    } finally {
      setIsProcessing(false);
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
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
    return [];
  };

  const shareResults = async () => {
    if (!result) return;

    try {
      const csv = convertToCSV(result.extractedFlights);
      const file = new File(Paths.cache, `flight-log-${Date.now()}.csv`);
      await file.write(csv);
      await Sharing.shareAsync(file.uri);
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
        return flight[key] || '';
      });
      csv += row.join(',') + '\n';
    });

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
          <Text style={styles.resultsTitle}>Results</Text>

          <View style={styles.statsCard}>
            <Text style={styles.statsText}>
              Flights extracted: {result.extractedFlights.length}
            </Text>
            <Text style={styles.statsText}>
              OCR cells detected: {result.ocrData.metadata.totalCells}
            </Text>
          </View>

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

          <TouchableOpacity style={styles.shareButton} onPress={shareResults}>
            <Text style={styles.shareButtonText}>📤 Share CSV</Text>
          </TouchableOpacity>
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
