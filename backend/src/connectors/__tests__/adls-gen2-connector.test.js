/**
 * Unit Tests for ADLS Gen2 Connector (F4.2.3)
 *
 * Tests the Azure Data Lake Storage Gen2 connector implementation
 * including authentication, document operations, and health checks.
 */

const {
  ADLSGen2Connector,
  AuthenticationType,
  createADLSGen2Connector,
  resetDefaultConnector,
  getADLSGen2Connector,
} = require('../adls-gen2-connector');
const { BaseConnector, ConnectionStatus } = require('../base-connector');

// Mock the Azure SDK
jest.mock('@azure/storage-file-datalake', () => {
  // Helper to create an async iterator with .next() method
  const createMockPathIterator = (items = null) => {
    const defaultItems = [
      {
        name: 'documents/file1.pdf',
        contentLength: 1024,
        lastModified: new Date('2024-01-15T10:00:00Z'),
        etag: '"etag1"',
        isDirectory: false,
        owner: 'user1',
        group: 'group1',
        permissions: 'rwxr-x---',
      },
      {
        name: 'documents/folder',
        isDirectory: true,
      },
      {
        name: 'documents/file2.docx',
        contentLength: 2048,
        lastModified: new Date('2024-01-16T10:00:00Z'),
        etag: '"etag2"',
        isDirectory: false,
      },
    ];

    const actualItems = items || defaultItems;
    let index = 0;

    return {
      next: async function () {
        if (index < actualItems.length) {
          return { value: actualItems[index++], done: false };
        }
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]: function () {
        return this;
      },
      continuationToken: 'token123',
    };
  };

  const mockFileClient = {
    getProperties: jest.fn().mockResolvedValue({
      contentType: 'application/pdf',
      contentLength: 1024,
      createdOn: new Date('2024-01-15T09:00:00Z'),
      lastModified: new Date('2024-01-15T10:00:00Z'),
      etag: '"etag1"',
      accessTier: 'Hot',
      leaseStatus: 'unlocked',
      metadata: { custom: 'value' },
    }),
    read: jest.fn().mockResolvedValue({
      readableStreamBody: (async function* () {
        yield Buffer.from('PDF content here');
      })(),
    }),
  };

  const mockFileSystemClient = {
    exists: jest.fn().mockResolvedValue(true),
    // Return a new iterator each time listPaths is called
    listPaths: jest.fn().mockImplementation(() => createMockPathIterator()),
    getFileClient: jest.fn().mockReturnValue(mockFileClient),
    getProperties: jest.fn().mockResolvedValue({
      lastModified: new Date('2024-01-01T00:00:00Z'),
      etag: '"fs-etag"',
      leaseStatus: 'unlocked',
      leaseState: 'available',
      hasImmutabilityPolicy: false,
      hasLegalHold: false,
      metadata: {},
    }),
  };

  const mockServiceClient = {
    getFileSystemClient: jest.fn().mockReturnValue(mockFileSystemClient),
  };

  return {
    DataLakeServiceClient: jest.fn().mockImplementation(() => mockServiceClient),
    StorageSharedKeyCredential: jest.fn().mockImplementation((account, key) => ({
      accountName: account,
      accountKey: key,
    })),
    __mocks__: {
      mockServiceClient,
      mockFileSystemClient,
      mockFileClient,
      createMockPathIterator,
    },
  };
});

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    type: 'DefaultAzureCredential',
  })),
}));

jest.mock('../../utils/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
  trackMetric: jest.fn(),
}));

