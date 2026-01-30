import { NativeModules, Platform } from 'react-native';

export interface BoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface TableCell {
  text: string;
  boundingBox: BoundingBox;
  rowIndex: number;
  columnIndex: number;
  /** OCR confidence score (0-1) - available on iOS 26+ */
  confidence?: number;
}

export interface TableColumn {
  boundingBox: BoundingBox;
  columnIndex: number;
  cells: TableCell[];
}

export interface DetectedTable {
  boundingBox: BoundingBox;
  columns: TableColumn[];
  rowCount: number;
  columnCount: number;
}

/** Confidence score for a single cell */
export interface CellConfidence {
  /** Row index */
  rowIndex: number;
  /** Column index */
  columnIndex: number;
  /** Cell text */
  text: string;
  /** OCR confidence score (0-1) */
  confidence: number;
}

/** Paragraph detected in document (iOS 26+) */
export interface DetectedParagraph {
  /** Full text content of the paragraph */
  text: string;
  /** Bounding box of the paragraph */
  boundingBox: BoundingBox;
}

/** 
 * Detected data types from iOS 26+ DataDetection framework.
 * Automatically identifies emails, phone numbers, addresses, URLs, etc.
 */
export type DetectedDataType = 
  | 'email'
  | 'phoneNumber'
  | 'postalAddress'
  | 'url'
  | 'calendarEvent'
  | 'moneyAmount'
  | 'measurement'
  | 'other';

/** Data detected in document text (iOS 26+) */
export interface DetectedData {
  /** The type of data detected */
  type: DetectedDataType;
  /** The raw text that was detected */
  text: string;
  /** The parsed/normalized value */
  value: string;
}

export interface DocumentRecognitionResult {
  tables: DetectedTable[];
  rawText: string;
  /** Cells matching the searchCells criteria with their full bounds */
  matchedCells?: MatchedCell[];
  /** Data cells under each matched column header */
  columnData?: ColumnData[];
  /** Confidence scores for all detected cells (iOS 26+) */
  cellConfidences?: CellConfidence[];
  /** Paragraphs detected in the document (iOS 26+ only) */
  paragraphs?: DetectedParagraph[];
  /** 
   * Automatically detected data like emails, phone numbers, addresses (iOS 26+ only).
   * Uses Apple's DataDetection framework for accurate parsing.
   */
  detectedData?: DetectedData[];
}

/** Data cell with value and bounding box */
export interface DataCell {
  /** Cell value/text (empty string if cell is empty) */
  value: string;
  /** Cell bounding box */
  boundingBox: BoundingBox;
  /** Row index */
  rowIndex: number;
  /** Cell range in spreadsheet notation */
  cellRange: string;
  /** OCR confidence score (0-1), null if cell is empty/interpolated */
  confidence: number | null;
  /** Whether this cell was empty in the original OCR */
  isEmpty: boolean;
}

/** All data cells under a column header */
export interface ColumnData {
  /** The column header text that was matched */
  headerText: string;
  /** The search term that matched this header */
  searchTerm: string;
  /** Column index */
  columnIndex: number;
  /** Column letter (e.g., "A", "B") */
  columnRange: string;
  /** Header cell bounding box */
  headerBoundingBox: BoundingBox;
  /** All data cells in this column (rows below the header) */
  cells: DataCell[];
}

/** A cell that matched a search term */
export interface MatchedCell {
  /** The search term that matched */
  searchTerm: string;
  /** The actual cell text */
  text: string;
  /** OCR confidence score (0-1) */
  confidence: number;
  /** Tight bounding box around just the text */
  textBoundingBox: BoundingBox;
  /** Expanded bounding box to grid lines/cell separators */
  expandedBoundingBox: BoundingBox;
  /** Row index in the table */
  rowIndex: number;
  /** Column index in the table */
  columnIndex: number;
  /** Cell range in spreadsheet notation (e.g., "A1", "B2") */
  cellRange: string;
  /** Column range/letter (e.g., "A", "B", "AA") */
  columnRange: string;
}

