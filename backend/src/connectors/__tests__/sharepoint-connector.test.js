/**
 * SharePoint Connector Unit Tests (F4.2.1)
 *
 * Tests the SharePoint connector implementation including:
 * - Configuration validation
 * - Authentication setup
 * - Site resolution
 * - Document library listing
 * - Delta sync for incremental updates
 * - Document download
 * - Permission retrieval
 * - Health service integration
 * - Error handling
 */

// Mock dependencies before requiring the module
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
  trackMetric: jest.fn(),
}));

// Mock Microsoft Graph client
const mockGraphClient = {
  api: jest.fn(() => mockGraphClient),
  select: jest.fn(() => mockGraphClient),
  top: jest.fn(() => mockGraphClient),
  get: jest.fn(),
  getStream: jest.fn(),
};

// Create virtual mocks for optional dependencies
jest.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: jest.fn(() => mockGraphClient),
  },
}), { virtual: true });

jest.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials', () => ({
  TokenCredentialAuthenticationProvider: jest.fn().mockImplementation(() => ({})),
}), { virtual: true });

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn().mockImplementation(() => ({})),
  ClientCertificateCredential: jest.fn().mockImplementation(() => ({})),
}), { virtual: true });

// Mock connector health service
const mockHealthService = {
  registerConnector: jest.fn(),
  trackSyncStart: jest.fn(),
  trackSyncComplete: jest.fn(),
  trackSyncError: jest.fn(),
  performHealthCheck: jest.fn(),
  setConnectorEnabled: jest.fn(),
};

jest.mock('../../services/connector-health-service', () => ({
  getConnectorHealthService: jest.fn(() => mockHealthService),
  ConnectorType: { SHAREPOINT: 'sharepoint' },
  SyncStatus: {
    SUCCESS: 'success',
    PARTIAL: 'partial',
    FAILURE: 'failure',
  },
}));

// Now require the module after mocks are set up
const {
  SharePointConnector,
  SharePointConnectionConfig,
  SharePointDocument,
  SharePointDeltaState,
  createSharePointConnector,
  SUPPORTED_FILE_TYPES,
} = require('../sharepoint-connector');

describe('SharePointConnectionConfig', () => {
  beforeEach(() => {
    // Reset environment variables
    delete process.env.SHAREPOINT_TENANT_ID;
    delete process.env.SHAREPOINT_CLIENT_ID;
    delete process.env.SHAREPOINT_CLIENT_SECRET;
    delete process.env.SHAREPOINT_SITE_URL;
    delete process.env.AZURE_AD_TENANT_ID;
  });

  describe('constructor', () => {
    test('should create config with all required options', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      });

      expect(config.tenantId).toBe('test-tenant');
      expect(config.clientId).toBe('test-client');
      expect(config.clientSecret).toBe('test-secret');
      expect(config.siteUrl).toBe('contoso.sharepoint.com');
    });

    test('should throw error if tenantId is missing', () => {
      expect(() => new SharePointConnectionConfig({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      })).toThrow(/tenantId is required/);
    });

    test('should throw error if clientId is missing', () => {
      expect(() => new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      })).toThrow(/clientId is required/);
    });

    test('should throw error if neither clientSecret nor certificatePath is provided', () => {
      expect(() => new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        siteUrl: 'contoso.sharepoint.com',
      })).toThrow(/clientSecret or certificatePath is required/);
    });

    test('should throw error if siteUrl is missing', () => {
      expect(() => new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      })).toThrow(/siteUrl is required/);
    });

    test('should accept certificate path instead of client secret', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        certificatePath: '/path/to/cert.pem',
        siteUrl: 'contoso.sharepoint.com',
      });

      expect(config.certificatePath).toBe('/path/to/cert.pem');
    });

    test('should use environment variables as fallback', () => {
      process.env.AZURE_AD_TENANT_ID = 'env-tenant';
      process.env.SHAREPOINT_CLIENT_ID = 'env-client';
      process.env.SHAREPOINT_CLIENT_SECRET = 'env-secret';
      process.env.SHAREPOINT_SITE_URL = 'env-site.sharepoint.com';

      const config = new SharePointConnectionConfig();

      expect(config.tenantId).toBe('env-tenant');
      expect(config.clientId).toBe('env-client');
      expect(config.clientSecret).toBe('env-secret');
      expect(config.siteUrl).toBe('env-site.sharepoint.com');
    });

    test('should use default values for optional settings', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      });

      expect(config.pageSize).toBe(200);
      expect(config.timeoutMs).toBe(30000);
      expect(config.libraryNames).toEqual([]);
      expect(config.fileTypes).toEqual(Object.keys(SUPPORTED_FILE_TYPES));
    });
  });

  describe('getSiteIdentifier', () => {
    test('should return site URL without path', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      });

      expect(config.getSiteIdentifier()).toBe('contoso.sharepoint.com');
    });

    test('should return site URL with path', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
        sitePath: '/sites/TeamSite',
      });

      expect(config.getSiteIdentifier()).toBe('contoso.sharepoint.com:/sites/TeamSite');
    });

    test('should strip https:// prefix', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'https://contoso.sharepoint.com',
      });

      expect(config.getSiteIdentifier()).toBe('contoso.sharepoint.com');
    });
  });

  describe('toJSON', () => {
    test('should exclude sensitive fields', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'super-secret',
        siteUrl: 'contoso.sharepoint.com',
      });

      const json = config.toJSON();

      expect(json.tenantId).toBe('test-tenant');
      expect(json.clientId).toBe('test-client');
      expect(json.clientSecret).toBeUndefined();
      expect(json.certificatePath).toBeUndefined();
    });
  });
});

