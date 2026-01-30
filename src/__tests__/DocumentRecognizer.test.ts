import { NativeModules, Platform } from 'react-native';
import {
  DocumentRecognizer,
  formatTableAsText,
  formatTableAsCSV,
  type DetectedTable,
} from '../DocumentRecognizer';

// Mock NativeModules
jest.mock('react-native', () => ({
  NativeModules: {
    DocumentRecognizerModule: {
      process: jest.fn(),
    },
  },
  Platform: {
    OS: 'ios',
  },
}));

describe('DocumentRecognizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw error when uri is not provided', async () => {
    await expect(DocumentRecognizer({ uri: '' })).rejects.toThrow(
      "Can't resolve image uri"
    );
  });

  it('should throw error when module is not linked', async () => {
    (NativeModules as any).DocumentRecognizerModule = null;

    await expect(
      DocumentRecognizer({ uri: 'file:///test.jpg' })
    ).rejects.toThrow('DocumentRecognizerModule is not properly linked');
  });

  it('should process image on iOS', async () => {
    const mockResult = {
      tables: [],
      rawText: 'test text',
      matchedCells: [],
    };

    (NativeModules as any).DocumentRecognizerModule = {
      process: jest.fn().mockResolvedValue(mockResult),
    };
    (Platform as any).OS = 'ios';

    const result = await DocumentRecognizer({ uri: 'file:///test.jpg' });

    expect(NativeModules.DocumentRecognizerModule.process).toHaveBeenCalledWith(
      '/test.jpg',
      expect.any(Array)
    );
    expect(result.tables).toEqual([]);
    expect(result.rawText).toBe('test text');
  });

  it('should process image on Android', async () => {
    const mockResult = {
      tables: [],
      rawText: 'test text',
    };

    (NativeModules as any).DocumentRecognizerModule = {
      process: jest.fn().mockResolvedValue(mockResult),
    };
    (Platform as any).OS = 'android';

    const result = await DocumentRecognizer({ uri: '/test.jpg' });

    expect(NativeModules.DocumentRecognizerModule.process).toHaveBeenCalledWith(
      'file:///test.jpg'
    );
    expect(result.tables).toEqual([]);
    expect(result.rawText).toBe('test text');
  });
});

describe('formatTableAsText', () => {
  it('should format a simple table', () => {
    const table: DetectedTable = {
      boundingBox: { xMin: 0, yMin: 0, xMax: 100, yMax: 100 },
      rowCount: 2,
      columnCount: 2,
      columns: [
        {
          boundingBox: { xMin: 0, yMin: 0, xMax: 50, yMax: 100 },
          columnIndex: 0,
          cells: [
            {
              text: 'A1',
              boundingBox: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 },
              rowIndex: 0,
              columnIndex: 0,
            },
            {
              text: 'A2',
              boundingBox: { xMin: 0, yMin: 50, xMax: 50, yMax: 100 },
              rowIndex: 1,
              columnIndex: 0,
            },
          ],
        },
        {
          boundingBox: { xMin: 50, yMin: 0, xMax: 100, yMax: 100 },
          columnIndex: 1,
          cells: [
            {
              text: 'B1',
              boundingBox: { xMin: 50, yMin: 0, xMax: 100, yMax: 50 },
              rowIndex: 0,
              columnIndex: 1,
            },
            {
              text: 'B2',
              boundingBox: { xMin: 50, yMin: 50, xMax: 100, yMax: 100 },
              rowIndex: 1,
              columnIndex: 1,
            },
          ],
        },
      ],
    };

    const result = formatTableAsText(table);

    expect(result).toContain('A1');
    expect(result).toContain('B1');
    expect(result).toContain('A2');
    expect(result).toContain('B2');
    expect(result).toContain('|');
    expect(result).toContain('+');
  });

  it('should handle empty table', () => {
    const table: DetectedTable = {
      boundingBox: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      rowCount: 0,
      columnCount: 0,
      columns: [],
    };

    const result = formatTableAsText(table);
    expect(result).toBe('++\n++');
  });
});

describe('formatTableAsCSV', () => {
  it('should format a simple table as CSV', () => {
    const table: DetectedTable = {
      boundingBox: { xMin: 0, yMin: 0, xMax: 100, yMax: 100 },
      rowCount: 2,
      columnCount: 2,
      columns: [
        {
          boundingBox: { xMin: 0, yMin: 0, xMax: 50, yMax: 100 },
          columnIndex: 0,
          cells: [
            {
              text: 'Name',
              boundingBox: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 },
              rowIndex: 0,
              columnIndex: 0,
            },
            {
              text: 'John',
              boundingBox: { xMin: 0, yMin: 50, xMax: 50, yMax: 100 },
              rowIndex: 1,
              columnIndex: 0,
            },
          ],
        },
        {
          boundingBox: { xMin: 50, yMin: 0, xMax: 100, yMax: 100 },
          columnIndex: 1,
          cells: [
            {
              text: 'Age',
              boundingBox: { xMin: 50, yMin: 0, xMax: 100, yMax: 50 },
              rowIndex: 0,
              columnIndex: 1,
            },
            {
              text: '30',
              boundingBox: { xMin: 50, yMin: 50, xMax: 100, yMax: 100 },
              rowIndex: 1,
              columnIndex: 1,
            },
          ],
        },
      ],
    };

    const result = formatTableAsCSV(table);

    expect(result).toBe('Name,Age\nJohn,30');
  });

  it('should escape special characters in CSV', () => {
    const table: DetectedTable = {
      boundingBox: { xMin: 0, yMin: 0, xMax: 100, yMax: 50 },
      rowCount: 1,
      columnCount: 2,
      columns: [
        {
          boundingBox: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 },
          columnIndex: 0,
          cells: [
            {
              text: 'Hello, World',
              boundingBox: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 },
              rowIndex: 0,
              columnIndex: 0,
            },
          ],
        },
        {
          boundingBox: { xMin: 50, yMin: 0, xMax: 100, yMax: 50 },
          columnIndex: 1,
          cells: [
            {
              text: 'Say "Hi"',
              boundingBox: { xMin: 50, yMin: 0, xMax: 100, yMax: 50 },
              rowIndex: 0,
              columnIndex: 1,
            },
          ],
        },
      ],
    };

    const result = formatTableAsCSV(table);

    expect(result).toBe('"Hello, World","Say ""Hi"""');
  });
});