describe('ADLSGen2Connector', () => {
  let connector;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultConnector();
    connector = new ADLSGen2Connector('test-connector', {
      accountName: 'teststorage',
      fileSystemName: 'testfs',
      authenticationType: AuthenticationType.DEFAULT_CREDENTIAL,
    });
  });

  afterEach(async () => {
    if (connector && connector.isInitialized) {
      await connector.disconnect();
    }
  });

  // ==========================================================================
  // Constructor and Inheritance Tests
  // ==========================================================================

  describe('Constructor', () => {
    it('should extend BaseConnector', () => {
      expect(connector).toBeInstanceOf(BaseConnector);
    });

    it('should set connector type to adls', () => {
      expect(connector.connectorType).toBe('adls');
    });

    it('should initialize with disconnected status', () => {
      expect(connector.connectionStatus).toBe(ConnectionStatus.DISCONNECTED);
    });

    it('should not be initialized by default', () => {
      expect(connector.isInitialized).toBe(false);
    });

    it('should merge default config with provided config', () => {
      expect(connector.config.accountName).toBe('teststorage');
      expect(connector.config.fileSystemName).toBe('testfs');
      expect(connector.config.batchSize).toBe(50); // default
    });
  });

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('Authentication', () => {
    it('should use DefaultAzureCredential by default', async () => {
      const { DefaultAzureCredential } = require('@azure/identity');

      await connector.initialize();

      expect(DefaultAzureCredential).toHaveBeenCalled();
    });

    it('should use StorageSharedKeyCredential for storage_key auth', async () => {
      const keyConnector = new ADLSGen2Connector('key-connector', {
        accountName: 'teststorage',
        fileSystemName: 'testfs',
        authenticationType: AuthenticationType.STORAGE_KEY,
        storageKey: 'test-storage-key',
      });

      const { StorageSharedKeyCredential } = require('@azure/storage-file-datalake');

      await keyConnector.initialize();

      expect(StorageSharedKeyCredential).toHaveBeenCalledWith('teststorage', 'test-storage-key');
    });

    it('should throw error for storage_key auth without key', async () => {
      const badConnector = new ADLSGen2Connector('bad-connector', {
        accountName: 'teststorage',
        fileSystemName: 'testfs',
        authenticationType: AuthenticationType.STORAGE_KEY,
        // storageKey not provided
      });

      await expect(badConnector.initialize()).rejects.toThrow('Storage key is required');
    });

    it('should throw error for sas_token auth without token', async () => {
      const badConnector = new ADLSGen2Connector('bad-connector', {
        accountName: 'teststorage',
        fileSystemName: 'testfs',
        authenticationType: AuthenticationType.SAS_TOKEN,
        // sasToken not provided
      });

      await expect(badConnector.initialize()).rejects.toThrow('SAS token is required');
    });
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Initialization', () => {
    it('should initialize successfully with valid config', async () => {
      await connector.initialize();

      expect(connector.isInitialized).toBe(true);
      expect(connector.connectionStatus).toBe(ConnectionStatus.CONNECTED);
      expect(connector.initializationTime).toBeInstanceOf(Date);
    });

    it('should throw error when required config is missing', async () => {
      const badConnector = new ADLSGen2Connector('bad-connector', {
        // accountName missing
        fileSystemName: 'testfs',
      });

      await expect(badConnector.initialize()).rejects.toThrow('Missing required configuration');
    });

    it('should log warning if already initialized', async () => {
      const { log } = require('../../utils/logger');

      await connector.initialize();
      await connector.initialize(); // Second call

      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('already initialized'));
    });

    it('should track initialization event', async () => {
      const { trackEvent } = require('../../utils/telemetry');

      await connector.initialize();

      expect(trackEvent).toHaveBeenCalledWith(
        'ADLSConnectorInitialized',
        expect.objectContaining({
          connectorId: 'test-connector',
          accountName: 'teststorage',
          fileSystemName: 'testfs',
        })
      );
    });
  });

  // ==========================================================================
  // Health Check Tests
  // ==========================================================================

  describe('Health Check', () => {
    it('should return healthy status when connected', async () => {
      await connector.initialize();
      const health = await connector.performHealthCheck();

      expect(health.healthy).toBe(true);
      expect(health.message).toContain('healthy');
      expect(health.details).toHaveProperty('latencyMs');
      expect(health.details.accountName).toBe('teststorage');
    });

    it('should return unhealthy status when file system does not exist', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      // Initialize first with a working mock
      await connector.initialize();

      // Now mock the file system as not existing for subsequent health check
      __mocks__.mockFileSystemClient.exists.mockResolvedValueOnce(false);
      const health = await connector.performHealthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain('not found');
    });

    it('should track health check latency metric', async () => {
      const { trackMetric } = require('../../utils/telemetry');

      await connector.initialize();
      await connector.performHealthCheck();

      expect(trackMetric).toHaveBeenCalledWith(
        'ADLSHealthCheckLatency',
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // List Documents Tests
  // ==========================================================================

  describe('List Documents', () => {
    beforeEach(async () => {
      await connector.initialize();
    });

    it('should list documents from ADLS', async () => {
      const result = await connector.listDocuments();

      expect(result.documents).toHaveLength(2); // 2 files, 1 folder filtered
      expect(result.documents[0].name).toBe('file1.pdf');
      expect(result.documents[1].name).toBe('file2.docx');
    });

    it('should filter out directories', async () => {
      const result = await connector.listDocuments();

      const directories = result.documents.filter((d) => d.path.endsWith('/folder'));
      expect(directories).toHaveLength(0);
    });

    it('should include metadata in document listing', async () => {
      const result = await connector.listDocuments();

      const doc = result.documents[0];
      expect(doc).toHaveProperty('id');
      expect(doc).toHaveProperty('sourceId');
      expect(doc).toHaveProperty('name');
      expect(doc).toHaveProperty('path');
      expect(doc).toHaveProperty('mimeType');
      expect(doc).toHaveProperty('size');
      expect(doc).toHaveProperty('modifiedAt');
      expect(doc).toHaveProperty('eTag');
    });

    it('should filter by file extension', async () => {
      const extensionConnector = new ADLSGen2Connector('ext-connector', {
        accountName: 'teststorage',
        fileSystemName: 'testfs',
        fileExtensions: ['pdf'],
      });

      await extensionConnector.initialize();
      const result = await extensionConnector.listDocuments();

      expect(result.documents.every((d) => d.name.endsWith('.pdf'))).toBe(true);
    });

    it('should throw error if not initialized', async () => {
      const uninitConnector = new ADLSGen2Connector('uninit', {
        accountName: 'test',
        fileSystemName: 'test',
      });

      await expect(uninitConnector.listDocuments()).rejects.toThrow('not initialized');
    });

    it('should return continuation token for pagination', async () => {
      const result = await connector.listDocuments({ limit: 2 });

      expect(result.continuationToken).toBe('token123');
    });
  });

  // ==========================================================================
  // Get Document Tests
  // ==========================================================================

  describe('Get Document', () => {
    beforeEach(async () => {
      await connector.initialize();
    });

    it('should download document with content', async () => {
      const result = await connector.getDocument('documents/file1.pdf');

      expect(result.metadata).toBeDefined();
      expect(result.content).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/pdf');
    });

    it('should include document metadata', async () => {
      const result = await connector.getDocument('documents/file1.pdf');

      expect(result.metadata.id).toBe('documents/file1.pdf');
      expect(result.metadata.name).toBe('file1.pdf');
      expect(result.metadata.size).toBe(1024);
      expect(result.metadata.mimeType).toBe('application/pdf');
      expect(result.metadata.contentHash).toBeDefined();
    });

    it('should calculate content hash', async () => {
      const result = await connector.getDocument('documents/file1.pdf');

      expect(result.metadata.contentHash).toMatch(/^[a-f0-9]{32}$/); // MD5 hash
    });

    it('should throw NOT_FOUND error for missing documents', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      __mocks__.mockFileClient.getProperties.mockRejectedValueOnce({ statusCode: 404 });

      await expect(connector.getDocument('nonexistent.pdf')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      });
    });

    it('should track download metrics', async () => {
      const { trackMetric } = require('../../utils/telemetry');

      await connector.getDocument('documents/file1.pdf');

      expect(trackMetric).toHaveBeenCalledWith(
        'ADLSGetDocument',
        expect.any(Number),
        expect.objectContaining({
          connectorId: 'test-connector',
          path: 'documents/file1.pdf',
        })
      );
    });
  });

  // ==========================================================================
  // Get Document Metadata Tests
  // ==========================================================================

  describe('Get Document Metadata', () => {
    beforeEach(async () => {
      await connector.initialize();
    });

    it('should return metadata without content', async () => {
      const metadata = await connector.getDocumentMetadata('documents/file1.pdf');

      expect(metadata.id).toBe('documents/file1.pdf');
      expect(metadata.name).toBe('file1.pdf');
      expect(metadata.size).toBe(1024);
      expect(metadata.eTag).toBe('"etag1"');
    });

    it('should throw NOT_FOUND for missing documents', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      __mocks__.mockFileClient.getProperties.mockRejectedValueOnce({ statusCode: 404 });

      await expect(connector.getDocumentMetadata('missing.pdf')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ==========================================================================
  // Document Exists Tests
  // ==========================================================================

  describe('Document Exists', () => {
    beforeEach(async () => {
      await connector.initialize();
    });

    it('should return true for existing documents', async () => {
      const exists = await connector.documentExists('documents/file1.pdf');
      expect(exists).toBe(true);
    });

    it('should return false for missing documents', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      __mocks__.mockFileClient.getProperties.mockRejectedValueOnce({ statusCode: 404 });

      const exists = await connector.documentExists('missing.pdf');
      expect(exists).toBe(false);
    });
  });

  // ==========================================================================
  // List Directories Tests
  // ==========================================================================

  describe('List Directories', () => {
    beforeEach(async () => {
      await connector.initialize();
    });

    it('should list only directories', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      __mocks__.mockFileSystemClient.listPaths.mockReturnValueOnce(
        __mocks__.createMockPathIterator([
          { name: 'folder1', isDirectory: true, lastModified: new Date() },
          { name: 'folder2', isDirectory: true, lastModified: new Date() },
          { name: 'file.pdf', isDirectory: false, contentLength: 100 },
        ])
      );

      const dirs = await connector.listDirectories();

      expect(dirs).toHaveLength(2);
      expect(dirs[0].name).toBe('folder1');
      expect(dirs[1].name).toBe('folder2');
    });
  });

  // ==========================================================================
  // File System Properties Tests
  // ==========================================================================

  describe('File System Properties', () => {
    beforeEach(async () => {
      await connector.initialize();
    });

    it('should return file system properties', async () => {
      const props = await connector.getFileSystemProperties();

      expect(props.name).toBe('testfs');
      expect(props.etag).toBe('"fs-etag"');
      expect(props.leaseStatus).toBe('unlocked');
    });
  });

  // ==========================================================================
  // Disconnect Tests
  // ==========================================================================

  describe('Disconnect', () => {
    it('should disconnect and reset state', async () => {
      const { trackEvent } = require('../../utils/telemetry');

      await connector.initialize();
      await connector.disconnect();

      expect(connector.isInitialized).toBe(false);
      expect(connector.connectionStatus).toBe(ConnectionStatus.DISCONNECTED);
      expect(trackEvent).toHaveBeenCalledWith(
        'ADLSConnectorDisconnected',
        expect.objectContaining({ connectorId: 'test-connector' })
      );
    });
  });

  // ==========================================================================
  // Get Status Tests
  // ==========================================================================

  describe('Get Status', () => {
    it('should return current connector status', async () => {
      await connector.initialize();
      const status = connector.getStatus();

      expect(status.connectorId).toBe('test-connector');
      expect(status.connectorType).toBe('adls');
      expect(status.connectionStatus).toBe(ConnectionStatus.CONNECTED);
      expect(status.isInitialized).toBe(true);
      expect(status.initializationTime).toBeInstanceOf(Date);
    });

    it('should include last error if any', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      __mocks__.mockFileSystemClient.exists.mockRejectedValueOnce(new Error('Test error'));

      try {
        await connector.initialize();
      } catch (e) {
        // Expected
      }

      const status = connector.getStatus();
      expect(status.lastError).toBeDefined();
      expect(status.lastError.message).toContain('Test error');
    });
  });

  // ==========================================================================
  // Path Exclusion Tests
  // ==========================================================================

  describe('Path Exclusion', () => {
    it('should exclude paths matching exclude patterns', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      // Set up the mock to return the test data
      __mocks__.mockFileSystemClient.listPaths.mockImplementation(() =>
        __mocks__.createMockPathIterator([
          { name: 'temp/file.pdf', contentLength: 100, isDirectory: false },
          { name: 'documents/file.pdf', contentLength: 100, isDirectory: false },
          { name: 'archive/old.pdf', contentLength: 100, isDirectory: false },
        ])
      );

      const excludeConnector = new ADLSGen2Connector('exclude-connector', {
        accountName: 'teststorage',
        fileSystemName: 'testfs',
        excludePaths: ['temp/*', 'archive/*'],
      });

      await excludeConnector.initialize();
      const result = await excludeConnector.listDocuments();

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].path).toBe('documents/file.pdf');
    });
  });

  // ==========================================================================
  // MIME Type Detection Tests
  // ==========================================================================

  describe('MIME Type Detection', () => {
    it('should detect common MIME types', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      __mocks__.mockFileSystemClient.listPaths.mockImplementation(() =>
        __mocks__.createMockPathIterator([
          { name: 'doc.pdf', contentLength: 100, isDirectory: false },
          { name: 'doc.docx', contentLength: 100, isDirectory: false },
          { name: 'data.json', contentLength: 100, isDirectory: false },
          { name: 'unknown.xyz', contentLength: 100, isDirectory: false },
        ])
      );

      await connector.initialize();
      const result = await connector.listDocuments();

      expect(result.documents[0].mimeType).toBe('application/pdf');
      expect(result.documents[1].mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      expect(result.documents[2].mimeType).toBe('application/json');
      expect(result.documents[3].mimeType).toBe('application/octet-stream');
    });
  });

  // ==========================================================================
  // Singleton and Factory Tests
  // ==========================================================================

  describe('Singleton and Factory', () => {
    it('should return same instance from getADLSGen2Connector', () => {
      const instance1 = getADLSGen2Connector();
      const instance2 = getADLSGen2Connector();

      expect(instance1).toBe(instance2);
    });

    it('should create new instances with createADLSGen2Connector', () => {
      const instance1 = createADLSGen2Connector('conn1', { accountName: 'a', fileSystemName: 'b' });
      const instance2 = createADLSGen2Connector('conn2', { accountName: 'a', fileSystemName: 'b' });

      expect(instance1).not.toBe(instance2);
      expect(instance1.connectorId).toBe('conn1');
      expect(instance2.connectorId).toBe('conn2');
    });

    it('should reset default connector', () => {
      const instance1 = getADLSGen2Connector();
      resetDefaultConnector();
      const instance2 = getADLSGen2Connector();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ==========================================================================
  // File Size Filtering Tests
  // ==========================================================================

  describe('File Size Filtering', () => {
    it('should skip files exceeding max size', async () => {
      const { __mocks__ } = require('@azure/storage-file-datalake');
      __mocks__.mockFileSystemClient.listPaths.mockImplementation(() =>
        __mocks__.createMockPathIterator([
          { name: 'small.pdf', contentLength: 1024, isDirectory: false },
          { name: 'large.pdf', contentLength: 100 * 1024 * 1024, isDirectory: false }, // 100MB
        ])
      );

      const sizeConnector = new ADLSGen2Connector('size-connector', {
        accountName: 'teststorage',
        fileSystemName: 'testfs',
        maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
      });

      await sizeConnector.initialize();
      const result = await sizeConnector.listDocuments();

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].name).toBe('small.pdf');
    });
  });
});