export interface DocumentRecognizerOptions {
  uri: string;
  /** Expand cell bounding boxes to fill the grid (to cell separators) */
  expandCellBounds?: boolean;
  /** Specific cell texts to search for and return with full bounds. Case-insensitive partial match. */
  searchCells?: string[];
}

/**
 * Recognizes tables from two images (left and right pages) and combines them into a single CSV.
 * 
 * @param leftUri - URI of the left page image
 * @param rightUri - URI of the right page image
 * @returns Promise resolving to combined CSV string
 * 
 * @example
 * ```typescript
 * const result = await DualImageRecognizer({
 *   leftUri: 'file:///path/to/left.jpg',
 *   rightUri: 'file:///path/to/right.jpg'
 * });
 * console.log(result.csv);
 * ```
 */
export async function DualImageRecognizer(options: {
  leftUri: string;
  rightUri: string;
}): Promise<{ csv: string }> {
  const { DocumentRecognizerModule } = NativeModules;
  const { leftUri, rightUri } = options;

  if (!leftUri || !rightUri) {
    throw new Error("Both left and right image URIs are required");
  }

  if (
    !DocumentRecognizerModule ||
    typeof DocumentRecognizerModule.processDualImages !== 'function'
  ) {
    throw new Error(
      'DocumentRecognizerModule.processDualImages is not available. Please ensure react-native-vision-camera-ocr-plus is correctly installed.'
    );
  }

  let processLeftUri = leftUri;
  let processRightUri = rightUri;

  if (Platform.OS === 'ios') {
    processLeftUri = leftUri.replace('file://', '');
    processRightUri = rightUri.replace('file://', '');
  } else {
    const hasSchemeLeft = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(processLeftUri);
    if (!hasSchemeLeft) {
      processLeftUri = `file://${processLeftUri}`;
    }
    const hasSchemeRight = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(processRightUri);
    if (!hasSchemeRight) {
      processRightUri = `file://${processRightUri}`;
    }
  }

  return await DocumentRecognizerModule.processDualImages(processLeftUri, processRightUri);
}

/**
 * Recognizes tables in document images.
 * 
 * On iOS 26+, uses native RecognizeDocumentsRequest for accurate table detection.
 * On older iOS versions and Android, uses text recognition with spatial analysis
 * to infer table structure.
 * 
 * @param options - Options containing the image URI
 * @returns Promise resolving to detected tables with their structure
 * 
 * @example
 * ```typescript
 * const result = await DocumentRecognizer({ uri: 'file:///path/to/image.jpg' });
 * 
 * for (const table of result.tables) {
 *   console.log(`Table: ${table.rowCount} rows x ${table.columnCount} columns`);
 *   for (const column of table.columns) {
 *     for (const cell of column.cells) {
 *       console.log(`[${cell.rowIndex}, ${cell.columnIndex}]: ${cell.text}`);
 *     }
 *   }
 * }
 * ```
 */
