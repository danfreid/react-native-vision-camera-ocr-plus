import * as React from 'react';
import {
  Alert,
  Button,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import {
  DocumentRecognizer,
  DualImageRecognizer,
  formatTableAsText,
  formatTableAsQuotedCSV,
  formatTableWithConfidences,
  PhotoRecognizer,
  ScanRegion,
  useTextRecognition,
  type DetectedTable,
  type MatchedCell,
  type ColumnData,
  type CellConfidence,
} from 'react-native-vision-camera-ocr';
import * as ImagePicker from 'expo-image-picker';

const scanRegion = {
  left: '25%',
  top: '30%',
  width: '50%',
  height: '23%',
} as ScanRegion;

export default function App() {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [detectedText, setDetectedText] = React.useState<string>();
  const [image, setImage] = React.useState<string | null>(null);
  const [imageText, setImageText] = React.useState<string>('');
  const [modalMode, setModalMode] = React.useState<'photo' | 'document' | 'dual'>('photo');
  const [detectedTables, setDetectedTables] = React.useState<DetectedTable[]>([]);
  const [cellConfidences, setCellConfidences] = React.useState<CellConfidence[]>([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [leftImage, setLeftImage] = React.useState<string | null>(null);
  const [rightImage, setRightImage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  React.useEffect(() => {
    const processImage = async () => {
      if (!image || image === 'dual-picker') return;
      
      setIsProcessing(true);
      setImageText('');
      setDetectedTables([]);
      setCellConfidences([]);

      try {
        if (modalMode === 'photo') {
          const result = await PhotoRecognizer({
            uri: image,
            orientation: 'portrait',
          });
          setImageText(result.resultText || '');
        } else if (modalMode === 'document') {
          const result = await DocumentRecognizer({ uri: image });
          
          let logOutput = `=== DocumentRecognizer Result ===\n`;
          logOutput += `Tables found: ${result.tables.length}\n`;
          
          result.tables.forEach((table, tIdx) => {
            logOutput += `\n--- Table ${tIdx + 1} ---\n`;
            logOutput += `Rows: ${table.rowCount}, Columns: ${table.columnCount}\n`;
          });
          
          logOutput += `\nRaw text: ${result.rawText}\n`;
          
          setDetectedTables(result.tables);
          setCellConfidences(result.cellConfidences || []);
          setImageText(logOutput);
        }
      } catch (error) {
        Alert.alert('Error processing image', (error as Error).message);
      } finally {
        setIsProcessing(false);
      }
    };

    processImage();
  }, [image, modalMode]);

  const onText = React.useMemo(
    () =>
      Worklets.createRunOnJS((items: string) => {
        setDetectedText(items);
      }),
    []
  );

  const { scanText } = useTextRecognition({
    scanRegion,
  });

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      const scannedText = scanText(frame);
      if (scannedText?.resultText) {
        onText(scannedText.resultText);
      }
    },
    [scanText, onText]
  );

  const pickDualImages = () => {
    setModalMode('dual');
    setImage('dual-picker');
    setLeftImage(null);
    setRightImage(null);
    setImageText('');
  };

  const pickLeftImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled) {
      setLeftImage(result.assets[0].uri);
    }
  };

  const pickRightImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled) {
      setRightImage(result.assets[0].uri);
    }
  };

  const processDualImages = async () => {
    if (!leftImage || !rightImage) {
      Alert.alert('Error', 'Please select both left and right images');
      return;
    }

    setIsProcessing(true);
    setImageText('');

    try {
      const result = await DualImageRecognizer({
        leftUri: leftImage,
        rightUri: rightImage,
      });
      setImageText(result.csv);
    } catch (error) {
      Alert.alert('Error processing images', (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const pickImage = async (mode: 'photo' | 'document') => {
    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(
        'Permission required',
        'Permission to access the media library is required.'
      );
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      allowsMultipleSelection: false,
    });

    if (!result.canceled) {
      setModalMode(mode);
      setImage(result.assets[0].uri);
    }
  };

  const shareTableAsText = async () => {
    if (!imageText) return;
    
    try {
      await Share.share({
        message: imageText,
        title: 'Detected Tables',
      });
    } catch (error) {
      Alert.alert('Error sharing', (error as Error).message);
    }
  };

  const shareTableAsCSV = async () => {
    if (detectedTables.length === 0) return;
    
    const csvContent = detectedTables.map((table, idx) => {
      return `# Table ${idx + 1}\n${formatTableWithConfidences(table, cellConfidences, "'")}`;
    }).join('\n\n');
    
    try {
      await Share.share({
        message: csvContent,
        title: 'Detected Tables (CSV)',
      });
    } catch (error) {
      Alert.alert('Error sharing', (error as Error).message);
    }
  };

  const closeModal = () => {
    setImage(null);
    setLeftImage(null);
    setRightImage(null);
    setDetectedTables([]);
    setCellConfidences([]);
    setImageText('');
  };

  if (!device || !hasPermission) {
    return (
      <View style={styles.center}>
        <Text>
          {!device ? 'No camera device' : 'Requesting camera permission…'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        frameProcessor={frameProcessor}
      />
      <View style={styles.scanRegion} />
      <View style={styles.overlay}>
        <Text style={styles.title}>Detected text:</Text>
        <Text style={styles.line}>{detectedText}</Text>
      </View>
      <View style={styles.buttonContainer}>
        <View style={styles.buttonRow}>
          <Button title="Photo OCR" onPress={() => pickImage('photo')} />
          <View style={styles.buttonSpacer} />
          <Button title="Table Scanner" onPress={() => pickImage('document')} />
          <View style={styles.buttonSpacer} />
          <Button title="Dual Table" onPress={pickDualImages} />
        </View>
      </View>
      
      <Modal visible={!!image} animationType="slide">
        <View style={styles.modalContainer}>
          {image && image !== 'dual-picker' && (
            <Image
              source={{ uri: image }}
              style={styles.image}
              resizeMode="contain"
            />
          )}
          
          <ScrollView style={styles.resultsContainer}>
            {isProcessing ? (
              <View style={styles.processingContainer}>
                <Text style={styles.processingText}>Processing...</Text>
              </View>
            ) : modalMode === 'dual' ? (
              <View style={styles.dualImagePicker}>
                <Text style={styles.dualTitle}>Select Left and Right Pages</Text>
                
                <View style={styles.dualImageRow}>
                  <View style={styles.dualImageSection}>
                    <Text style={styles.dualImageLabel}>📖 Left Page</Text>
                    {leftImage ? (
                      <Image source={{ uri: leftImage }} style={styles.dualImageThumb} />
                    ) : (
                      <View style={styles.dualImagePlaceholder}>
                        <Text style={styles.dualImagePlaceholderText}>No image</Text>
                      </View>
                    )}
                    <TouchableOpacity style={styles.pickButton} onPress={pickLeftImage}>
                      <Text style={styles.pickButtonText}>Pick Left</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.dualImageSection}>
                    <Text style={styles.dualImageLabel}>📖 Right Page</Text>
                    {rightImage ? (
                      <Image source={{ uri: rightImage }} style={styles.dualImageThumb} />
                    ) : (
                      <View style={styles.dualImagePlaceholder}>
                        <Text style={styles.dualImagePlaceholderText}>No image</Text>
                      </View>
                    )}
                    <TouchableOpacity style={styles.pickButton} onPress={pickRightImage}>
                      <Text style={styles.pickButtonText}>Pick Right</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                
                {leftImage && rightImage && (
                  <TouchableOpacity style={styles.processButton} onPress={processDualImages}>
                    <Text style={styles.processButtonText}>🔄 Process Images</Text>
                  </TouchableOpacity>
                )}
                
                {imageText && (
                  <View style={styles.csvResult}>
                    <Text style={styles.csvTitle}>Combined CSV:</Text>
                    <ScrollView horizontal style={styles.csvScroll}>
                      <Text style={styles.csvText}>{imageText}</Text>
                    </ScrollView>
                    <TouchableOpacity style={styles.shareButton} onPress={shareTableAsText}>
                      <Text style={styles.shareButtonText}>📤 Share CSV</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : modalMode === 'document' ? (
              <View style={styles.tableResults}>
                <Text style={styles.title}>
                  {detectedTables.length > 0
                    ? `Found ${detectedTables.length} table(s)`
                    : 'No tables detected'}
                </Text>
                
                {detectedTables.map((table, tableIdx) => (
                  <View key={tableIdx} style={styles.tableCard}>
                    <Text style={styles.tableHeader}>
                      Table {tableIdx + 1}: {table.rowCount} rows × {table.columnCount} cols
                    </Text>
                    <Text style={styles.tableContent}>
                      {formatTableAsText(table)}
                    </Text>
                  </View>
                ))}
                
                {detectedTables.length > 0 && (
                  <View style={styles.shareButtons}>
                    <Button title="Share as Text" onPress={shareTableAsText} />
                    <View style={styles.buttonSpacer} />
                    <Button title="Share as CSV" onPress={shareTableAsCSV} />
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.overlay}>
                <Text style={styles.title}>Detected text from image:</Text>
                <Text style={styles.line}>{imageText}</Text>
              </View>
            )}
          </ScrollView>
          
          <View style={styles.closeButtonContainer}>
            <Button title="Close" onPress={closeModal} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanRegion: {
    ...scanRegion,
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'red',
  },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 100,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 12,
    borderRadius: 12,
  },
  title: { color: 'white', fontWeight: '600', marginBottom: 8 },
  line: { color: 'white' },
  modalContainer: { backgroundColor: '#1a1a1a', flex: 1 },
  buttonContainer: { position: 'absolute', top: 48, right: 16 },
  buttonRow: { flexDirection: 'row' },
  buttonSpacer: { width: 8 },
  image: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.4,
  },
  resultsContainer: {
    flex: 1,
    padding: 16,
  },
  processingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  processingText: {
    color: 'white',
    fontSize: 16,
  },
  tableResults: {
    flex: 1,
  },
  tableCard: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  tableHeader: {
    color: '#4CAF50',
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 8,
  },
  tableContent: {
    color: 'white',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  shareButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 16,
  },
  closeButtonContainer: {
    position: 'absolute',
    top: 48,
    right: 16,
  },
  dualImagePicker: {
    flex: 1,
    padding: 16,
  },
  dualTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 24,
  },
  dualImageRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  dualImageSection: {
    flex: 1,
    alignItems: 'center',
  },
  dualImageLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  dualImageThumb: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    backgroundColor: '#2d2d44',
    marginBottom: 12,
  },
  dualImagePlaceholder: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    backgroundColor: '#2d2d44',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  dualImagePlaceholderText: {
    color: '#666',
    fontSize: 14,
  },
  pickButton: {
    backgroundColor: '#4a90d9',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  pickButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  processButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 24,
  },
  processButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  csvResult: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 16,
  },
  csvTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  csvScroll: {
    maxHeight: 200,
    marginBottom: 16,
  },
  csvText: {
    color: 'white',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  shareButton: {
    backgroundColor: '#FF9500',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