describe('SharePointDocument', () => {
  const mockDriveItem = {
    id: 'item-123',
    name: 'document.pdf',
    webUrl: 'https://contoso.sharepoint.com/sites/TeamSite/Shared%20Documents/document.pdf',
    size: 1024,
    createdDateTime: '2024-01-01T00:00:00Z',
    lastModifiedDateTime: '2024-01-15T12:00:00Z',
    createdBy: { user: { displayName: 'John Doe' } },
    lastModifiedBy: { user: { displayName: 'Jane Smith' } },
    eTag: '"etag-123"',
    cTag: '"ctag-456"',
    file: { mimeType: 'application/pdf' },
    parentReference: { path: '/drives/driveId/root:/Documents' },
    listItem: {
      id: 'listitem-789',
      contentType: { name: 'Document' },
      fields: { CustomField: 'value' },
    },
  };

  test('should create document from drive item', () => {
    const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');

    expect(doc.id).toBe('item-123');
    expect(doc.driveId).toBe('drive-123');
    expect(doc.siteId).toBe('site-456');
    expect(doc.name).toBe('document.pdf');
    expect(doc.size).toBe(1024);
    expect(doc.mimeType).toBe('application/pdf');
    expect(doc.createdBy).toBe('John Doe');
    expect(doc.lastModifiedBy).toBe('Jane Smith');
  });

  test('should generate unique ID', () => {
    const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');

    expect(doc.getUniqueId()).toBe('sharepoint:site-456:drive-123:item-123');
  });

  test('should infer MIME type from extension when not provided', () => {
    const itemWithoutMimeType = { ...mockDriveItem, file: {} };
    const doc = new SharePointDocument(itemWithoutMimeType, 'drive-123', 'site-456');

    expect(doc.mimeType).toBe('application/pdf');
  });

  test('should handle unknown file extensions', () => {
    const unknownItem = { ...mockDriveItem, name: 'file.xyz', file: {} };
    const doc = new SharePointDocument(unknownItem, 'drive-123', 'site-456');

    expect(doc.mimeType).toBe('application/octet-stream');
  });

  test('should check if file type is supported', () => {
    const pdfDoc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
    expect(pdfDoc.isSupported()).toBe(true);

    const unknownItem = { ...mockDriveItem, name: 'file.xyz' };
    const unknownDoc = new SharePointDocument(unknownItem, 'drive-123', 'site-456');
    expect(unknownDoc.isSupported()).toBe(false);
  });

  test('should convert to document metadata format', () => {
    const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
    const metadata = doc.toDocumentMetadata();

    expect(metadata.sourceId).toBe('sharepoint:site-456:drive-123:item-123');
    expect(metadata.sourceType).toBe('sharepoint');
    expect(metadata.sourceName).toBe('document.pdf');
    expect(metadata.mimeType).toBe('application/pdf');
    expect(metadata.metadata.driveId).toBe('drive-123');
    expect(metadata.metadata.siteId).toBe('site-456');
  });
});

