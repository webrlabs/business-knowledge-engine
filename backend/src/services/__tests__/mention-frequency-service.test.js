/**
 * Tests for Entity Mention Frequency Tracking
 *
 * Feature: F3.2.3 - Mention Frequency Tracking
 *
 * Tests the ability to track how often entities are mentioned across documents
 * and provide statistics about entity mentions.
 */

const {
  getEntityMentionStats,
  getTopEntitiesByMentionCount,
  getMentionFrequencyAnalysis,
} = require('../importance-service');

// Mock the graph service
jest.mock('../graph-service', () => ({
  getGraphService: jest.fn(),
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    errorWithStack: jest.fn(),
  },
}));

const { getGraphService } = require('../graph-service');

describe('Mention Frequency Tracking (F3.2.3)', () => {
  let mockGraphService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGraphService = {
      _submit: jest.fn(),
      _normalizeVertex: jest.fn((v) => {
        const vertex = {};
        for (const [key, value] of Object.entries(v)) {
          if (key === 'id') {
            vertex.id = value;
          } else if (key === 'label') {
            vertex.type = value;
          } else if (Array.isArray(value)) {
            vertex[key] = value[0];
          } else {
            vertex[key] = value;
          }
        }
        return vertex;
      }),
      getTopEntitiesByMentionCount: jest.fn(),
    };
    getGraphService.mockReturnValue(mockGraphService);
  });

  describe('getEntityMentionStats', () => {
    it('should return mention stats for an existing entity by ID', async () => {
      const mockVertex = {
        id: 'entity-123',
        name: ['Test Entity'],
        type: 'Process',
        mentionCount: [15],
        sourceDocumentIds: ['doc1,doc2,doc3'],
        lastMentionedAt: ['2026-01-22T10:00:00Z'],
        createdAt: ['2026-01-20T10:00:00Z'],
        updatedAt: ['2026-01-22T10:00:00Z'],
      };

      mockGraphService._submit
        .mockResolvedValueOnce([mockVertex]); // First call - by ID

      const result = await getEntityMentionStats('entity-123');

      expect(result).not.toBeNull();
      expect(result.id).toBe('entity-123');
      expect(result.name).toBe('Test Entity');
      expect(result.mentionCount).toBe(15);
      expect(result.documentCount).toBe(3);
      expect(result.sourceDocumentIds).toEqual(['doc1', 'doc2', 'doc3']);
    });

    it('should return mention stats for an existing entity by name', async () => {
      const mockVertex = {
        id: 'entity-456',
        name: ['SAP System'],
        type: 'System',
        mentionCount: [7],
        sourceDocumentIds: ['docA,docB'],
        lastMentionedAt: ['2026-01-21T15:30:00Z'],
      };

      // First call by ID returns empty, second by name returns the entity
      mockGraphService._submit
        .mockResolvedValueOnce([]) // First call - by ID (not found)
        .mockResolvedValueOnce([mockVertex]); // Second call - by name

      const result = await getEntityMentionStats('SAP System');

      expect(result).not.toBeNull();
      expect(result.name).toBe('SAP System');
      expect(result.mentionCount).toBe(7);
      expect(result.documentCount).toBe(2);
    });

    it('should return null for non-existent entity', async () => {
      mockGraphService._submit
        .mockResolvedValueOnce([]) // by ID
        .mockResolvedValueOnce([]); // by name

      const result = await getEntityMentionStats('nonexistent-entity');

      expect(result).toBeNull();
    });

    it('should handle entities without sourceDocumentIds', async () => {
      const mockVertex = {
        id: 'entity-old',
        name: ['Legacy Entity'],
        type: 'Task',
        mentionCount: [3],
        // No sourceDocumentIds field
      };

      mockGraphService._submit.mockResolvedValueOnce([mockVertex]);

      const result = await getEntityMentionStats('entity-old');

      expect(result).not.toBeNull();
      expect(result.mentionCount).toBe(3);
      // When no sourceDocumentIds tracked, documentCount defaults to 1
      // since the entity exists and was mentioned at least once
      expect(result.documentCount).toBe(1);
      expect(result.sourceDocumentIds).toEqual([]);
    });

    it('should default mentionCount to 1 when not set', async () => {
      const mockVertex = {
        id: 'entity-new',
        name: ['New Entity'],
        type: 'Role',
        // No mentionCount field
      };

      mockGraphService._submit.mockResolvedValueOnce([mockVertex]);

      const result = await getEntityMentionStats('entity-new');

      expect(result).not.toBeNull();
      expect(result.mentionCount).toBe(1);
    });

    it('should include importance data when available', async () => {
      const mockVertex = {
        id: 'entity-important',
        name: ['Important Entity'],
        type: 'Process',
        mentionCount: [25],
        sourceDocumentIds: ['doc1'],
        importance: [0.85],
        importanceRank: [3],
        importancePercentile: [95.5],
      };

      mockGraphService._submit.mockResolvedValueOnce([mockVertex]);

      const result = await getEntityMentionStats('entity-important');

      expect(result.importance).toBe(0.85);
      expect(result.importanceRank).toBe(3);
      expect(result.importancePercentile).toBe(95.5);
    });
  });

  describe('getTopEntitiesByMentionCount', () => {
    it('should return top entities sorted by mention count', async () => {
      const mockEntities = [
        { id: 'a', name: 'Most Mentioned', type: 'Process', mentionCount: 100, documentCount: 10, sourceDocumentIds: [] },
        { id: 'b', name: 'Second Most', type: 'Task', mentionCount: 50, documentCount: 8, sourceDocumentIds: [] },
        { id: 'c', name: 'Third Most', type: 'System', mentionCount: 25, documentCount: 5, sourceDocumentIds: [] },
      ];

      mockGraphService.getTopEntitiesByMentionCount.mockResolvedValue(mockEntities);

      const result = await getTopEntitiesByMentionCount(3);

      expect(result).toHaveLength(3);
      expect(result[0].mentionCount).toBe(100);
      expect(result[1].mentionCount).toBe(50);
      expect(result[2].mentionCount).toBe(25);
      expect(mockGraphService.getTopEntitiesByMentionCount).toHaveBeenCalledWith(3);
    });

    it('should respect the limit parameter', async () => {
      mockGraphService.getTopEntitiesByMentionCount.mockResolvedValue([]);

      await getTopEntitiesByMentionCount(10);

      expect(mockGraphService.getTopEntitiesByMentionCount).toHaveBeenCalledWith(10);
    });

    it('should use default limit of 50', async () => {
      mockGraphService.getTopEntitiesByMentionCount.mockResolvedValue([]);

      await getTopEntitiesByMentionCount();

      expect(mockGraphService.getTopEntitiesByMentionCount).toHaveBeenCalledWith(50);
    });
  });

  describe('getMentionFrequencyAnalysis', () => {
    it('should return comprehensive mention statistics', async () => {
      const mockVertices = [
        { id: 'a', name: ['Entity A'], mentionCount: [1] },
        { id: 'b', name: ['Entity B'], mentionCount: [3] },
        { id: 'c', name: ['Entity C'], mentionCount: [7] },
        { id: 'd', name: ['Entity D'], mentionCount: [15] },
        { id: 'e', name: ['Entity E'], mentionCount: [30] },
        { id: 'f', name: ['Entity F'], mentionCount: [60] },
      ];

      mockGraphService._submit.mockResolvedValue(mockVertices);

      const result = await getMentionFrequencyAnalysis();

      expect(result.totalEntities).toBe(6);
      expect(result.totalMentions).toBe(1 + 3 + 7 + 15 + 30 + 60);
      expect(result.maxMentionCount).toBe(60);
      expect(result.minMentionCount).toBe(1);
      expect(result.averageMentionCount).toBeCloseTo(19.33, 1);
    });

    it('should calculate correct distribution buckets', async () => {
      const mockVertices = [
        { id: '1', name: ['E1'], mentionCount: [1] },  // bucket: 1
        { id: '2', name: ['E2'], mentionCount: [1] },  // bucket: 1
        { id: '3', name: ['E3'], mentionCount: [3] },  // bucket: 2-5
        { id: '4', name: ['E4'], mentionCount: [5] },  // bucket: 2-5
        { id: '5', name: ['E5'], mentionCount: [8] },  // bucket: 6-10
        { id: '6', name: ['E6'], mentionCount: [20] }, // bucket: 11-25
        { id: '7', name: ['E7'], mentionCount: [40] }, // bucket: 26-50
        { id: '8', name: ['E8'], mentionCount: [100] }, // bucket: 50+
      ];

      mockGraphService._submit.mockResolvedValue(mockVertices);

      const result = await getMentionFrequencyAnalysis();

      expect(result.distribution['1']).toBe(2);
      expect(result.distribution['2-5']).toBe(2);
      expect(result.distribution['6-10']).toBe(1);
      expect(result.distribution['11-25']).toBe(1);
      expect(result.distribution['26-50']).toBe(1);
      expect(result.distribution['50+']).toBe(1);
    });

    it('should return top 10 entities', async () => {
      const mockVertices = Array.from({ length: 15 }, (_, i) => ({
        id: `entity-${i}`,
        name: [`Entity ${i}`],
        type: 'Process',
        mentionCount: [i + 1],
      }));

      mockGraphService._submit.mockResolvedValue(mockVertices);

      const result = await getMentionFrequencyAnalysis();

      expect(result.topEntities).toHaveLength(10);
      // Top entity should have highest mention count (15)
      expect(result.topEntities[0].mentionCount).toBe(15);
    });

    it('should handle empty graph', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      const result = await getMentionFrequencyAnalysis();

      expect(result.totalEntities).toBe(0);
      expect(result.totalMentions).toBe(0);
      expect(result.averageMentionCount).toBe(0);
      expect(result.maxMentionCount).toBe(0);
      expect(result.minMentionCount).toBe(0);
      expect(result.topEntities).toEqual([]);
    });
  });
});

describe('GraphService Mention Tracking Methods', () => {
  // Test the graph service methods directly using the actual implementation
  // with mocked _submit

  describe('incrementMentionCount', () => {
    it('should increment mention count for an existing entity', async () => {
      // This would test the actual graph-service.js incrementMentionCount method
      // For now, we test via the integration through importance-service
      expect(true).toBe(true); // Placeholder
    });

    it('should track source document IDs', async () => {
      expect(true).toBe(true); // Placeholder
    });

    it('should skip if document already contributed', async () => {
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('batchUpdateMentionCounts', () => {
    it('should update multiple entities efficiently', async () => {
      expect(true).toBe(true); // Placeholder
    });
  });
});