export async function DocumentRecognizer(
  options: DocumentRecognizerOptions
): Promise<DocumentRecognitionResult> {
  const { DocumentRecognizerModule } = NativeModules;
  const { 
    uri, 
    expandCellBounds = true,
    searchCells = [
      'DATE',
      'MAKE AND',
      'MODEL',
      'IDENT',
      'FROM',
      'TO',
      'DURATION',
      'FLIGHT',
      'LAND',
      'SEA',
      'SINGLE',
      'MULTI',
      'ROTORCRAFT',
      'HELICOPTER',
      'GLIDER',
      'LANDINGS',
      'LNDGS',
      'NIGHT',
      'ACTUAL',
      'SIMULATED',
      'HOOD',
      'APP',
      'NO. TYPE',
      'SIMULATOR',
      'CROSS',
      'COUNTRY',
      'SOLO',
      'PILOT',
      'SECOND',
      'DUAL',
      'RECEIVED',
      'INSTRUCTOR',
      'REMARKS',
      'ENDORSEMENTS'
    ],
  } = options;

  if (!uri) {
    throw new Error("Can't resolve image uri");
  }

  if (
    !DocumentRecognizerModule ||
    typeof DocumentRecognizerModule.process !== 'function'
  ) {
    throw new Error(
      'DocumentRecognizerModule is not properly linked. Please ensure react-native-vision-camera-ocr-plus is correctly installed and linked.'
    );
  }

  let processUri = uri;

  if (Platform.OS === 'ios') {
    processUri = uri.replace('file://', '');
    // iOS: pass search terms to native for direct Vision framework search
    const rawResult = await DocumentRecognizerModule.process(processUri, searchCells);
    
    // Post-process tables to expand bounds
    const processedTables = rawResult.tables.map((table: DetectedTable) => 
      processTable(table, expandCellBounds)
    );

    // Add cellRange and columnRange to matched cells
    const matchedCells = (rawResult.matchedCells || []).map((cell: any) => ({
      ...cell,
      confidence: cell.confidence ?? 0,
      cellRange: getCellRange(cell.columnIndex, cell.rowIndex),
      columnRange: getColumnRange(cell.columnIndex),
    }));

    // Extract column data for each matched header
    const columnData = extractColumnData(processedTables, matchedCells);

    return {
      tables: processedTables,
      rawText: rawResult.rawText,
      matchedCells,
      columnData,
      cellConfidences: rawResult.cellConfidences,
      // iOS 26+ features
      paragraphs: rawResult.paragraphs,
      detectedData: rawResult.detectedData,
    };
  } else {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(processUri);
    if (!hasScheme) {
      processUri = `file://${processUri}`;
    }
    
    // Android: process and search in JS
    const rawResult: DocumentRecognitionResult = await DocumentRecognizerModule.process(processUri);
    
    const processedTables = rawResult.tables.map(table => 
      processTable(table, expandCellBounds)
    );

    // Search for specific cells in processed tables
    const matchedCells: MatchedCell[] = [];
    if (searchCells.length > 0) {
      processedTables.forEach((table) => {
        for (const column of table.columns) {
          for (const cell of column.cells) {
            const cellTextUpper = cell.text.toUpperCase();
            for (const searchTerm of searchCells) {
              if (cellTextUpper.includes(searchTerm.toUpperCase())) {
                matchedCells.push({
                  searchTerm,
                  text: cell.text,
                  confidence: 0, // Android doesn't provide confidence yet
                  textBoundingBox: cell.boundingBox,
                  expandedBoundingBox: cell.boundingBox,
                  rowIndex: cell.rowIndex,
                  columnIndex: cell.columnIndex,
                  cellRange: getCellRange(cell.columnIndex, cell.rowIndex),
                  columnRange: getColumnRange(cell.columnIndex),
                });
              }
            }
          }
        }
      });
    }

    // Extract column data for each matched header
    const columnData = extractColumnData(processedTables, matchedCells);

    return {
      tables: processedTables,
      rawText: rawResult.rawText,
      matchedCells,
      columnData,
    };
  }
}

/**
 * Convert column index to spreadsheet column letter (0=A, 1=B, ..., 25=Z, 26=AA, etc.)
 */
function getColumnRange(columnIndex: number): string {
  let result = '';
  let index = columnIndex;
  while (index >= 0) {
    result = String.fromCharCode((index % 26) + 65) + result;
    index = Math.floor(index / 26) - 1;
  }
  return result;
}

/**
 * Convert column and row index to spreadsheet cell notation (e.g., "A1", "B2")
 */
function getCellRange(columnIndex: number, rowIndex: number): string {
  return `${getColumnRange(columnIndex)}${rowIndex + 1}`;
}

/**
 * Extract all data cells under each matched column header
 * Includes empty cells to maintain row order
 */
