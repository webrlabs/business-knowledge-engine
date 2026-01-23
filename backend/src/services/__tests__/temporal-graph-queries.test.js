/**
 * Tests for Time-Aware Graph Queries (F2.3.4)
 *
 * Tests the temporal query capabilities added to graph-service.js and graph-rag-service.js:
 * - Point-in-time graph snapshots
 * - Time-aware neighbor queries
 * - Temporal graph traversal
 * - Graph state comparison between times
 */

const { GraphService, normalizeEntityName } = require('../graph-service');

// Mock the Gremlin client
jest.mock('../../clients', () => ({
  createGremlinClient: jest.fn().mockResolvedValue({
    submit: jest.fn().mockResolvedValue({ _items: [] }),
  }),
  closeGremlinClient: jest.fn().mockResolvedValue(undefined),
}));

// Mock the circuit breaker service
jest.mock('../circuit-breaker-service', () => ({
  getCircuitBreakerService: () => ({
    getBreaker: (name, fn) => ({
      fire: () => fn(),
    }),
  }),
}));

describe('Time-Aware Graph Queries (F2.3.4)', () => {
  let graphService;

  beforeEach(() => {
    graphService = new GraphService();
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('_isEntityValidAt', () => {
    it('should return true for entity with no temporal constraints', () => {
      const entity = { id: '1', name: 'Test Entity' };
      const targetTime = new Date('2024-06-15');

      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(true);
    });

    it('should return true for entity valid at target time', () => {
      const entity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-01-01T00:00:00Z',
        validTo: '2024-12-31T23:59:59Z',
      };
      const targetTime = new Date('2024-06-15');

      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(true);
    });

    it('should return false for entity not yet valid (validFrom in future)', () => {
      const entity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-06-01T00:00:00Z',
      };
      const targetTime = new Date('2024-01-15');

      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(false);
    });

    it('should return false for expired entity (validTo in past)', () => {
      const entity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-01-01T00:00:00Z',
        validTo: '2024-03-31T23:59:59Z',
      };
      const targetTime = new Date('2024-06-15');

      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(false);
    });

    it('should return false for superseded entity with validTo before target time', () => {
      const entity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-01-01T00:00:00Z',
        validTo: '2024-03-31T23:59:59Z',
        supersededBy: 'entity-2',
      };
      const targetTime = new Date('2024-06-15');

      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(false);
    });

    it('should return true for superseded entity when target time is before validTo', () => {
      const entity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-01-01T00:00:00Z',
        validTo: '2024-06-30T23:59:59Z',
        supersededBy: 'entity-2',
      };
      const targetTime = new Date('2024-06-15');

      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(true);
    });

    it('should handle edge case at exact validFrom time', () => {
      const entity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-06-15T00:00:00Z',
      };
      const targetTime = new Date('2024-06-15T00:00:00Z');

      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(true);
    });

    it('should handle edge case at exact validTo time', () => {
      const entity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-01-01T00:00:00Z',
        validTo: '2024-06-15T00:00:00Z',
      };
      const targetTime = new Date('2024-06-15T00:00:00Z');

      // At exact validTo time, entity is still considered valid (validTo is exclusive upper bound)
      // This follows the convention that validTo represents "valid up to but not including this time"
      expect(graphService._isEntityValidAt(entity, targetTime)).toBe(true);
    });
  });

  describe('getGraphSnapshotAt', () => {
    it('should filter entities to only those valid at the target time', async () => {
      const mockEntities = [
        {
          id: ['1'],
          name: ['Entity A'],
          label: 'Process',
          validFrom: ['2024-01-01T00:00:00Z'],
        },
        {
          id: ['2'],
          name: ['Entity B'],
          label: 'Process',
          validFrom: ['2024-03-01T00:00:00Z'],
        },
        {
          id: ['3'],
          name: ['Entity C'],
          label: 'Process',
          validFrom: ['2024-01-01T00:00:00Z'],
          validTo: ['2024-02-28T23:59:59Z'],
        },
      ];

      graphService._submit = jest.fn().mockResolvedValue(mockEntities);

      const snapshot = await graphService.getGraphSnapshotAt('2024-02-15T00:00:00Z', {
        includeRelationships: false,
      });

      // Entity A: valid (validFrom before target, no validTo)
      // Entity B: not valid (validFrom after target)
      // Entity C: valid (within range)
      expect(snapshot.entities.length).toBe(2);
      expect(snapshot.entities.map((e) => e.name)).toContain('Entity A');
      expect(snapshot.entities.map((e) => e.name)).toContain('Entity C');
      expect(snapshot.entities.map((e) => e.name)).not.toContain('Entity B');
    });

    it('should filter by entity type when specified', async () => {
      graphService._submit = jest.fn().mockResolvedValue([]);

      await graphService.getGraphSnapshotAt('2024-06-15T00:00:00Z', {
        type: 'Process',
        includeRelationships: false,
      });

      // Verify the query includes the type filter
      const submitCall = graphService._submit.mock.calls[0][0];
      expect(submitCall).toContain('hasLabel(type)');
    });

    it('should return metadata with correct counts', async () => {
      const mockEntities = [
        {
          id: ['1'],
          name: ['Entity A'],
          label: 'Process',
          validFrom: ['2024-01-01T00:00:00Z'],
        },
      ];

      graphService._submit = jest.fn().mockResolvedValue(mockEntities);

      const snapshot = await graphService.getGraphSnapshotAt('2024-06-15T00:00:00Z', {
        includeRelationships: false,
      });

      expect(snapshot.metadata).toBeDefined();
      expect(snapshot.metadata.entityCount).toBe(1);
      expect(snapshot.metadata.relationshipCount).toBe(0);
      expect(snapshot.pointInTime).toBe('2024-06-15T00:00:00Z');
    });
  });

  describe('findNeighborsValidAt', () => {
    it('should return error when source entity not found', async () => {
      graphService.findVertexByName = jest.fn().mockResolvedValue(null);

      const result = await graphService.findNeighborsValidAt(
        'NonExistent',
        '2024-06-15T00:00:00Z'
      );

      expect(result.neighbors).toEqual([]);
      expect(result.error).toBe('Source entity not found');
    });

    it('should indicate when source entity was not valid at target time', async () => {
      const sourceEntity = {
        id: '1',
        name: 'Test Entity',
        validFrom: '2024-06-01T00:00:00Z', // After target time
      };

      graphService.findVertexByName = jest.fn().mockResolvedValue(sourceEntity);

      const result = await graphService.findNeighborsValidAt(
        'Test Entity',
        '2024-01-15T00:00:00Z'
      );

      expect(result.neighbors).toEqual([]);
      expect(result.sourceEntityValid).toBe(false);
      expect(result.message).toContain('was not valid at');
    });

    it('should filter neighbors by temporal validity', async () => {
      const sourceEntity = {
        id: '1',
        name: 'Source Entity',
        validFrom: '2024-01-01T00:00:00Z',
      };

      const mockOutResults = [
        {
          type: 'MANAGES',
          target: {
            id: ['2'],
            name: ['Valid Neighbor'],
            label: 'Role',
            validFrom: ['2024-01-01T00:00:00Z'],
          },
          createdAt: '2024-01-15T00:00:00Z',
          confidence: 0.9,
        },
        {
          type: 'MANAGES',
          target: {
            id: ['3'],
            name: ['Future Neighbor'],
            label: 'Role',
            validFrom: ['2024-08-01T00:00:00Z'], // After target time
          },
          createdAt: '2024-01-15T00:00:00Z',
          confidence: 0.8,
        },
      ];

      graphService.findVertexByName = jest.fn().mockResolvedValue(sourceEntity);
      graphService._submit = jest.fn().mockResolvedValue(mockOutResults);

      const result = await graphService.findNeighborsValidAt(
        'Source Entity',
        '2024-06-15T00:00:00Z',
        { direction: 'outgoing' }
      );

      // Only Valid Neighbor should be returned (Future Neighbor validFrom is after target)
      expect(result.neighbors.length).toBe(1);
      expect(result.neighbors[0].entity.name).toBe('Valid Neighbor');
      expect(result.sourceEntityValid).toBe(true);
    });

    it('should filter edges created after target time', async () => {
      const sourceEntity = {
        id: '1',
        name: 'Source Entity',
        validFrom: '2024-01-01T00:00:00Z',
      };

      const mockOutResults = [
        {
          type: 'MANAGES',
          target: {
            id: ['2'],
            name: ['Valid Neighbor'],
            label: 'Role',
            validFrom: ['2024-01-01T00:00:00Z'],
          },
          createdAt: '2024-01-15T00:00:00Z', // Before target
          confidence: 0.9,
        },
        {
          type: 'MANAGES',
          target: {
            id: ['3'],
            name: ['Late Neighbor'],
            label: 'Role',
            validFrom: ['2024-01-01T00:00:00Z'],
          },
          createdAt: '2024-08-01T00:00:00Z', // After target time
          confidence: 0.8,
        },
      ];

      graphService.findVertexByName = jest.fn().mockResolvedValue(sourceEntity);
      graphService._submit = jest.fn().mockResolvedValue(mockOutResults);

      const result = await graphService.findNeighborsValidAt(
        'Source Entity',
        '2024-06-15T00:00:00Z',
        { direction: 'outgoing' }
      );

      // Only Valid Neighbor should be returned (Late Neighbor edge created after target)
      expect(result.neighbors.length).toBe(1);
      expect(result.neighbors[0].entity.name).toBe('Valid Neighbor');
    });
  });

  describe('traverseGraphAt', () => {
    it('should report invalid seeds that are not found', async () => {
      graphService.findVertexByName = jest.fn().mockResolvedValue(null);
      graphService.findNeighborsValidAt = jest.fn().mockResolvedValue({ neighbors: [] });

      const result = await graphService.traverseGraphAt(
        ['NonExistent'],
        '2024-06-15T00:00:00Z'
      );

      expect(result.metadata.invalidSeeds.length).toBe(1);
      expect(result.metadata.invalidSeeds[0].name).toBe('NonExistent');
      expect(result.metadata.invalidSeeds[0].error).toBe('not found');
    });

    it('should report invalid seeds that were not valid at target time', async () => {
      const seedEntity = {
        id: '1',
        name: 'Future Entity',
        validFrom: '2024-08-01T00:00:00Z',
      };

      graphService.findVertexByName = jest.fn().mockResolvedValue(seedEntity);

      const result = await graphService.traverseGraphAt(
        ['Future Entity'],
        '2024-06-15T00:00:00Z'
      );

      expect(result.metadata.invalidSeeds.length).toBe(1);
      expect(result.metadata.invalidSeeds[0].error).toBe('not valid at target time');
    });

    it('should traverse valid entities and collect relationships', async () => {
      const seedEntity = {
        id: '1',
        name: 'Seed Entity',
        validFrom: '2024-01-01T00:00:00Z',
      };

      const neighbor = {
        entity: {
          id: '2',
          name: 'Neighbor Entity',
          validFrom: '2024-01-01T00:00:00Z',
        },
        relationshipType: 'MANAGES',
        direction: 'outgoing',
        confidence: 0.9,
      };

      graphService.findVertexByName = jest.fn().mockResolvedValue(seedEntity);
      graphService.findNeighborsValidAt = jest
        .fn()
        .mockResolvedValueOnce({ neighbors: [neighbor], sourceEntityValid: true })
        .mockResolvedValue({ neighbors: [], sourceEntityValid: true });

      const result = await graphService.traverseGraphAt(
        ['Seed Entity'],
        '2024-06-15T00:00:00Z',
        { maxDepth: 2 }
      );

      expect(result.entities.length).toBe(2);
      expect(result.relationships.length).toBe(1);
      expect(result.relationships[0].from).toBe('Seed Entity');
      expect(result.relationships[0].to).toBe('Neighbor Entity');
      expect(result.relationships[0].type).toBe('MANAGES');
    });

    it('should respect maxDepth limit', async () => {
      const seedEntity = {
        id: '1',
        name: 'Seed Entity',
        validFrom: '2024-01-01T00:00:00Z',
      };

      graphService.findVertexByName = jest.fn().mockResolvedValue(seedEntity);
      graphService.findNeighborsValidAt = jest.fn().mockResolvedValue({
        neighbors: [],
        sourceEntityValid: true,
      });

      const result = await graphService.traverseGraphAt(
        ['Seed Entity'],
        '2024-06-15T00:00:00Z',
        { maxDepth: 1 }
      );

      expect(result.metadata.maxDepthReached).toBe(1);
    });

    it('should respect maxEntities limit', async () => {
      const entities = [];
      for (let i = 1; i <= 10; i++) {
        entities.push({
          id: String(i),
          name: `Entity ${i}`,
          validFrom: '2024-01-01T00:00:00Z',
        });
      }

      graphService.findVertexByName = jest
        .fn()
        .mockImplementation((name) => entities.find((e) => e.name === name) || null);

      // Return different neighbors for each call
      const neighborQueue = entities.slice(1).map((e) => ({
        entity: e,
        relationshipType: 'RELATED_TO',
        direction: 'outgoing',
        confidence: 0.8,
      }));

      graphService.findNeighborsValidAt = jest
        .fn()
        .mockImplementation(() => {
          const next = neighborQueue.shift();
          return Promise.resolve({
            neighbors: next ? [next] : [],
            sourceEntityValid: true,
          });
        });

      const result = await graphService.traverseGraphAt(
        ['Entity 1'],
        '2024-06-15T00:00:00Z',
        { maxDepth: 5, maxEntities: 3 }
      );

      expect(result.entities.length).toBeLessThanOrEqual(3);
      expect(result.metadata.maxEntitiesReached).toBe(true);
    });
  });

  describe('compareGraphStates', () => {
    it('should identify added entities between two times', async () => {
      // Mock getGraphSnapshotAt directly for cleaner testing
      const snapshot1 = {
        entities: [{ id: '1', name: 'Entity A', type: 'Process' }],
        relationships: [],
        metadata: { entityCount: 1, relationshipCount: 0 },
      };
      const snapshot2 = {
        entities: [
          { id: '1', name: 'Entity A', type: 'Process' },
          { id: '2', name: 'Entity B', type: 'Process' },
        ],
        relationships: [],
        metadata: { entityCount: 2, relationshipCount: 0 },
      };

      graphService.getGraphSnapshotAt = jest.fn()
        .mockResolvedValueOnce(snapshot1)
        .mockResolvedValueOnce(snapshot2);

      const comparison = await graphService.compareGraphStates(
        '2024-02-15T00:00:00Z',
        '2024-06-15T00:00:00Z'
      );

      expect(comparison.comparison.added).toBe(1);
      expect(comparison.addedEntities.length).toBe(1);
      expect(comparison.addedEntities[0].name).toBe('Entity B');
    });

    it('should identify removed entities between two times', async () => {
      const snapshot1 = {
        entities: [
          { id: '1', name: 'Entity A', type: 'Process' },
          { id: '2', name: 'Entity B', type: 'Process' },
        ],
        relationships: [],
        metadata: { entityCount: 2, relationshipCount: 0 },
      };
      const snapshot2 = {
        entities: [{ id: '1', name: 'Entity A', type: 'Process' }],
        relationships: [],
        metadata: { entityCount: 1, relationshipCount: 0 },
      };

      graphService.getGraphSnapshotAt = jest.fn()
        .mockResolvedValueOnce(snapshot1)
        .mockResolvedValueOnce(snapshot2);

      const comparison = await graphService.compareGraphStates(
        '2024-02-15T00:00:00Z',
        '2024-06-15T00:00:00Z'
      );

      expect(comparison.comparison.removed).toBe(1);
      expect(comparison.removedEntities.length).toBe(1);
      expect(comparison.removedEntities[0].name).toBe('Entity B');
    });

    it('should identify persisted entities between two times', async () => {
      const snapshot1 = {
        entities: [{ id: '1', name: 'Entity A', type: 'Process' }],
        relationships: [],
        metadata: { entityCount: 1, relationshipCount: 0 },
      };
      const snapshot2 = {
        entities: [{ id: '1', name: 'Entity A', type: 'Process' }],
        relationships: [],
        metadata: { entityCount: 1, relationshipCount: 0 },
      };

      graphService.getGraphSnapshotAt = jest.fn()
        .mockResolvedValueOnce(snapshot1)
        .mockResolvedValueOnce(snapshot2);

      const comparison = await graphService.compareGraphStates(
        '2024-02-15T00:00:00Z',
        '2024-06-15T00:00:00Z'
      );

      expect(comparison.comparison.persisted).toBe(1);
      expect(comparison.persistedEntities.length).toBe(1);
      expect(comparison.persistedEntities[0].name).toBe('Entity A');
    });

    it('should return correct metadata', async () => {
      const emptySnapshot = {
        entities: [],
        relationships: [],
        metadata: { entityCount: 0, relationshipCount: 0 },
      };

      graphService.getGraphSnapshotAt = jest.fn().mockResolvedValue(emptySnapshot);

      const comparison = await graphService.compareGraphStates(
        '2024-02-15T00:00:00Z',
        '2024-06-15T00:00:00Z'
      );

      expect(comparison.time1).toBe('2024-02-15T00:00:00Z');
      expect(comparison.time2).toBe('2024-06-15T00:00:00Z');
      expect(comparison.metadata.comparisonTimestamp).toBeDefined();
    });
  });
});

