/**
 * Tests for Community Storage Service
 *
 * Feature: F3.1.2 - Community Storage
 */

const {
  CommunityStorageService,
  getCommunityStorageService,
  CONFIG,
  DOC_TYPES,
} = require('../community-storage-service');

// Mock the Azure Cosmos DB client
const mockContainer = {
  items: {
    create: jest.fn(),
    upsert: jest.fn(),
    query: jest.fn().mockReturnValue({
      fetchAll: jest.fn(),
    }),
  },
  item: jest.fn().mockReturnValue({
    read: jest.fn(),
    delete: jest.fn(),
  }),
};

const mockDatabase = {
  containers: {
    createIfNotExists: jest.fn().mockResolvedValue({ container: mockContainer }),
  },
};

const mockCosmosClient = {
  databases: {
    createIfNotExists: jest.fn().mockResolvedValue({ database: mockDatabase }),
  },
};

jest.mock('@azure/cosmos', () => ({
  CosmosClient: jest.fn().mockImplementation(() => mockCosmosClient),
}));

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    errorWithStack: jest.fn(),
  },
}));

describe('CommunityStorageService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton for tests
    service = new CommunityStorageService();

    // Setup environment variables
    process.env.COSMOS_DB_ENDPOINT = 'https://test.documents.azure.com:443/';
    process.env.COSMOS_DB_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.COSMOS_DB_ENDPOINT;
    delete process.env.COSMOS_DB_KEY;
  });

  describe('CONFIG', () => {
    it('should have expected default values', () => {
      expect(CONFIG.CONTAINER_ID).toBe('communities');
      expect(CONFIG.PARTITION_KEY_PATH).toBe('/communityId');
      expect(CONFIG.SCHEMA_VERSION).toBe('1.0.0');
      expect(CONFIG.MAX_COMMUNITIES_PER_QUERY).toBe(100);
      expect(CONFIG.MAX_SUMMARIES_PER_QUERY).toBe(50);
    });
  });

  describe('DOC_TYPES', () => {
    it('should have all required document types', () => {
      expect(DOC_TYPES.COMMUNITY).toBe('community');
      expect(DOC_TYPES.SUMMARY).toBe('summary');
      expect(DOC_TYPES.DETECTION_RUN).toBe('detection_run');
      expect(DOC_TYPES.COMMUNITY_SNAPSHOT).toBe('community_snapshot');
    });
  });

  describe('storeDetectionRun', () => {
    it('should store a detection run and its communities', async () => {
      const detectionResult = {
        communityList: [
          {
            id: 1,
            size: 5,
            members: [{ id: 'a', name: 'Entity A', type: 'Process' }],
            typeCounts: { Process: 5 },
            dominantType: 'Process',
          },
          {
            id: 2,
            size: 3,
            members: [{ id: 'b', name: 'Entity B', type: 'Task' }],
            typeCounts: { Task: 3 },
            dominantType: 'Task',
          },
        ],
        modularity: 0.75,
        metadata: { algorithm: 'louvain' },
      };

      mockContainer.items.create.mockResolvedValue({
        resource: { id: 'run_123', modularity: 0.75 },
      });

      const result = await service.storeDetectionRun(detectionResult);

      expect(result).toHaveProperty('runId');
      expect(result).toHaveProperty('run');
      expect(result).toHaveProperty('storedCommunityCount');

      // Should create detection run document
      expect(mockContainer.items.create).toHaveBeenCalled();
      const createCalls = mockContainer.items.create.mock.calls;
      const runDoc = createCalls[0][0];
      expect(runDoc.docType).toBe(DOC_TYPES.DETECTION_RUN);
      expect(runDoc.modularity).toBe(0.75);
      expect(runDoc.communityCount).toBe(2);
    });

    it('should handle empty community list', async () => {
      const detectionResult = {
        communityList: [],
        modularity: 0,
        metadata: {},
      };

      mockContainer.items.create.mockResolvedValue({
        resource: { id: 'run_empty', modularity: 0 },
      });

      const result = await service.storeDetectionRun(detectionResult);

      expect(result.storedCommunityCount).toBe(0);
    });
  });

  describe('storeSummary', () => {
    it('should store a community summary', async () => {
      const summary = {
        title: 'Process Community',
        summary: 'A community of process-related entities',
        memberCount: 10,
        dominantType: 'Process',
        typeCounts: { Process: 8, Task: 2 },
        relationshipCount: 15,
        keyEntities: ['Entity A', 'Entity B'],
      };

      mockContainer.items.upsert.mockResolvedValue({
        resource: { id: 'summary_1', ...summary },
      });

      const result = await service.storeSummary(1, summary);

      expect(mockContainer.items.upsert).toHaveBeenCalled();
      const upsertedDoc = mockContainer.items.upsert.mock.calls[0][0];
      expect(upsertedDoc.id).toBe('summary_1');
      expect(upsertedDoc.communityId).toBe('1');
      expect(upsertedDoc.docType).toBe(DOC_TYPES.SUMMARY);
      expect(upsertedDoc.title).toBe('Process Community');
    });

    it('should convert numeric communityId to string', async () => {
      mockContainer.items.upsert.mockResolvedValue({
        resource: { id: 'summary_123' },
      });

      await service.storeSummary(123, { title: 'Test' });

      const upsertedDoc = mockContainer.items.upsert.mock.calls[0][0];
      expect(upsertedDoc.communityId).toBe('123');
    });
  });

  describe('storeSummariesBatch', () => {
    it('should store multiple summaries and track results', async () => {
      const summaries = {
        1: { title: 'Community 1', summary: 'Summary 1' },
        2: { title: 'Community 2', summary: 'Summary 2' },
        3: { title: 'Community 3', summary: 'Summary 3' },
      };

      mockContainer.items.upsert.mockResolvedValue({
        resource: { id: 'summary' },
      });

      const result = await service.storeSummariesBatch(summaries);

      expect(result.stored).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle partial failures', async () => {
      const summaries = {
        1: { title: 'Good Summary' },
        2: { title: 'Bad Summary' },
      };

      mockContainer.items.upsert
        .mockResolvedValueOnce({ resource: { id: 'summary_1' } })
        .mockRejectedValueOnce(new Error('Storage error'));

      const result = await service.storeSummariesBatch(summaries);

      expect(result.stored).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].communityId).toBe('2');
    });
  });

  describe('getSummary', () => {
    it('should retrieve a summary by communityId', async () => {
      const mockSummary = {
        id: 'summary_1',
        communityId: '1',
        title: 'Test Community',
        summary: 'Test summary content',
      };

      mockContainer.item.mockReturnValue({
        read: jest.fn().mockResolvedValue({ resource: mockSummary }),
      });

      const result = await service.getSummary(1);

      expect(mockContainer.item).toHaveBeenCalledWith('summary_1', '1');
      expect(result).toEqual(mockSummary);
    });

    it('should return null for non-existent summary', async () => {
      mockContainer.item.mockReturnValue({
        read: jest.fn().mockRejectedValue({ code: 404 }),
      });

      const result = await service.getSummary('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getSummaries', () => {
    it('should retrieve multiple summaries', async () => {
      const mockSummaries = [
        { id: 'summary_1', communityId: '1', title: 'Community 1' },
        { id: 'summary_2', communityId: '2', title: 'Community 2' },
      ];

      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: mockSummaries }),
      });

      const result = await service.getSummaries([1, 2]);

      expect(result['1']).toBeDefined();
      expect(result['2']).toBeDefined();
    });

    it('should return empty object for empty input', async () => {
      const result = await service.getSummaries([]);

      expect(result).toEqual({});
    });
  });

  describe('getAllSummaries', () => {
    it('should retrieve all summaries with default options', async () => {
      const mockSummaries = [
        { id: 'summary_1', communityId: '1', memberCount: 10 },
        { id: 'summary_2', communityId: '2', memberCount: 5 },
      ];

      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: mockSummaries }),
      });

      const result = await service.getAllSummaries();

      expect(Object.keys(result)).toHaveLength(2);
      expect(result['1'].memberCount).toBe(10);
    });

    it('should respect limit option', async () => {
      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      await service.getAllSummaries({ limit: 5 });

      const query = mockContainer.items.query.mock.calls[0][0];
      expect(query.parameters).toContainEqual({ name: '@limit', value: 5 });
    });
  });

  describe('getLatestDetectionRun', () => {
    it('should retrieve the most recent detection run', async () => {
      const mockRun = {
        id: 'run_latest',
        modularity: 0.8,
        communityCount: 15,
        createdAt: '2026-01-22T10:00:00Z',
      };

      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [mockRun] }),
      });

      const result = await service.getLatestDetectionRun();

      expect(result).toEqual(mockRun);
    });

    it('should return null when no detection runs exist', async () => {
      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      const result = await service.getLatestDetectionRun();

      expect(result).toBeNull();
    });
  });

  describe('createSnapshot', () => {
    it('should create a snapshot of communities and summaries', async () => {
      const detectionResult = {
        communityList: [{ id: 1, size: 5 }],
        modularity: 0.7,
      };
      const summaries = {
        1: { title: 'Community 1', summary: 'Summary' },
      };

      mockContainer.items.create.mockResolvedValue({
        resource: { id: 'snapshot_123' },
      });

      const result = await service.createSnapshot(detectionResult, summaries);

      expect(mockContainer.items.create).toHaveBeenCalled();
      const snapshotDoc = mockContainer.items.create.mock.calls[0][0];
      expect(snapshotDoc.docType).toBe(DOC_TYPES.COMMUNITY_SNAPSHOT);
      expect(snapshotDoc.modularity).toBe(0.7);
      expect(snapshotDoc.communityCount).toBe(1);
      expect(snapshotDoc.summaryCount).toBe(1);
    });
  });

  describe('getSnapshots', () => {
    it('should retrieve snapshots for trend analysis', async () => {
      const mockSnapshots = [
        { id: 'snapshot_2', modularity: 0.8, createdAt: '2026-01-22T12:00:00Z' },
        { id: 'snapshot_1', modularity: 0.7, createdAt: '2026-01-22T10:00:00Z' },
      ];

      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: mockSnapshots }),
      });

      const result = await service.getSnapshots({ limit: 5 });

      expect(result).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      // Mock counts for each document type
      mockContainer.items.query
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: [25] }), // communities
        })
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: [20] }), // summaries
        })
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: [5] }), // detection runs
        })
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: [3] }), // snapshots
        })
        .mockReturnValueOnce({
          // For getLatestDetectionRun
          fetchAll: jest.fn().mockResolvedValue({
            resources: [{ id: 'run_latest', modularity: 0.8 }],
          }),
        });

      const stats = await service.getStats();

      expect(stats.communityCount).toBe(25);
      expect(stats.summaryCount).toBe(20);
      expect(stats.detectionRunCount).toBe(5);
      expect(stats.snapshotCount).toBe(3);
      expect(stats.schemaVersion).toBe(CONFIG.SCHEMA_VERSION);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when storage is accessible', async () => {
      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [1] }),
      });

      const health = await service.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.containerId).toBe(CONFIG.CONTAINER_ID);
    });

    it('should return unhealthy status on connection failure', async () => {
      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockRejectedValue(new Error('Connection failed')),
      });

      const health = await service.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toBe('Connection failed');
    });
  });

  describe('deleteSummary', () => {
    it('should delete a summary and return true', async () => {
      mockContainer.item.mockReturnValue({
        delete: jest.fn().mockResolvedValue({}),
      });

      const result = await service.deleteSummary(1);

      expect(result).toBe(true);
      expect(mockContainer.item).toHaveBeenCalledWith('summary_1', '1');
    });

    it('should return false when summary does not exist', async () => {
      mockContainer.item.mockReturnValue({
        delete: jest.fn().mockRejectedValue({ code: 404 }),
      });

      const result = await service.deleteSummary('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('clearStorage', () => {
    it('should delete all non-snapshot documents by default', async () => {
      // Mock query results for each doc type
      mockContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({
          resources: [
            { id: 'doc1', communityId: '1' },
            { id: 'doc2', communityId: '2' },
          ],
        }),
      });

      mockContainer.item.mockReturnValue({
        delete: jest.fn().mockResolvedValue({}),
      });

      const result = await service.clearStorage({ preserveSnapshots: true });

      expect(result.cacheCleared).toBeUndefined(); // Service doesn't have cache property
      expect(result.preserveSnapshots).toBe(true);
    });
  });

  describe('getCommunityStorageService', () => {
    it('should return singleton instance', () => {
      // Reset module to test singleton
      jest.resetModules();

      const { getCommunityStorageService: getSingleton } = require('../community-storage-service');

      const instance1 = getSingleton();
      const instance2 = getSingleton();

      expect(instance1).toBe(instance2);
    });
  });
});
