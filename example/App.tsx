import * as React from 'react';
import {
  Alert,
  Image,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { DualImageRecognizer } from 'react-native-vision-camera-ocr';
import * as ImagePicker from 'expo-image-picker';

export default function App() {
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [leftImage, setLeftImage] = React.useState<string | null>(null);
  const [rightImage, setRightImage] = React.useState<string | null>(null);
  const [showModal, setShowModal] = React.useState(false);
  const [results, setResults] = React.useState<any>(null);

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
    setResults(null);

    try {
      const result = await DualImageRecognizer({
        leftUri: leftImage,
        rightUri: rightImage,
      });
      
      console.log('=== DUAL TABLE RESULTS ===');
      console.log('CSV:', result.csv);
      console.log('Left Table:', result.leftTable);
      console.log('Right Table:', result.rightTable);
      console.log('Cell Data:', result.cellData);
      console.log('Metadata:', result.metadata);
      console.log('Date Column:', result.dateColumn);
      console.log('Rectangles:', result.rectangles);
      
      setResults(result);
    } catch (error) {
      Alert.alert('Error processing images', (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const openDualTable = () => {
    setShowModal(true);
    setLeftImage(null);
    setRightImage(null);
    setResults(null);
  };

  const shareResults = async () => {
    if (!results) return;
    
    // Build comprehensive output with ALL data
    let output = `
========================================
DUAL TABLE OCR RESULTS
========================================

${results.csv}

========================================
METADATA
========================================
Left Rows: ${results.metadata.leftRows}
Left Columns: ${results.metadata.leftColumns}
Right Rows: ${results.metadata.rightRows}
Right Columns: ${results.metadata.rightColumns}
Total Cells: ${results.metadata.totalCells}
Processing Date: ${results.metadata.processingDate}

========================================
TABLE STRUCTURE
========================================

LEFT TABLE:
- Rows: ${results.leftTable.rowCount}
- Columns: ${results.leftTable.columnCount}
- Column definitions: ${results.leftTable.columns.length}

RIGHT TABLE:
- Rows: ${results.rightTable.rowCount}
- Columns: ${results.rightTable.columnCount}
- Column definitions: ${results.rightTable.columns.length}

========================================
ALL CELL DATA WITH BOUNDING BOXES
========================================

LEFT PAGE CELLS (${results.cellData.left.length} total):
`;

    // Add ALL left cells with full details
    results.cellData.left.forEach((cell: any, idx: number) => {
      output += `
Cell ${idx + 1}:
  Position: [Row ${cell.row}, Column ${cell.column}]
  Value: "${cell.value}"
  Confidence: ${(cell.confidence * 100).toFixed(2)}%
  Bounding Box: ${Math.round(cell.boundingBox.x)}, ${Math.round(cell.boundingBox.y)}, ${Math.round(cell.boundingBox.height)}, ${Math.round(cell.boundingBox.width)}
  Bounds Detail: Left=${Math.round(cell.boundingBox.left)}, Top=${Math.round(cell.boundingBox.top)}, Right=${Math.round(cell.boundingBox.right)}, Bottom=${Math.round(cell.boundingBox.bottom)}
`;
    });

    output += `
RIGHT PAGE CELLS (${results.cellData.right.length} total):
`;

    // Add ALL right cells with full details
    results.cellData.right.forEach((cell: any, idx: number) => {
      output += `
Cell ${idx + 1}:
  Position: [Row ${cell.row}, Column ${cell.column}]
  Value: "${cell.value}"
  Confidence: ${(cell.confidence * 100).toFixed(2)}%
  Bounding Box: ${Math.round(cell.boundingBox.x)}, ${Math.round(cell.boundingBox.y)}, ${Math.round(cell.boundingBox.height)}, ${Math.round(cell.boundingBox.width)}
  Bounds Detail: Left=${Math.round(cell.boundingBox.left)}, Top=${Math.round(cell.boundingBox.top)}, Right=${Math.round(cell.boundingBox.right)}, Bottom=${Math.round(cell.boundingBox.bottom)}
`;
    });

    output += `
========================================
LEFT TABLE COLUMN STRUCTURE
========================================
`;

    // Add ALL left table columns with cells
    results.leftTable.columns.forEach((col: any, idx: number) => {
      output += `
Column ${idx + 1} (Index ${col.columnIndex}):
  Bounding Box: ${Math.round(col.boundingBox.x)}, ${Math.round(col.boundingBox.y)}, ${Math.round(col.boundingBox.height)}, ${Math.round(col.boundingBox.width)}
  Cells in column: ${col.cells.length}
`;
      col.cells.forEach((cell: any, cellIdx: number) => {
        output += `    Cell ${cellIdx + 1}: [${cell.row},${cell.column}] "${cell.value}" (conf: ${(cell.confidence * 100).toFixed(2)}%)\n`;
      });
    });

    output += `
========================================
RIGHT TABLE COLUMN STRUCTURE
========================================
`;

    // Add ALL right table columns with cells
    results.rightTable.columns.forEach((col: any, idx: number) => {
      output += `
Column ${idx + 1} (Index ${col.columnIndex}):
  Bounding Box: ${Math.round(col.boundingBox.x)}, ${Math.round(col.boundingBox.y)}, ${Math.round(col.boundingBox.height)}, ${Math.round(col.boundingBox.width)}
  Cells in column: ${col.cells.length}
`;
      col.cells.forEach((cell: any, cellIdx: number) => {
        output += `    Cell ${cellIdx + 1}: [${cell.row},${cell.column}] "${cell.value}" (conf: ${(cell.confidence * 100).toFixed(2)}%)\n`;
      });
    });

    output += `
========================================
DATE COLUMN EXTRACTION
========================================
Column Name: ${results.dateColumn.columnName}
Column Bounds:
  - Left: ${Math.round(results.dateColumn.columnBounds.left)}
  - Right: ${Math.round(results.dateColumn.columnBounds.right)}
  - Top: ${Math.round(results.dateColumn.columnBounds.top)}
  - Bottom: ${Math.round(results.dateColumn.columnBounds.bottom)}
  - Width: ${Math.round(results.dateColumn.columnBounds.width)}
  - Height: ${Math.round(results.dateColumn.columnBounds.height)}

Cells in date column: ${results.dateColumn.cells?.length || 0}
`;

    results.dateColumn.cells?.forEach((cell: any, idx: number) => {
      output += `
  Cell ${idx + 1}:
    Value: "${cell.value}"
    Confidence: ${(cell.confidence * 100).toFixed(2)}%
    Is Header: ${cell.isHeader}
    Bounds: Left=${Math.round(cell.boundingBox.left)}, Top=${Math.round(cell.boundingBox.top)}, Right=${Math.round(cell.boundingBox.right)}, Bottom=${Math.round(cell.boundingBox.bottom)}
`;
    });

    output += `
========================================
DETECTED RECTANGLES (Vision Framework)
========================================

LEFT PAGE RECTANGLES: ${results.rectangles.left.length}
`;

    results.rectangles.left.forEach((rect: any, idx: number) => {
      output += `
  Rectangle ${idx + 1}:
    Top-Left: (${Math.round(rect.topLeft.x)}, ${Math.round(rect.topLeft.y)})
    Top-Right: (${Math.round(rect.topRight.x)}, ${Math.round(rect.topRight.y)})
    Bottom-Left: (${Math.round(rect.bottomLeft.x)}, ${Math.round(rect.bottomLeft.y)})
    Bottom-Right: (${Math.round(rect.bottomRight.x)}, ${Math.round(rect.bottomRight.y)})
    Confidence: ${(rect.confidence * 100).toFixed(2)}%
`;
    });

    output += `
RIGHT PAGE RECTANGLES: ${results.rectangles.right.length}
`;

    results.rectangles.right.forEach((rect: any, idx: number) => {
      output += `
  Rectangle ${idx + 1}:
    Top-Left: (${Math.round(rect.topLeft.x)}, ${Math.round(rect.topLeft.y)})
    Top-Right: (${Math.round(rect.topRight.x)}, ${Math.round(rect.topRight.y)})
    Bottom-Left: (${Math.round(rect.bottomLeft.x)}, ${Math.round(rect.bottomLeft.y)})
    Bottom-Right: (${Math.round(rect.bottomRight.x)}, ${Math.round(rect.bottomRight.y)})
    Confidence: ${(rect.confidence * 100).toFixed(2)}%
`;
    });

    output += `
========================================
COMPLETE JSON DATA
========================================

${JSON.stringify(results, null, 2)}

========================================
END OF REPORT
========================================
Generated: ${new Date().toLocaleString()}
`;
    
    try {
      await Share.share({
        message: output,
        title: 'Dual Table OCR Results - Complete Data',
      });
    } catch (error) {
      Alert.alert('Error sharing', (error as Error).message);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setLeftImage(null);
    setRightImage(null);
    setResults(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dual Table OCR</Text>
        <Text style={styles.headerSubtitle}>Extract data from dual-page spreads</Text>
      </View>
      
      <View style={styles.content}>
        <TouchableOpacity style={styles.mainButton} onPress={openDualTable}>
          <Text style={styles.mainButtonText}>📖 Scan Dual Table</Text>
        </TouchableOpacity>
      </View>
      
      <Modal visible={showModal} animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Dual Table Scanner</Text>
            <TouchableOpacity onPress={closeModal}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            <View style={styles.dualImagePicker}>
              <Text style={styles.instructionText}>
                Select left and right page images to extract table data
              </Text>
              
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
                    <Text style={styles.pickButtonText}>
                      {leftImage ? 'Change' : 'Select'} Left
                    </Text>
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
                    <Text style={styles.pickButtonText}>
                      {rightImage ? 'Change' : 'Select'} Right
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              {leftImage && rightImage && !isProcessing && !results && (
                <TouchableOpacity style={styles.processButton} onPress={processDualImages}>
                  <Text style={styles.processButtonText}>🔄 Process Images</Text>
                </TouchableOpacity>
              )}
              
              {isProcessing && (
                <View style={styles.processingContainer}>
                  <Text style={styles.processingText}>Processing images...</Text>
                </View>
              )}
              
              {results && (
                <View style={styles.resultsSection}>
                  <Text style={styles.resultsTitle}>✅ Extraction Complete</Text>
                  
                  <View style={styles.statsCard}>
                    <Text style={styles.statsTitle}>Metadata</Text>
                    <Text style={styles.statsText}>Left: {results.metadata.leftRows} rows × {results.metadata.leftColumns} cols</Text>
                    <Text style={styles.statsText}>Right: {results.metadata.rightRows} rows × {results.metadata.rightColumns} cols</Text>
                    <Text style={styles.statsText}>Total Cells: {results.metadata.totalCells}</Text>
                    <Text style={styles.statsText}>Date: {new Date(results.metadata.processingDate).toLocaleString()}</Text>
                  </View>
                  
                  <View style={styles.csvCard}>
                    <Text style={styles.csvTitle}>Combined CSV</Text>
                    <ScrollView horizontal style={styles.csvScroll}>
                      <Text style={styles.csvText}>{results.csv}</Text>
                    </ScrollView>
                  </View>
                  
                  <View style={styles.detailsCard}>
                    <Text style={styles.detailsTitle}>All Cell Data with Bounding Boxes</Text>
                    <Text style={styles.detailsText}>
                      Left page: {results.cellData.left.length} cells{'\n'}
                      Right page: {results.cellData.right.length} cells
                    </Text>
                    <ScrollView style={styles.cellDataScroll}>
                      <Text style={styles.cellDataTitle}>Left Page Cells:</Text>
                      {results.cellData.left.slice(0, 10).map((cell: any, idx: number) => (
                        <Text key={`left-${idx}`} style={styles.cellDataText}>
                          [{cell.row},{cell.column}] "{cell.value}" {'\n'}
                          Conf: {(cell.confidence * 100).toFixed(1)}% | Bounds: {Math.round(cell.boundingBox.x)}, {Math.round(cell.boundingBox.y)}, {Math.round(cell.boundingBox.height)}, {Math.round(cell.boundingBox.width)}
                        </Text>
                      ))}
                      {results.cellData.left.length > 10 && (
                        <Text style={styles.cellDataMore}>
                          ... and {results.cellData.left.length - 10} more cells (see share output for all)
                        </Text>
                      )}
                      
                      <Text style={[styles.cellDataTitle, {marginTop: 16}]}>Right Page Cells:</Text>
                      {results.cellData.right.slice(0, 10).map((cell: any, idx: number) => (
                        <Text key={`right-${idx}`} style={styles.cellDataText}>
                          [{cell.row},{cell.column}] "{cell.value}" {'\n'}
                          Conf: {(cell.confidence * 100).toFixed(1)}% | Bounds: {Math.round(cell.boundingBox.x)}, {Math.round(cell.boundingBox.y)}, {Math.round(cell.boundingBox.height)}, {Math.round(cell.boundingBox.width)}
                        </Text>
                      ))}
                      {results.cellData.right.length > 10 && (
                        <Text style={styles.cellDataMore}>
                          ... and {results.cellData.right.length - 10} more cells (see share output for all)
                        </Text>
                      )}
                    </ScrollView>
                  </View>
                  
                  <View style={styles.detailsCard}>
                    <Text style={styles.detailsTitle}>Table Structure</Text>
                    <ScrollView style={styles.structureScroll}>
                      <Text style={styles.structureTitle}>Left Table:</Text>
                      <Text style={styles.structureText}>
                        {results.leftTable.columnCount} columns, {results.leftTable.rowCount} rows
                      </Text>
                      {results.leftTable.columns.slice(0, 5).map((col: any, idx: number) => (
                        <Text key={`left-col-${idx}`} style={styles.structureColText}>
                          Col {col.columnIndex}: {col.cells.length} cells | Bounds: {Math.round(col.boundingBox.x)}, {Math.round(col.boundingBox.y)}, {Math.round(col.boundingBox.height)}, {Math.round(col.boundingBox.width)}
                        </Text>
                      ))}
                      {results.leftTable.columns.length > 5 && (
                        <Text style={styles.structureMore}>
                          ... and {results.leftTable.columns.length - 5} more columns
                        </Text>
                      )}
                      
                      <Text style={[styles.structureTitle, {marginTop: 12}]}>Right Table:</Text>
                      <Text style={styles.structureText}>
                        {results.rightTable.columnCount} columns, {results.rightTable.rowCount} rows
                      </Text>
                      {results.rightTable.columns.slice(0, 5).map((col: any, idx: number) => (
                        <Text key={`right-col-${idx}`} style={styles.structureColText}>
                          Col {col.columnIndex}: {col.cells.length} cells | Bounds: {Math.round(col.boundingBox.x)}, {Math.round(col.boundingBox.y)}, {Math.round(col.boundingBox.height)}, {Math.round(col.boundingBox.width)}
                        </Text>
                      ))}
                      {results.rightTable.columns.length > 5 && (
                        <Text style={styles.structureMore}>
                          ... and {results.rightTable.columns.length - 5} more columns
                        </Text>
                      )}
                    </ScrollView>
                  </View>
                  
                  <View style={styles.detailsCard}>
                    <Text style={styles.detailsTitle}>Date Column</Text>
                    {results.dateColumn.columnName ? (
                      <>
                        <Text style={styles.detailsText}>
                          Column: {results.dateColumn.columnName}{'\n'}
                          Cells: {results.dateColumn.cells?.length || 0}{'\n'}
                          Bounds: ({Math.round(results.dateColumn.columnBounds.left)},{Math.round(results.dateColumn.columnBounds.top)}) to ({Math.round(results.dateColumn.columnBounds.right)},{Math.round(results.dateColumn.columnBounds.bottom)})
                        </Text>
                        <ScrollView style={styles.dateColumnScroll}>
                          {results.dateColumn.cells?.slice(0, 10).map((cell: any, idx: number) => (
                            <Text key={`date-${idx}`} style={styles.dateColumnText}>
                              {cell.isHeader ? '📌 ' : '📅 '}"{cell.value}" | Conf: {(cell.confidence * 100).toFixed(1)}%
                            </Text>
                          ))}
                          {(results.dateColumn.cells?.length || 0) > 10 && (
                            <Text style={styles.dateColumnMore}>
                              ... and {(results.dateColumn.cells?.length || 0) - 10} more cells
                            </Text>
                          )}
                        </ScrollView>
                      </>
                    ) : (
                      <Text style={styles.detailsText}>
                        No DATE column found in this page
                      </Text>
                    )}
                  </View>
                  
                  <View style={styles.detailsCard}>
                    <Text style={styles.detailsTitle}>Detected Rectangles</Text>
                    <Text style={styles.detailsText}>
                      Left page: {results.rectangles.left.length} rectangles{'\n'}
                      Right page: {results.rectangles.right.length} rectangles
                    </Text>
                    <Text style={styles.detailsSubtext}>
                      Table cell boundaries detected by Vision framework
                    </Text>
                  </View>
                  
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                      💡 Tap "Share Complete Results" to get ALL data including every cell's bounding box coordinates, confidence scores, and complete JSON output.
                    </Text>
                  </View>
                  
                  <TouchableOpacity style={styles.shareButton} onPress={shareResults}>
                    <Text style={styles.shareButtonText}>📤 Share Complete Results</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={styles.resetButton} onPress={() => {
                    setLeftImage(null);
                    setRightImage(null);
                    setResults(null);
                  }}>
                    <Text style={styles.resetButtonText}>🔄 Scan Another</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#2a2a2a',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#999',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  mainButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 40,
    paddingVertical: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  mainButtonText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#2a2a2a',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  closeButton: {
    fontSize: 28,
    color: '#999',
    paddingHorizontal: 10,
  },
  modalContent: {
    flex: 1,
  },
  dualImagePicker: {
    padding: 20,
  },
  instructionText: {
    color: '#999',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  dualImageRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  dualImageSection: {
    flex: 1,
  },
  dualImageLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  dualImageThumb: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#333',
    marginBottom: 12,
  },
  dualImagePlaceholder: {
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
  dualImagePlaceholderText: {
    color: '#666',
    fontSize: 14,
  },
  pickButton: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  pickButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  processButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  processButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  processingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  processingText: {
    color: 'white',
    fontSize: 16,
  },
  resultsSection: {
    marginTop: 20,
  },
  resultsTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 20,
    textAlign: 'center',
  },
  statsCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  statsTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  statsText: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 6,
  },
  csvCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  csvTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  csvScroll: {
    maxHeight: 200,
  },
  csvText: {
    color: '#ccc',
    fontFamily: 'Courier',
    fontSize: 11,
  },
  detailsCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  detailsTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  detailsText: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 8,
  },
  detailsSubtext: {
    color: '#888',
    fontSize: 12,
    fontStyle: 'italic',
  },
  shareButton: {
    backgroundColor: '#FF9800',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  shareButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  resetButton: {
    backgroundColor: '#666',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  resetButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  cellDataScroll: {
    maxHeight: 300,
    marginTop: 12,
  },
  cellDataTitle: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  cellDataText: {
    color: '#aaa',
    fontSize: 11,
    fontFamily: 'Courier',
    marginBottom: 8,
    paddingLeft: 8,
  },
  cellDataMore: {
    color: '#666',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 8,
  },
  structureScroll: {
    maxHeight: 250,
    marginTop: 12,
  },
  structureTitle: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  structureText: {
    color: '#ccc',
    fontSize: 13,
    marginBottom: 8,
  },
  structureColText: {
    color: '#aaa',
    fontSize: 11,
    fontFamily: 'Courier',
    marginBottom: 4,
    paddingLeft: 8,
  },
  structureMore: {
    color: '#666',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 6,
  },
  dateColumnScroll: {
    maxHeight: 200,
    marginTop: 12,
  },
  dateColumnText: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 6,
    paddingLeft: 8,
  },
  dateColumnMore: {
    color: '#666',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 6,
  },
  infoBox: {
    backgroundColor: '#1a3a5a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  infoText: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 20,
  },
});
