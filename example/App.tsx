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
  const [modalMode, setModalMode] = React.useState<'photo' | 'document'>('photo');
  const [detectedTables, setDetectedTables] = React.useState<DetectedTable[]>([]);
  const [cellConfidences, setCellConfidences] = React.useState<CellConfidence[]>([]);
  const [isProcessing, setIsProcessing] = React.useState(false);

  React.useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  React.useEffect(() => {
    const processImage = async () => {
      if (!image) return;
      
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
        } else {
          const result = await DocumentRecognizer({ uri: image });
          
          // Build detailed log string
          let logOutput = `=== DocumentRecognizer Result ===\n`;
          logOutput += `Tables found: ${result.tables.length}\n`;
          
          result.tables.forEach((table, tIdx) => {
            logOutput += `\n--- Table ${tIdx + 1} ---\n`;
            logOutput += `Table boundingBox: ${JSON.stringify(table.boundingBox)}\n`;
            logOutput += `Rows: ${table.rowCount}, Columns: ${table.columnCount}\n`;
            
            table.columns.forEach((col, cIdx) => {
              logOutput += `\n  Column ${cIdx}:\n`;
              logOutput += `  Column boundingBox: ${JSON.stringify(col.boundingBox)}\n`;
              
              col.cells.forEach((cell) => {
                const confStr = cell.confidence !== undefined ? ` (${(cell.confidence * 100).toFixed(2)}%)` : '';
                logOutput += `    Cell [${cell.rowIndex},${cell.columnIndex}]: "${cell.text}"${confStr}\n`;
                logOutput += `    Cell boundingBox: ${JSON.stringify(cell.boundingBox)}\n`;
              });
            });
          });
          
          // Add cell confidences section (iOS 26+)
          if (result.cellConfidences && result.cellConfidences.length > 0) {
            logOutput += `\n=== Cell Confidence Scores (iOS 26+) ===\n`;
            result.cellConfidences.forEach((conf) => {
              logOutput += `"'${(conf.confidence * 100).toFixed(8)}",`;
            });
            logOutput += `\n`;
          }
          
          // Add matched cells section
          if (result.matchedCells && result.matchedCells.length > 0) {
            logOutput += `\n=== Matched Cells ===\n`;
            result.matchedCells.forEach((match) => {
              logOutput += `\nSearch: "${match.searchTerm}"\n`;
              logOutput += `  Found: "${match.text}"\n`;
              logOutput += `  Confidence: ${(match.confidence * 100).toFixed(1)}%\n`;
              logOutput += `  Cell: ${match.cellRange} (Row: ${match.rowIndex}, Col: ${match.columnIndex})\n`;
              logOutput += `  Column: ${match.columnRange}\n`;
              logOutput += `  Text BoundingBox: ${JSON.stringify(match.textBoundingBox)}\n`;
              logOutput += `  Expanded BoundingBox: ${JSON.stringify(match.expandedBoundingBox)}\n`;
            });
          }
          
          // Add column data section
          if (result.columnData && result.columnData.length > 0) {
            logOutput += `\n=== Column Data ===\n`;
            result.columnData.forEach((col) => {
              logOutput += `\nColumn ${col.columnRange} - "${col.headerText}" (matched: "${col.searchTerm}")\n`;
              logOutput += `  Header BoundingBox: ${JSON.stringify(col.headerBoundingBox)}\n`;
              logOutput += `  Data cells (${col.cells.length}):\n`;
              col.cells.forEach((cell) => {
                const emptyTag = cell.isEmpty ? ' [EMPTY]' : '';
                const confStr = cell.confidence !== null ? ` (${(cell.confidence * 100).toFixed(1)}%)` : '';
                logOutput += `    ${cell.cellRange}: "${cell.value}"${emptyTag}${confStr}\n`;
                logOutput += `      BoundingBox: ${JSON.stringify(cell.boundingBox)}\n`;
              });
            });
          }
          
          logOutput += `\nRaw text: ${result.rawText}\n`;
          logOutput += `=================================`;
          
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
    
    // Use quoted CSV format with "'" prefix and include confidence scores
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
        </View>
      </View>
      
      <Modal visible={!!image} animationType="slide">
        <View style={styles.modalContainer}>
          {image && (
            <Image
              source={{ uri: image }}
              style={styles.image}
              resizeMode="contain"
            />
          )}
          
          <ScrollView style={styles.resultsContainer}>
            {isProcessing ? (
              <View style={styles.processingContainer}>
                <Text style={styles.processingText}>Processing image...</Text>
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
                
                {imageText && (
                  <View style={styles.rawTextContainer}>
                    <Text style={styles.rawTextTitle}>Raw Text:</Text>
                    <Text style={styles.rawText}>{imageText}</Text>
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
  rawTextContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  rawTextTitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  rawText: {
    color: '#ccc',
    fontSize: 12,
  },
  closeButtonContainer: {
    position: 'absolute',
    top: 48,
    right: 16,
  },
});