// ==========================================================================
// BaseConnector Tests
// ==========================================================================

describe('BaseConnector', () => {
  it('should not allow direct instantiation', () => {
    expect(() => new BaseConnector('test', 'test')).toThrow('cannot be instantiated directly');
  });

  it('should require subclasses to implement abstract methods', () => {
    class TestConnector extends BaseConnector {
      constructor() {
        super('test', 'test');
      }
    }

    const connector = new TestConnector();

    expect(() => connector.initialize()).rejects.toThrow('must be implemented by subclass');
    expect(() => connector.performHealthCheck()).rejects.toThrow('must be implemented by subclass');
    expect(() => connector.listDocuments()).rejects.toThrow('must be implemented by subclass');
    expect(() => connector.getDocument('id')).rejects.toThrow('must be implemented by subclass');
    expect(() => connector.getDocumentMetadata('id')).rejects.toThrow('must be implemented by subclass');
  });
});

// ==========================================================================
// AuthenticationType Constants Tests
// ==========================================================================

describe('AuthenticationType', () => {
  it('should define all authentication types', () => {
    expect(AuthenticationType.DEFAULT_CREDENTIAL).toBe('default_credential');
    expect(AuthenticationType.STORAGE_KEY).toBe('storage_key');
    expect(AuthenticationType.SAS_TOKEN).toBe('sas_token');
    expect(AuthenticationType.CONNECTION_STRING).toBe('connection_string');
  });
});
