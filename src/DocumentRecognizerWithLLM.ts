import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The package 'react-native-vision-camera-ocr' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const DocumentRecognizerWithLLM = NativeModules.DocumentRecognizerWithLLM
  ? NativeModules.DocumentRecognizerWithLLM
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export interface TableCell {
  value: string;
  row: number;
  column: number;
  columnHeader: string;
  confidence: number;
}

export interface TableStructure {
  rowCount: number;
  columnCount: number;
  headers: string[];
  cells: TableCell[];
}

export interface FlightCalculations {
  totalHours: number;
  totalNight: number;
  totalCrossCountry: number;
  totalPIC: number;
  totalDual: number;
  dayLandings: number;
  nightLandings: number;
}

export interface EnhancedTableResult {
  csv: string;
  leftTable: TableStructure;
  rightTable: TableStructure;
  calculations: FlightCalculations;
  metadata: {
    leftRows: number;
    leftColumns: number;
    rightRows: number;
    rightColumns: number;
  };
  /** Raw JSON response from the LLM before CSV conversion */
  rawLLMResponse: {
    leftTable: TableStructure;
    rightTable: TableStructure;
    calculations: FlightCalculations;
  };
}

/**
 * Initialize the Foundation Models LLM for enhanced table extraction.
 * Must be called before using processTableWithLLM.
 * 
 * @returns Promise that resolves when initialization is complete
 * @throws Error if Foundation Models is not available (requires iOS 26+)
 */
export async function initializeLLM(): Promise<{ success: boolean; message: string }> {
  if (Platform.OS !== 'ios') {
    throw new Error('Foundation Models is only available on iOS 26+');
  }
  return DocumentRecognizerWithLLM.initialize();
}

/**
 * Process dual-page flight logbook images using Apple's Foundation Models
 * for enhanced spatial understanding and error correction.
 * 
 * This method combines Vision OCR with on-device LLM to:
 * - Understand table structure (rows, columns, cells)
 * - Correct common OCR errors in handwritten text
 * - Handle decimal formats and special characters
 * - Align data across left and right pages
 * - Calculate totals and summaries
 * 
 * @param leftImageUri - File path to left page image
 * @param rightImageUri - File path to right page image
 * @param contextPrompt - Optional context about the table structure and expected data
 * @returns Enhanced table extraction result with CSV, structure, and calculations
 * 
 * @example
 * ```typescript
 * // Initialize first
 * await initializeLLM();
 * 
 * // Process images
 * const result = await processTableWithLLM(
 *   'file:///path/to/left.jpg',
 *   'file:///path/to/right.jpg',
 *   'Flight logbook with columns: Date, Aircraft, Route, Duration, etc.'
 * );
 * 
 * console.log('CSV:', result.csv);
 * console.log('Total hours:', result.calculations.totalHours);
 * console.log('Left page has', result.leftTable.rowCount, 'rows');
 * ```
 */
export async function processTableWithLLM(
  leftImageUri: string,
  rightImageUri: string,
  contextPrompt: string = 'Flight logbook table with aircraft information and flight times'
): Promise<EnhancedTableResult> {
  if (Platform.OS !== 'ios') {
    throw new Error('Foundation Models is only available on iOS 26+');
  }
  
  // Strip file:// prefix for iOS
  let processLeftUri = leftImageUri.replace('file://', '');
  let processRightUri = rightImageUri.replace('file://', '');
  
  return DocumentRecognizerWithLLM.processTableWithLLM(
    processLeftUri,
    processRightUri,
    contextPrompt
  );
}

/**
 * Check if Foundation Models is available on this device.
 * Requires iOS 26+ and Apple Intelligence enabled.
 */
export function isLLMAvailable(): boolean {
  if (Platform.OS !== 'ios') {
    return false;
  }
  
  // Check iOS version
  const version = parseInt(Platform.Version as string, 10);
  return version >= 26;
}