function extractColumnData(tables: DetectedTable[], matchedCells: MatchedCell[]): ColumnData[] {
  const columnDataMap: Map<string, ColumnData> = new Map();
  
  for (const match of matchedCells) {
    // Use columnIndex as key to avoid duplicates for same column
    const key = `${match.columnIndex}`;
    
    if (columnDataMap.has(key)) {
      continue; // Already processed this column
    }
    
    // Find the table that contains this column
    for (const table of tables) {
      const column = table.columns.find(c => c.columnIndex === match.columnIndex);
      if (!column) continue;
      
      // Get the header row index
      const headerRowIndex = match.rowIndex;
      
      // Calculate total rows in table (from header to end)
      const maxRowIndex = Math.max(...column.cells.map(c => c.rowIndex));
      
      // Build a map of existing cells by row index
      const cellsByRow: Map<number, TableCell> = new Map();
      for (const cell of column.cells) {
        cellsByRow.set(cell.rowIndex, cell);
      }
      
      // Calculate row heights for interpolating empty cell bounds
      const rowBounds = calculateRowBounds(table);
      
      // Create data cells for ALL rows below header (including empty ones)
      const dataCells: DataCell[] = [];
      for (let rowIdx = headerRowIndex + 1; rowIdx <= maxRowIndex; rowIdx++) {
        const existingCell = cellsByRow.get(rowIdx);
        
        if (existingCell && existingCell.text.trim() !== '') {
          // Cell has content
          dataCells.push({
            value: existingCell.text,
            boundingBox: existingCell.boundingBox,
            rowIndex: rowIdx,
            cellRange: getCellRange(match.columnIndex, rowIdx),
            confidence: null, // Will be filled from native if available
            isEmpty: false,
          });
        } else {
          // Empty cell - interpolate bounding box from column and row bounds
          const colBounds = column.boundingBox;
          const rowBound = rowBounds.get(rowIdx);
          
          const emptyBounds: BoundingBox = rowBound ? {
            xMin: colBounds.xMin,
            yMin: rowBound.yMin,
            xMax: colBounds.xMax,
            yMax: rowBound.yMax,
          } : {
            xMin: colBounds.xMin,
            yMin: colBounds.yMin,
            xMax: colBounds.xMax,
            yMax: colBounds.yMin + 20, // Default height for missing rows
          };
          
          dataCells.push({
            value: '',
            boundingBox: emptyBounds,
            rowIndex: rowIdx,
            cellRange: getCellRange(match.columnIndex, rowIdx),
            confidence: null,
            isEmpty: true,
          });
        }
      }
      
      // Sort by row index
      dataCells.sort((a, b) => a.rowIndex - b.rowIndex);
      
      columnDataMap.set(key, {
        headerText: match.text,
        searchTerm: match.searchTerm,
        columnIndex: match.columnIndex,
        columnRange: match.columnRange,
        headerBoundingBox: match.expandedBoundingBox,
        cells: dataCells,
      });
      
      break; // Found the table, no need to continue
    }
  }
  
  // Convert map to array and sort by column index
  return Array.from(columnDataMap.values()).sort((a, b) => a.columnIndex - b.columnIndex);
}

/**
 * Calculate bounding box for each row in a table
 */
function calculateRowBounds(table: DetectedTable): Map<number, BoundingBox> {
  const rowBounds: Map<number, BoundingBox> = new Map();
  
  // Collect all cells by row
  const cellsByRow: Map<number, TableCell[]> = new Map();
  for (const column of table.columns) {
    for (const cell of column.cells) {
      if (!cellsByRow.has(cell.rowIndex)) {
        cellsByRow.set(cell.rowIndex, []);
      }
      cellsByRow.get(cell.rowIndex)!.push(cell);
    }
  }
  
  // Calculate bounds for each row
  for (const [rowIdx, cells] of cellsByRow) {
    if (cells.length === 0) continue;
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const cell of cells) {
      minX = Math.min(minX, cell.boundingBox.xMin);
      minY = Math.min(minY, cell.boundingBox.yMin);
      maxX = Math.max(maxX, cell.boundingBox.xMax);
      maxY = Math.max(maxY, cell.boundingBox.yMax);
    }
    
    rowBounds.set(rowIdx, {
      xMin: minX,
      yMin: minY,
      xMax: maxX,
      yMax: maxY,
    });
  }
  
  return rowBounds;
}

