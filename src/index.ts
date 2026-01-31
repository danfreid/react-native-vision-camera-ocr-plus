export { Camera, useTranslate, useTextRecognition } from './Camera';

export { RemoveLanguageModel } from './RemoveLanguageModel';

export { PhotoRecognizer } from './PhotoRecognizer';

export {
  DocumentRecognizer,
  DualImageRecognizer,
  formatTableAsText,
  formatTableAsCSV,
  formatTableAsQuotedCSV,
  formatTableWithConfidences,
} from './DocumentRecognizer';
export type {
  BoundingBox,
  TableCell,
  TableColumn,
  DetectedTable,
  DocumentRecognitionResult,
  DocumentRecognizerOptions,
  MatchedCell,
  DataCell,
  ColumnData,
  CellConfidence,
} from './DocumentRecognizer';

export * from './types';

// Enhanced LLM-based table extraction (iOS 26+)
export {
  initializeLLM,
  processTableWithLLM,
  isLLMAvailable,
} from './DocumentRecognizerWithLLM';
export type {
  TableCell as LLMTableCell,
  TableStructure,
  FlightCalculations,
  EnhancedTableResult,
} from './DocumentRecognizerWithLLM';