describe('SharePointDeltaState', () => {
  test('should create fresh state without delta link', () => {
    const state = new SharePointDeltaState('drive-123');

    expect(state.driveId).toBe('drive-123');
    expect(state.deltaLink).toBeNull();
    expect(state.isFreshSync()).toBe(true);
  });

  test('should create state with existing delta link', () => {
    const state = new SharePointDeltaState('drive-123', 'https://graph.microsoft.com/delta?token=abc');

    expect(state.deltaLink).toBe('https://graph.microsoft.com/delta?token=abc');
    expect(state.isFreshSync()).toBe(false);
  });

  test('should update state after sync', () => {
    const state = new SharePointDeltaState('drive-123');
    const beforeUpdate = state.lastSyncTime;

    state.update('https://graph.microsoft.com/delta?token=xyz', 100, 5);

    expect(state.deltaLink).toBe('https://graph.microsoft.com/delta?token=xyz');
    expect(state.lastSyncTime).not.toBe(beforeUpdate);
    expect(state.syncedItemCount).toBe(100);
    expect(state.deletedItemCount).toBe(5);
  });
});

describe('SharePointConnector', () => {
  let connector;
  const validConfig = {
    tenantId: 'test-tenant',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    siteUrl: 'contoso.sharepoint.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    connector = new SharePointConnector(validConfig);

    // Reset all mock chain methods
    mockGraphClient.api.mockReset();
    mockGraphClient.select.mockReset();
    mockGraphClient.top.mockReset();
    mockGraphClient.get.mockReset();
    mockGraphClient.getStream.mockReset();

    // Setup default mock chain - all methods return mockGraphClient to allow chaining
    mockGraphClient.api.mockReturnValue(mockGraphClient);
    mockGraphClient.select.mockReturnValue(mockGraphClient);
    mockGraphClient.top.mockReturnValue(mockGraphClient);
  });

  describe('constructor', () => {
    test('should create connector with valid config', () => {
      expect(connector.connectorId).toContain('sharepoint-');
      expect(connector.isInitialized).toBe(false);
    });

    test('should accept config object directly', () => {
      const configObj = new SharePointConnectionConfig(validConfig);
      const conn = new SharePointConnector(configObj);

      expect(conn.config).toBe(configObj);
    });
  });

  describe('initialize', () => {
    test('should initialize successfully', async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });

      await connector.initialize();

      expect(connector.isInitialized).toBe(true);
      expect(connector.siteId).toBe('site-123');
      expect(mockHealthService.registerConnector).toHaveBeenCalled();
    });

    test('should not reinitialize if already initialized', async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });

      await connector.initialize();
      const firstSiteId = connector.siteId;

      await connector.initialize();

      expect(connector.siteId).toBe(firstSiteId);
    });

    test('should throw error if site not found', async () => {
      mockGraphClient.get.mockRejectedValueOnce({ statusCode: 404 });

      await expect(connector.initialize()).rejects.toThrow(/not found/);
    });
  });

  describe('testConnection', () => {
    test('should return success for healthy connection', async () => {
      // Initialize call
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      // Test connection calls - site info and drives
      mockGraphClient.get.mockResolvedValueOnce({ id: 'site-123', displayName: 'Test Site' });
      mockGraphClient.get.mockResolvedValueOnce({ value: [{ id: 'drive-1', name: 'Documents' }] });

      mockHealthService.performHealthCheck.mockResolvedValue({ healthy: true });

      const result = await connector.testConnection();

      expect(result.success).toBe(true);
      expect(result.siteName).toBe('Test Site');
    });

    test('should return failure for connection error', async () => {
      // Initialize call
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      // Test connection call fails
      mockGraphClient.get.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await connector.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('listDocumentLibraries', () => {
    test('should list all document libraries', async () => {
      // Initialize
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connector.initialize();

      // List libraries call
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'drive-1', name: 'Documents', driveType: 'documentLibrary', webUrl: 'url1' },
          { id: 'drive-2', name: 'Reports', driveType: 'documentLibrary', webUrl: 'url2' },
        ],
      });

      const libraries = await connector.listDocumentLibraries();

      expect(libraries).toHaveLength(2);
      expect(libraries[0].name).toBe('Documents');
      expect(libraries[1].name).toBe('Reports');
    });

    test('should filter by configured library names', async () => {
      connector.config.libraryNames = ['Documents'];

      // Initialize
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connector.initialize();

      // List libraries call
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'drive-1', name: 'Documents', driveType: 'documentLibrary', webUrl: 'url1' },
          { id: 'drive-2', name: 'Reports', driveType: 'documentLibrary', webUrl: 'url2' },
        ],
      });

      const libraries = await connector.listDocumentLibraries();

      expect(libraries).toHaveLength(1);
      expect(libraries[0].name).toBe('Documents');
    });
  });

  describe('syncDocuments', () => {
    const initializeConnector = async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connector.initialize();
    };

    test('should sync documents with delta query', async () => {
      await initializeConnector();

      // List libraries
      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      // Delta query response
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'doc-1',
            name: 'report.pdf',
            file: { mimeType: 'application/pdf' },
            size: 1024,
            createdDateTime: '2024-01-01T00:00:00Z',
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            parentReference: { path: '/root:/Documents' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const onDocument = jest.fn();
      const result = await connector.syncDocuments({
        onDocument,
      });

      expect(result.documentsProcessed).toBe(1);
      expect(result.librariesProcessed).toBe(1);
      expect(onDocument).toHaveBeenCalled();
      expect(mockHealthService.trackSyncStart).toHaveBeenCalled();
      expect(mockHealthService.trackSyncComplete).toHaveBeenCalled();
    });

    test('should handle deleted items in delta response', async () => {
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'doc-1', name: 'deleted.pdf', deleted: { state: 'deleted' } },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const onDocument = jest.fn();
      const result = await connector.syncDocuments({ onDocument });

      expect(result.documentsDeleted).toBe(1);
      expect(onDocument).toHaveBeenCalledWith(expect.objectContaining({ type: 'deleted' }));
    });

    test('should skip folders in delta response', async () => {
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'folder-1', name: 'MyFolder', folder: { childCount: 5 } },
          {
            id: 'doc-1',
            name: 'file.pdf',
            file: { mimeType: 'application/pdf' },
            size: 100,
            parentReference: { path: '/root' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const result = await connector.syncDocuments();

      expect(result.documentsProcessed).toBe(1);
    });

    test('should handle pagination with nextLink', async () => {
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      // First page
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'doc-1', name: 'file1.pdf', file: {}, size: 100, parentReference: { path: '/root' } },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?$skiptoken=abc',
      });

      // Second page
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'doc-2', name: 'file2.pdf', file: {}, size: 200, parentReference: { path: '/root' } },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=xyz',
      });

      const result = await connector.syncDocuments();

      expect(result.documentsProcessed).toBe(2);
    });

    test('should filter by file types', async () => {
      connector.config.fileTypes = ['.pdf'];
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'doc-1', name: 'file.pdf', file: {}, size: 100, parentReference: { path: '/root' } },
          { id: 'doc-2', name: 'file.docx', file: {}, size: 200, parentReference: { path: '/root' } },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const result = await connector.syncDocuments();

      expect(result.documentsProcessed).toBe(1);
    });

    test('should filter by excluded folders', async () => {
      connector.config.excludedFolders = ['Archive'];
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'doc-1', name: 'file.pdf', file: {}, size: 100, parentReference: { path: '/root:/Documents' } },
          { id: 'doc-2', name: 'old.pdf', file: {}, size: 200, parentReference: { path: '/root:/Archive' } },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const result = await connector.syncDocuments();

      expect(result.documentsProcessed).toBe(1);
    });

    test('should filter by included folders', async () => {
      connector.config.includedFolders = ['Reports'];
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'doc-1', name: 'report.pdf', file: {}, size: 100, parentReference: { path: '/root:/Reports' } },
          { id: 'doc-2', name: 'misc.pdf', file: {}, size: 200, parentReference: { path: '/root:/Misc' } },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const result = await connector.syncDocuments();

      expect(result.documentsProcessed).toBe(1);
    });

    test('should report partial success with some errors', async () => {
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'doc-1', name: 'file.pdf', file: {}, size: 100, parentReference: { path: '/root' } },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const onDocument = jest.fn().mockImplementation(({ document }) => {
        if (document && document.name === 'file.pdf') {
          throw new Error('Processing failed');
        }
      });

      const result = await connector.syncDocuments({ onDocument });

      expect(result.documentsFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    test('should handle library sync errors', async () => {
      await initializeConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' },
          { id: 'drive-2', name: 'Reports', driveType: 'documentLibrary' },
        ],
      });

      // First library succeeds
      mockGraphClient.get.mockResolvedValueOnce({
        value: [],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      // Second library fails
      mockGraphClient.get.mockRejectedValueOnce(new Error('Access denied'));

      const result = await connector.syncDocuments();

      expect(result.librariesProcessed).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].libraryName).toBe('Reports');
    });
  });

  describe('downloadContent', () => {
    const initDownloadConnector = async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connector.initialize();
    };

    test('should download document content as buffer', async () => {
      await initDownloadConnector();

      const mockStream = (async function* () {
        yield Buffer.from('chunk1');
        yield Buffer.from('chunk2');
      })();

      mockGraphClient.getStream.mockResolvedValueOnce(mockStream);

      const content = await connector.downloadContent('drive-123', 'item-456');

      expect(content.toString()).toBe('chunk1chunk2');
    });

    test('should track download errors', async () => {
      await initDownloadConnector();

      mockGraphClient.getStream.mockRejectedValueOnce(new Error('Download failed'));

      await expect(connector.downloadContent('drive-123', 'item-456'))
        .rejects.toThrow('Download failed');

      expect(mockHealthService.trackSyncError).toHaveBeenCalledWith(
        connector.connectorId,
        expect.objectContaining({ type: 'download_failed' })
      );
    });
  });

  describe('getPermissions', () => {
    const initPermConnector = async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connector.initialize();
    };

    test('should retrieve document permissions', async () => {
      await initPermConnector();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'perm-1',
            roles: ['read'],
            grantedTo: { user: { displayName: 'John Doe', email: 'john@contoso.com' } },
          },
          {
            id: 'perm-2',
            roles: ['write'],
            grantedToV2: { user: { displayName: 'Jane Smith', email: 'jane@contoso.com' } },
          },
        ],
      });

      const permissions = await connector.getPermissions('drive-123', 'item-456');

      expect(permissions).toHaveLength(2);
      expect(permissions[0].grantedTo).toBe('John Doe');
      expect(permissions[1].grantedTo).toBe('Jane Smith');
    });

    test('should return empty array on error', async () => {
      await initPermConnector();

      mockGraphClient.get.mockRejectedValueOnce(new Error('Access denied'));

      const permissions = await connector.getPermissions('drive-123', 'item-456');

      expect(permissions).toEqual([]);
    });
  });

  describe('delta state management', () => {
    test('should get delta state for drive', () => {
      const state = new SharePointDeltaState('drive-123', 'https://delta?token=abc');
      connector.deltaStates.set('drive-123', state);

      const retrieved = connector.getDeltaState('drive-123');

      expect(retrieved).toBe(state);
    });

    test('should return null for unknown drive', () => {
      expect(connector.getDeltaState('unknown-drive')).toBeNull();
    });

    test('should set delta state for recovery', () => {
      connector.setDeltaState('drive-123', {
        deltaLink: 'https://delta?token=abc',
        lastSyncTime: '2024-01-01T00:00:00Z',
        syncedItemCount: 100,
      });

      const state = connector.getDeltaState('drive-123');

      expect(state.deltaLink).toBe('https://delta?token=abc');
      expect(state.syncedItemCount).toBe(100);
    });

    test('should get all delta states', () => {
      connector.deltaStates.set('drive-1', new SharePointDeltaState('drive-1', 'token1'));
      connector.deltaStates.set('drive-2', new SharePointDeltaState('drive-2', 'token2'));

      const allStates = connector.getAllDeltaStates();

      expect(Object.keys(allStates)).toHaveLength(2);
      expect(allStates['drive-1'].deltaLink).toBe('token1');
      expect(allStates['drive-2'].deltaLink).toBe('token2');
    });
  });

  describe('getStatus', () => {
    test('should return connector status', () => {
      const status = connector.getStatus();

      expect(status.connectorId).toBe(connector.connectorId);
      expect(status.connectorType).toBe('sharepoint');
      expect(status.isInitialized).toBe(false);
    });
  });

  describe('disconnect', () => {
    test('should disconnect and cleanup', async () => {
      // Initialize first
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connector.initialize();

      await connector.disconnect();

      expect(connector.isInitialized).toBe(false);
      expect(connector.graphClient).toBeNull();
      expect(mockHealthService.setConnectorEnabled).toHaveBeenCalledWith(
        connector.connectorId,
        false
      );
    });
  });
});