/**
 * Process a table to expand cell bounds
 */
function processTable(
  table: DetectedTable,
  expandCellBounds: boolean
): DetectedTable {
  // Collect all cells
  const allCells: TableCell[] = [];
  
  for (const column of table.columns) {
    for (const cell of column.cells) {
      allCells.push(cell);
    }
  }

  if (allCells.length === 0) {
    return {
      boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      columns: [],
      rowCount: 0,
      columnCount: 0,
    };
  }

  // Calculate row and column counts
  const rowCount = Math.max(...allCells.map(c => c.rowIndex)) + 1;
  const columnCount = Math.max(...allCells.map(c => c.columnIndex)) + 1;

  // If expandCellBounds is true, calculate grid-based bounds
  let finalCells = allCells;
  if (expandCellBounds) {
    finalCells = expandCellBoundsToGrid(allCells, rowCount, columnCount);
  }

  // Rebuild columns from cells
  const columnMap: Map<number, TableCell[]> = new Map();
  for (const cell of finalCells) {
    if (!columnMap.has(cell.columnIndex)) {
      columnMap.set(cell.columnIndex, []);
    }
    columnMap.get(cell.columnIndex)!.push(cell);
  }

  // Build new columns with updated bounds
  const newColumns: TableColumn[] = [];
  for (const [colIdx, cells] of Array.from(columnMap.entries()).sort((a, b) => a[0] - b[0])) {
    const colBounds = calculateBoundsFromCells(cells);
    newColumns.push({
      boundingBox: colBounds,
      columnIndex: colIdx,
      cells: cells.sort((a, b) => a.rowIndex - b.rowIndex),
    });
  }

  // Calculate table bounds from all cells
  const tableBounds = calculateBoundsFromCells(finalCells);

  return {
    boundingBox: tableBounds,
    columns: newColumns,
    rowCount,
    columnCount,
  };
}

/**
 * Expand cell bounding boxes to fill the grid (to cell separators)
 */
function expandCellBoundsToGrid(
  cells: TableCell[],
  rowCount: number,
  columnCount: number
): TableCell[] {
  if (cells.length === 0) return cells;

  // Calculate row boundaries (Y positions)
  const rowYPositions: { minY: number; maxY: number }[] = [];
  for (let r = 0; r < rowCount; r++) {
    const rowCells = cells.filter(c => c.rowIndex === r);
    if (rowCells.length > 0) {
      const minY = Math.min(...rowCells.map(c => c.boundingBox.yMin));
      const maxY = Math.max(...rowCells.map(c => c.boundingBox.yMax));
      rowYPositions[r] = { minY, maxY };
    }
  }

  // Calculate column boundaries (X positions)
  const colXPositions: { minX: number; maxX: number }[] = [];
  for (let c = 0; c < columnCount; c++) {
    const colCells = cells.filter(cell => cell.columnIndex === c);
    if (colCells.length > 0) {
      const minX = Math.min(...colCells.map(cell => cell.boundingBox.xMin));
      const maxX = Math.max(...colCells.map(cell => cell.boundingBox.xMax));
      colXPositions[c] = { minX, maxX };
    }
  }

  // Calculate grid lines (midpoints between adjacent rows/columns)
  const rowLines: number[] = []; // Y coordinates of horizontal lines
  const colLines: number[] = []; // X coordinates of vertical lines

  // First row line is the top of the first row
  if (rowYPositions[0]) {
    rowLines.push(rowYPositions[0].minY);
  }
  // Lines between rows
  for (let r = 0; r < rowCount - 1; r++) {
    const current = rowYPositions[r];
    const next = rowYPositions[r + 1];
    if (current && next) {
      rowLines.push((current.maxY + next.minY) / 2);
    }
  }
  // Last row line is the bottom of the last row
  const lastRowPos = rowYPositions[rowCount - 1];
  if (lastRowPos) {
    rowLines.push(lastRowPos.maxY);
  }

  // First column line is the left of the first column
  if (colXPositions[0]) {
    colLines.push(colXPositions[0].minX);
  }
  // Lines between columns
  for (let c = 0; c < columnCount - 1; c++) {
    const current = colXPositions[c];
    const next = colXPositions[c + 1];
    if (current && next) {
      colLines.push((current.maxX + next.minX) / 2);
    }
  }
  // Last column line is the right of the last column
  const lastColPos = colXPositions[columnCount - 1];
  if (lastColPos) {
    colLines.push(lastColPos.maxX);
  }

  // Expand each cell to fill its grid position
  return cells.map(cell => {
    const topLine = rowLines[cell.rowIndex] ?? cell.boundingBox.yMin;
    const bottomLine = rowLines[cell.rowIndex + 1] ?? cell.boundingBox.yMax;
    const leftLine = colLines[cell.columnIndex] ?? cell.boundingBox.xMin;
    const rightLine = colLines[cell.columnIndex + 1] ?? cell.boundingBox.xMax;

    return {
      ...cell,
      boundingBox: {
        xMin: leftLine,
        yMin: topLine,
        xMax: rightLine,
        yMax: bottomLine,
      },
    };
  });
}

