import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  initializeLLM,
  processTableWithLLM,
  isLLMAvailable,
  type EnhancedTableResult,
} from 'react-native-vision-camera-ocr';

const FLIGHT_LOG_CONTEXT = `Flight logbook with aircraft info (left) and flight times (right). Fix OCR errors: Ø→0, LB25→LR25, BE-Z-O→BE-200, 2|8→2.8`;

export default function EnhancedFlightLogExtractor() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [leftImage, setLeftImage] = useState<string | null>(null);
  const [rightImage, setRightImage] = useState<string | null>(null);
  const [result, setResult] = useState<EnhancedTableResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initializeModel();
  }, []);

  const initializeModel = async () => {
    try {
      if (!isLLMAvailable()) {
        setError('Foundation Models requires iOS 26+ with Apple Intelligence enabled');
        return;
      }

      const initResult = await initializeLLM();
      console.log('LLM initialized:', initResult.message);
      setIsInitialized(true);
    } catch (err: any) {
      console.error('Initialization error:', err);
      setError(err.message || 'Failed to initialize Foundation Models');
    }
  };

  const pickImage = async (side: 'left' | 'right') => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        if (side === 'left') {
          setLeftImage(uri);
        } else {
          setRightImage(uri);
        }
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const processImages = async () => {
    if (!leftImage || !rightImage) {
      Alert.alert('Error', 'Please select both left and right page images');
      return;
    }

    if (!isInitialized) {
      Alert.alert('Error', 'Foundation Models not initialized');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      console.log('Processing images with Foundation Models...');
      const extractionResult = await processTableWithLLM(
        leftImage,
        rightImage,
        FLIGHT_LOG_CONTEXT
      );

      console.log('=== LLM EXTRACTION COMPLETE ===');
      console.log('CSV:', extractionResult.csv);
      console.log('Raw LLM Response:', JSON.stringify(extractionResult.rawLLMResponse, null, 2));
      console.log('Total hours:', extractionResult.calculations.totalHours);
      console.log('Rows extracted:', extractionResult.leftTable.rowCount);

      setResult(extractionResult);
    } catch (err: any) {
      console.error('Processing error:', err);
      setError(err.message || 'Failed to process images');
      Alert.alert('Error', err.message || 'Failed to process images');
    } finally {
      setIsProcessing(false);
    }
  };

  const exportCSV = async () => {
    if (!result) return;

    try {
      // In a real app, you would save this to a file or share it
      console.log('CSV Data:\n', result.csv);
      Alert.alert('Success', 'CSV data logged to console');
    } catch (err) {
      console.error('Export error:', err);
      Alert.alert('Error', 'Failed to export CSV');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Enhanced Flight Log Extractor</Text>
        <Text style={styles.subtitle}>
          Powered by Apple Foundation Models
        </Text>
        {!isInitialized && !error && (
          <ActivityIndicator size="small" style={styles.initIndicator} />
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      {isInitialized && (
        <>
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
                  {leftImage ? 'Change' : 'Select'} Left Page
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
                  {rightImage ? 'Change' : 'Select'} Right Page
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.processButton,
              (!leftImage || !rightImage || isProcessing) &&
                styles.buttonDisabled,
            ]}
            onPress={processImages}
            disabled={!leftImage || !rightImage || isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.processButtonText}>
                Extract Flight Data
              </Text>
            )}
          </TouchableOpacity>

          {result && (
            <View style={styles.resultsSection}>
              <Text style={styles.resultsTitle}>Extraction Results</Text>

              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {result.calculations.totalHours.toFixed(1)}
                  </Text>
                  <Text style={styles.statLabel}>Total Hours</Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {result.calculations.totalPIC.toFixed(1)}
                  </Text>
                  <Text style={styles.statLabel}>PIC Hours</Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {result.calculations.totalNight.toFixed(1)}
                  </Text>
                  <Text style={styles.statLabel}>Night Hours</Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {result.calculations.totalCrossCountry.toFixed(1)}
                  </Text>
                  <Text style={styles.statLabel}>Cross Country</Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {result.calculations.dayLandings}
                  </Text>
                  <Text style={styles.statLabel}>Day Landings</Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {result.calculations.nightLandings}
                  </Text>
                  <Text style={styles.statLabel}>Night Landings</Text>
                </View>
              </View>

              <View style={styles.metadataSection}>
                <Text style={styles.metadataTitle}>Table Structure</Text>
                <Text style={styles.metadataText}>
                  Left Page: {result.metadata.leftRows} rows ×{' '}
                  {result.metadata.leftColumns} columns
                </Text>
                <Text style={styles.metadataText}>
                  Right Page: {result.metadata.rightRows} rows ×{' '}
                  {result.metadata.rightColumns} columns
                </Text>
              </View>

              <View style={styles.csvPreview}>
                <Text style={styles.csvTitle}>CSV Preview</Text>
                <ScrollView
                  horizontal
                  style={styles.csvScroll}
                  showsHorizontalScrollIndicator={true}
                >
                  <Text style={styles.csvText}>
                    {result.csv.split('\n').slice(0, 10).join('\n')}
                    {result.csv.split('\n').length > 10 && '\n...'}
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.cellPreview}>
                <Text style={styles.cellPreviewTitle}>Cell Data with Headers</Text>
                <ScrollView style={styles.cellPreviewScroll}>
                  <Text style={styles.cellPreviewSubtitle}>Left Table (first 10 cells):</Text>
                  {result.rawLLMResponse.leftTable.cells.slice(0, 10).map((cell, idx) => (
                    <Text key={`left-${idx}`} style={styles.cellPreviewText}>
                      [{cell.row},{cell.column}] {cell.columnHeader}: "{cell.value}" ({(cell.confidence * 100).toFixed(1)}%)
                    </Text>
                  ))}
                  
                  <Text style={[styles.cellPreviewSubtitle, {marginTop: 16}]}>Right Table (first 10 cells):</Text>
                  {result.rawLLMResponse.rightTable.cells.slice(0, 10).map((cell, idx) => (
                    <Text key={`right-${idx}`} style={styles.cellPreviewText}>
                      [{cell.row},{cell.column}] {cell.columnHeader}: "{cell.value}" ({(cell.confidence * 100).toFixed(1)}%)
                    </Text>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.jsonPreview}>
                <Text style={styles.jsonTitle}>Raw LLM JSON Response</Text>
                <ScrollView
                  style={styles.jsonScroll}
                  showsVerticalScrollIndicator={true}
                >
                  <Text style={styles.jsonText}>
                    {JSON.stringify(result.rawLLMResponse, null, 2)}
                  </Text>
                </ScrollView>
              </View>

              <TouchableOpacity
                style={styles.exportButton}
                onPress={exportCSV}
              >
                <Text style={styles.exportButtonText}>Export CSV</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  initIndicator: {
    marginTop: 10,
  },
  errorText: {
    color: '#d32f2f',
    marginTop: 10,
    fontSize: 14,
  },
  imageSection: {
    flexDirection: 'row',
    padding: 10,
    gap: 10,
  },
  imageContainer: {
    flex: 1,
  },
  imageLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
  },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#999',
    fontSize: 14,
  },
  button: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#2196F3',
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  processButton: {
    margin: 20,
    padding: 16,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    alignItems: 'center',
  },
  processButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  resultsSection: {
    padding: 20,
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  metadataSection: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  metadataTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  metadataText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  csvPreview: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  csvTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  csvScroll: {
    maxHeight: 200,
  },
  csvText: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#333',
  },
  cellPreview: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  cellPreviewTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  cellPreviewSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#2196F3',
  },
  cellPreviewScroll: {
    maxHeight: 300,
  },
  cellPreviewText: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: '#555',
    marginBottom: 4,
    paddingLeft: 8,
  },
  jsonPreview: {
    backgroundColor: '#1e1e1e',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  jsonTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#4CAF50',
  },
  jsonScroll: {
    maxHeight: 300,
  },
  jsonText: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: '#d4d4d4',
    lineHeight: 16,
  },
  exportButton: {
    padding: 16,
    backgroundColor: '#FF9800',
    borderRadius: 8,
    alignItems: 'center',
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