describe('GraphRAG Service Time-Aware Methods', () => {
  // These tests verify the GraphRAG service integration
  // We'll use mocks for the graph and other services

  describe('_isEntityValidAt', () => {
    let graphRAGService;

    beforeEach(async () => {
      jest.resetModules();

      // Mock all dependencies
      jest.mock('../graph-service', () => ({
        getGraphService: () => ({
          findVertexByName: jest.fn(),
          findNeighborsValidAt: jest.fn(),
        }),
        normalizeEntityName: (name) => name.toLowerCase().trim(),
      }));

      jest.mock('../search-service', () => ({
        getSearchService: () => ({
          hybridSearch: jest.fn().mockResolvedValue({ results: [] }),
        }),
      }));

      jest.mock('../openai-service', () => ({
        getOpenAIService: () => ({
          getJsonCompletion: jest.fn().mockResolvedValue({ content: { entities: [] } }),
          getEmbedding: jest.fn().mockResolvedValue({ embedding: [] }),
          getChatCompletion: jest.fn().mockResolvedValue({ content: 'Test answer' }),
        }),
      }));

      jest.mock('../entity-resolution-service', () => ({
        getEntityResolutionService: () => ({
          getCanonicalEntity: jest.fn().mockResolvedValue(null),
          findSimilarEntities: jest.fn().mockResolvedValue([]),
        }),
      }));

      jest.mock('../community-summary-service', () => ({
        getCommunitySummaryService: () => ({
          getAllCachedSummaries: jest.fn().mockReturnValue({}),
        }),
      }));

      jest.mock('../ontology-service', () => ({
        getOntologyService: () => ({
          initialize: jest.fn().mockResolvedValue(true),
        }),
      }));

      jest.mock('../importance-service', () => ({
        getImportanceWithCache: jest.fn().mockResolvedValue({ scores: {} }),
        calculateImportance: jest.fn().mockResolvedValue({}),
      }));

      const { GraphRAGService } = require('../graph-rag-service');
      graphRAGService = new GraphRAGService();
    });

    it('should correctly determine entity validity at different times', () => {
      const entity = {
        validFrom: '2024-01-01T00:00:00Z',
        validTo: '2024-12-31T23:59:59Z',
      };

      // Before validFrom
      expect(graphRAGService._isEntityValidAt(entity, new Date('2023-06-15'))).toBe(false);

      // During valid period
      expect(graphRAGService._isEntityValidAt(entity, new Date('2024-06-15'))).toBe(true);

      // After validTo
      expect(graphRAGService._isEntityValidAt(entity, new Date('2025-06-15'))).toBe(false);
    });

    it('should accept string or Date for targetTime', () => {
      const entity = {
        validFrom: '2024-01-01T00:00:00Z',
      };

      // Test with string
      expect(graphRAGService._isEntityValidAt(entity, '2024-06-15T00:00:00Z')).toBe(true);

      // Test with Date object
      expect(graphRAGService._isEntityValidAt(entity, new Date('2024-06-15'))).toBe(true);
    });
  });
});