/**
 * Calculate bounding box that encompasses all cells
 */
function calculateBoundsFromCells(cells: TableCell[]): BoundingBox {
  if (cells.length === 0) {
    return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of cells) {
    minX = Math.min(minX, cell.boundingBox.xMin);
    minY = Math.min(minY, cell.boundingBox.yMin);
    maxX = Math.max(maxX, cell.boundingBox.xMax);
    maxY = Math.max(maxY, cell.boundingBox.yMax);
  }

  return {
    xMin: minX,
    yMin: minY,
    xMax: maxX,
    yMax: maxY,
  };
}

/**
 * Formats a detected table as a string for display or sharing.
 * 
 * @param table - The detected table to format
 * @returns Formatted string representation of the table
 */
export function formatTableAsText(table: DetectedTable): string {
  const rows: string[][] = [];
  
  // Initialize rows array
  for (let i = 0; i < table.rowCount; i++) {
    rows[i] = new Array<string>(table.columnCount).fill('');
  }
  
  // Fill in cell values
  for (const column of table.columns) {
    for (const cell of column.cells) {
      const row = rows[cell.rowIndex];
      if (row && cell.rowIndex < table.rowCount && cell.columnIndex < table.columnCount) {
        row[cell.columnIndex] = cell.text;
      }
    }
  }
  
  // Calculate column widths
  const colWidths: number[] = new Array<number>(table.columnCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cellText = row[i] ?? '';
      colWidths[i] = Math.max(colWidths[i] ?? 0, cellText.length);
    }
  }
  
  // Format as text table
  const lines: string[] = [];
  const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  
  lines.push(separator);
  for (const row of rows) {
    const cells = row.map((cell, i) => ` ${cell.padEnd(colWidths[i] ?? 0)} `);
    lines.push('|' + cells.join('|') + '|');
    lines.push(separator);
  }
  
  return lines.join('\n');
}

/**
 * Formats a detected table as CSV for export.
 * 
 * @param table - The detected table to format
 * @param options - Formatting options
 * @returns CSV string representation of the table
 */