describe('createSharePointConnector', () => {
  test('should create connector with config', () => {
    const connector = createSharePointConnector({
      tenantId: 'test-tenant',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      siteUrl: 'contoso.sharepoint.com',
    });

    expect(connector).toBeInstanceOf(SharePointConnector);
  });
});

describe('SUPPORTED_FILE_TYPES', () => {
  test('should include common document types', () => {
    expect('.pdf' in SUPPORTED_FILE_TYPES).toBe(true);
    expect('.docx' in SUPPORTED_FILE_TYPES).toBe(true);
    expect('.xlsx' in SUPPORTED_FILE_TYPES).toBe(true);
    expect('.pptx' in SUPPORTED_FILE_TYPES).toBe(true);
  });

  test('should include text types', () => {
    expect('.txt' in SUPPORTED_FILE_TYPES).toBe(true);
    expect('.csv' in SUPPORTED_FILE_TYPES).toBe(true);
    expect('.json' in SUPPORTED_FILE_TYPES).toBe(true);
  });
});

/**
 * F4.2.2: SharePoint Permission Sync Tests
 */
describe('SharePoint Permission Sync (F4.2.2)', () => {
  describe('SharePointConnectionConfig - permission settings', () => {
    beforeEach(() => {
      delete process.env.SHAREPOINT_SYNC_PERMISSIONS;
      delete process.env.SHAREPOINT_INCLUDE_INHERITED_PERMISSIONS;
      delete process.env.SHAREPOINT_PERMISSION_ROLES_TO_SYNC;
    });

    test('should have syncPermissions disabled by default', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      });

      expect(config.syncPermissions).toBe(false);
    });

    test('should enable syncPermissions via options', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
        syncPermissions: true,
      });

      expect(config.syncPermissions).toBe(true);
    });

    test('should enable syncPermissions via environment variable', () => {
      process.env.SHAREPOINT_SYNC_PERMISSIONS = 'true';

      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      });

      expect(config.syncPermissions).toBe(true);
    });

    test('should include inherited permissions by default', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
      });

      expect(config.includeInheritedPermissions).toBe(true);
    });

    test('should allow disabling inherited permissions', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
        includeInheritedPermissions: false,
      });

      expect(config.includeInheritedPermissions).toBe(false);
    });

    test('should configure permissionRolesToSync', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
        permissionRolesToSync: ['read', 'write'],
      });

      expect(config.permissionRolesToSync).toEqual(['read', 'write']);
    });

    test('should include permission settings in toJSON', () => {
      const config = new SharePointConnectionConfig({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        siteUrl: 'contoso.sharepoint.com',
        syncPermissions: true,
        includeInheritedPermissions: false,
        permissionRolesToSync: ['read'],
      });

      const json = config.toJSON();

      expect(json.syncPermissions).toBe(true);
      expect(json.includeInheritedPermissions).toBe(false);
      expect(json.permissionRolesToSync).toEqual(['read']);
    });
  });

  describe('SharePointDocument.setPermissions', () => {
    const mockDriveItem = {
      id: 'item-123',
      name: 'document.pdf',
      webUrl: 'https://contoso.sharepoint.com/doc.pdf',
      size: 1024,
      createdDateTime: '2024-01-01T00:00:00Z',
      lastModifiedDateTime: '2024-01-15T12:00:00Z',
      createdBy: { user: { displayName: 'John Doe' } },
      lastModifiedBy: { user: { displayName: 'Jane Smith' } },
      file: { mimeType: 'application/pdf' },
      parentReference: { path: '/drives/driveId/root:/Documents' },
    };

    test('should map Azure AD group permissions to allowedGroups', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Engineering Team', id: 'grp-1' } },
          ],
        },
        {
          id: 'perm-2',
          roles: ['write'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Managers', id: 'grp-2' } },
          ],
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups).toContain('Engineering Team');
      expect(doc.allowedGroups).toContain('Managers');
      expect(doc.allowedGroups).toHaveLength(2);
    });

    test('should map SharePoint group permissions to allowedGroups', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToIdentitiesV2: [
            { siteGroup: { displayName: 'Site Members', id: 'spgrp-1' } },
          ],
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups).toContain('Site Members');
    });

    test('should map user permissions with user: prefix', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedTo: { user: { email: 'john@contoso.com' } },
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups).toContain('user:john@contoso.com');
    });

    test('should handle grantedToV2 format', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToV2: {
            group: { displayName: 'Finance Team', id: 'grp-finance' },
          },
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups).toContain('Finance Team');
    });

    test('should handle organization-wide sharing links', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          link: { type: 'view', scope: 'organization' },
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups).toContain('organization');
    });

    test('should handle anonymous sharing links', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          link: { type: 'view', scope: 'anonymous' },
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups).toContain('anonymous');
    });

    test('should exclude inherited permissions when includeInherited is false', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Direct Access Group' } },
          ],
        },
        {
          id: 'perm-2',
          roles: ['read'],
          inheritedFrom: { path: '/drives/driveId/root' },
          grantedToIdentitiesV2: [
            { group: { displayName: 'Inherited Group' } },
          ],
        },
      ];

      doc.setPermissions(permissions, { includeInherited: false });

      expect(doc.allowedGroups).toContain('Direct Access Group');
      expect(doc.allowedGroups).not.toContain('Inherited Group');
    });

    test('should filter by roles when rolesToInclude is specified', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Readers' } },
          ],
        },
        {
          id: 'perm-2',
          roles: ['write'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Writers' } },
          ],
        },
      ];

      doc.setPermissions(permissions, { rolesToInclude: ['read'] });

      expect(doc.allowedGroups).toContain('Readers');
      expect(doc.allowedGroups).not.toContain('Writers');
    });

    test('should deduplicate groups', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Engineering Team' } },
          ],
        },
        {
          id: 'perm-2',
          roles: ['write'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Engineering Team' } },
          ],
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups.filter(g => g === 'Engineering Team')).toHaveLength(1);
    });

    test('should filter out empty group names', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToIdentitiesV2: [
            { group: { displayName: '' } },
            { group: { displayName: '   ' } },
            { group: { displayName: 'Valid Group' } },
          ],
        },
      ];

      doc.setPermissions(permissions);

      expect(doc.allowedGroups).toEqual(['Valid Group']);
    });

    test('should include allowedGroups in toDocumentMetadata', () => {
      const doc = new SharePointDocument(mockDriveItem, 'drive-123', 'site-456');
      const permissions = [
        {
          id: 'perm-1',
          roles: ['read'],
          grantedToIdentitiesV2: [
            { group: { displayName: 'Test Group' } },
          ],
        },
      ];

      doc.setPermissions(permissions);
      const metadata = doc.toDocumentMetadata();

      expect(metadata.allowedGroups).toEqual(['Test Group']);
    });
  });

  describe('SharePointConnector.syncDocuments with permissions', () => {
    let connector;
    const configWithPermissions = {
      tenantId: 'test-tenant',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      siteUrl: 'contoso.sharepoint.com',
      syncPermissions: true,
    };

    beforeEach(() => {
      jest.clearAllMocks();
      connector = new SharePointConnector(configWithPermissions);

      mockGraphClient.api.mockReset();
      mockGraphClient.select.mockReset();
      mockGraphClient.top.mockReset();
      mockGraphClient.get.mockReset();

      mockGraphClient.api.mockReturnValue(mockGraphClient);
      mockGraphClient.select.mockReturnValue(mockGraphClient);
      mockGraphClient.top.mockReturnValue(mockGraphClient);
    });

    const initializeConnector = async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connector.initialize();
    };

    test('should sync permissions for documents when enabled', async () => {
      await initializeConnector();

      // List libraries
      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      // Delta query response
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'doc-1',
            name: 'report.pdf',
            file: { mimeType: 'application/pdf' },
            size: 1024,
            createdDateTime: '2024-01-01T00:00:00Z',
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            parentReference: { path: '/root:/Documents' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      // Permissions response for doc-1
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'perm-1',
            roles: ['read'],
            grantedToIdentitiesV2: [
              { group: { displayName: 'Finance Team' } },
            ],
          },
        ],
      });

      const onDocument = jest.fn();
      const result = await connector.syncDocuments({ onDocument });

      expect(result.permissionsSynced).toBe(1);
      expect(result.permissionsFailed).toBe(0);
      expect(onDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            allowedGroups: ['Finance Team'],
          }),
        })
      );
    });

    test('should track permission sync failures without failing document sync', async () => {
      await initializeConnector();

      // List libraries
      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      // Delta query response
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'doc-1',
            name: 'report.pdf',
            file: { mimeType: 'application/pdf' },
            size: 1024,
            createdDateTime: '2024-01-01T00:00:00Z',
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            parentReference: { path: '/root:/Documents' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      // Permissions request fails
      mockGraphClient.get.mockRejectedValueOnce(new Error('Access denied'));

      const onDocument = jest.fn();
      const result = await connector.syncDocuments({ onDocument });

      // Document should still be processed
      expect(result.documentsProcessed).toBe(1);
      expect(result.permissionsSynced).toBe(0);
      expect(result.permissionsFailed).toBe(1);

      // Document should have empty allowedGroups
      expect(onDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            allowedGroups: [],
          }),
        })
      );
    });

    test('should not fetch permissions when syncPermissions is disabled', async () => {
      const connectorNoPerms = new SharePointConnector({
        ...configWithPermissions,
        syncPermissions: false,
      });

      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connectorNoPerms.initialize();

      // List libraries
      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      // Delta query response
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'doc-1',
            name: 'report.pdf',
            file: { mimeType: 'application/pdf' },
            size: 1024,
            createdDateTime: '2024-01-01T00:00:00Z',
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            parentReference: { path: '/root:/Documents' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      const result = await connectorNoPerms.syncDocuments();

      // Should have exactly 3 calls: site resolution, library list, delta query
      // NO permission call
      expect(mockGraphClient.get).toHaveBeenCalledTimes(3);
      expect(result.permissionsSynced).toBe(0);
    });

    test('should respect includeInheritedPermissions setting', async () => {
      const connectorNoInherited = new SharePointConnector({
        ...configWithPermissions,
        includeInheritedPermissions: false,
      });

      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connectorNoInherited.initialize();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'doc-1',
            name: 'report.pdf',
            file: { mimeType: 'application/pdf' },
            size: 1024,
            createdDateTime: '2024-01-01T00:00:00Z',
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            parentReference: { path: '/root:/Documents' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      // Return mixed inherited and direct permissions
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'perm-1',
            roles: ['read'],
            grantedToIdentitiesV2: [{ group: { displayName: 'Direct Group' } }],
          },
          {
            id: 'perm-2',
            roles: ['read'],
            inheritedFrom: { path: '/drives/drive-1/root' },
            grantedToIdentitiesV2: [{ group: { displayName: 'Inherited Group' } }],
          },
        ],
      });

      const onDocument = jest.fn();
      await connectorNoInherited.syncDocuments({ onDocument });

      expect(onDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            allowedGroups: ['Direct Group'],
          }),
        })
      );
    });

    test('should respect permissionRolesToSync setting', async () => {
      const connectorReadOnly = new SharePointConnector({
        ...configWithPermissions,
        permissionRolesToSync: ['read'],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        id: 'site-123',
        displayName: 'Test Site',
        webUrl: 'https://contoso.sharepoint.com',
      });
      await connectorReadOnly.initialize();

      mockGraphClient.get.mockResolvedValueOnce({
        value: [{ id: 'drive-1', name: 'Documents', driveType: 'documentLibrary' }],
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'doc-1',
            name: 'report.pdf',
            file: { mimeType: 'application/pdf' },
            size: 1024,
            createdDateTime: '2024-01-01T00:00:00Z',
            lastModifiedDateTime: '2024-01-15T00:00:00Z',
            parentReference: { path: '/root:/Documents' },
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
      });

      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'perm-1',
            roles: ['read'],
            grantedToIdentitiesV2: [{ group: { displayName: 'Readers' } }],
          },
          {
            id: 'perm-2',
            roles: ['write'],
            grantedToIdentitiesV2: [{ group: { displayName: 'Writers' } }],
          },
        ],
      });

      const onDocument = jest.fn();
      await connectorReadOnly.syncDocuments({ onDocument });

      expect(onDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            allowedGroups: ['Readers'],
          }),
        })
      );
    });
  });
});