export function formatTableAsCSV(
  table: DetectedTable, 
  options?: { 
    /** Always quote all cells with a prefix (e.g., "'") */
    quotePrefix?: string;
  }
): string {
  const { quotePrefix = '' } = options || {};
  const rows: string[][] = [];
  
  for (let i = 0; i < table.rowCount; i++) {
    rows[i] = new Array<string>(table.columnCount).fill('');
  }
  
  for (const column of table.columns) {
    for (const cell of column.cells) {
      const row = rows[cell.rowIndex];
      if (row && cell.rowIndex < table.rowCount && cell.columnIndex < table.columnCount) {
        let value = cell.text;
        // Escape internal quotes by doubling them
        if (value.includes('"')) {
          value = value.replace(/"/g, '""');
        }
        // Always wrap in quotes with optional prefix
        row[cell.columnIndex] = `"${quotePrefix}${value}"`;
      }
    }
  }
  
  return rows.map(row => row.join(',')).join('\n');
}

/**
 * Formats a detected table as a quoted CSV where every cell is quoted with a prefix.
 * This format is useful for preserving exact cell boundaries and handling special characters.
 * 
 * @param table - The detected table to format
 * @param prefix - Prefix to add before each cell value (default: "'")
 * @returns CSV string with all cells quoted
 * 
 * @example
 * ```typescript
 * const csv = formatTableAsQuotedCSV(table);
 * // Output: "'YEAR","'96","'ROUTE","'OF FLIGHT",...
 * ```
 */
export function formatTableAsQuotedCSV(table: DetectedTable, prefix: string = "'"): string {
  const rows: string[][] = [];
  
  for (let i = 0; i < table.rowCount; i++) {
    rows[i] = new Array<string>(table.columnCount).fill(`"${prefix}"`);
  }
  
  for (const column of table.columns) {
    for (const cell of column.cells) {
      const row = rows[cell.rowIndex];
      if (row && cell.rowIndex < table.rowCount && cell.columnIndex < table.columnCount) {
        let value = cell.text;
        // Escape internal quotes by doubling them
        if (value.includes('"')) {
          value = value.replace(/"/g, '""');
        }
        row[cell.columnIndex] = `"${prefix}${value}"`;
      }
    }
  }
  
  return rows.map(row => row.join(',')).join('\n');
}

/**
 * Formats a detected table as a quoted CSV with confidence scores appended.
 * Each cell is quoted with a prefix, and confidence scores are added at the end.
 * 
 * @param table - The detected table to format
 * @param cellConfidences - Array of cell confidence scores from DocumentRecognizer result
 * @param prefix - Prefix to add before each cell value (default: "'")
 * @returns CSV string with all cells quoted and confidence scores appended
 * 
 * @example
 * ```typescript
 * const result = await DocumentRecognizer({ uri: imageUri });
 * const csv = formatTableWithConfidences(result.tables[0], result.cellConfidences);
 * // Output: "'YEAR","'96",...,'Confidence Scores % (Table Cell)"'66.45","'87.25",...
 * ```
 */
export function formatTableWithConfidences(
  table: DetectedTable, 
  cellConfidences?: CellConfidence[],
  prefix: string = "'"
): string {
  const rows: string[][] = [];
  
  // Initialize rows with empty quoted cells
  for (let i = 0; i < table.rowCount; i++) {
    rows[i] = new Array<string>(table.columnCount).fill(`"${prefix}"`);
  }
  
  // Fill in cell values
  for (const column of table.columns) {
    for (const cell of column.cells) {
      const row = rows[cell.rowIndex];
      if (row && cell.rowIndex < table.rowCount && cell.columnIndex < table.columnCount) {
        let value = cell.text;
        if (value.includes('"')) {
          value = value.replace(/"/g, '""');
        }
        row[cell.columnIndex] = `"${prefix}${value}"`;
      }
    }
  }
  
  // Build the main CSV content
  let csvContent = rows.map(row => row.join(',')).join('\n');
  
  // Append confidence scores if available
  if (cellConfidences && cellConfidences.length > 0) {
    const confidenceValues = cellConfidences.map(conf => 
      `"${prefix}${(conf.confidence * 100).toFixed(8)}"`
    );
    csvContent += `,'Confidence Scores % (Table Cell)${confidenceValues.join(',')}`;
  }
  
  return csvContent;
}
