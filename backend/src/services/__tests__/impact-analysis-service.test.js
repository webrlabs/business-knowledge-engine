/**
 * Tests for Impact Analysis Service
 *
 * Features: F3.3.1, F3.3.2, F3.3.3, F3.3.4
 * - F3.3.1: Upstream Dependency Traversal
 * - F3.3.2: Downstream Impact Traversal
 * - F3.3.3: Impact Scoring
 * - F3.3.4: Impact Analysis API
 */

const {
  getUpstreamDependencies,
  getDownstreamImpact,
  analyzeImpact,
  simulateRemoval,
  calculateImpactScore,
  getImpactAnalysisWithCache,
  clearCache,
  DEPENDENCY_EDGE_TYPES,
  DEFAULT_CONFIG,
} = require('../impact-analysis-service');

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

describe('Impact Analysis Service', () => {
  let mockGraphService;

  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();

    mockGraphService = {
      _submit: jest.fn(),
    };
    getGraphService.mockReturnValue(mockGraphService);
  });

  describe('calculateImpactScore', () => {
    it('should return higher score for closer entities', () => {
      const closeScore = calculateImpactScore(1, 0.5);
      const farScore = calculateImpactScore(3, 0.5);

      expect(closeScore).toBeGreaterThan(farScore);
    });

    it('should factor in entity importance', () => {
      const highImportance = calculateImpactScore(2, 0.9);
      const lowImportance = calculateImpactScore(2, 0.1);

      expect(highImportance).toBeGreaterThan(lowImportance);
    });

    it('should return score between 0 and 1', () => {
      const scores = [
        calculateImpactScore(0, 0),
        calculateImpactScore(0, 1),
        calculateImpactScore(10, 0),
        calculateImpactScore(10, 1),
        calculateImpactScore(5, 0.5),
      ];

      for (const score of scores) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('should use default importance when not provided', () => {
      const score = calculateImpactScore(2);
      expect(score).toBeDefined();
      expect(typeof score).toBe('number');
    });

    it('should respect custom decay factor', () => {
      const highDecay = calculateImpactScore(2, 0.5, 0.9);
      const lowDecay = calculateImpactScore(2, 0.5, 0.5);

      expect(highDecay).toBeGreaterThan(lowDecay);
    });
  });

  describe('getUpstreamDependencies (F3.3.1)', () => {
    it('should return empty results for entity with no dependencies', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      const result = await getUpstreamDependencies('Standalone Entity');

      expect(result.sourceEntity).toBe('Standalone Entity');
      expect(result.direction).toBe('upstream');
      expect(result.dependencies).toHaveLength(0);
      expect(result.metadata.totalDependencies).toBe(0);
    });

    it('should find upstream dependencies', async () => {
      const mockPaths = [
        {
          objects: [
            [{ id: 'a', name: 'Entity A', type: 'Process' }],
            [{ id: 'b', name: 'Dependency B', type: 'System', importance: 0.8 }],
          ],
        },
        {
          objects: [
            [{ id: 'a', name: 'Entity A', type: 'Process' }],
            [{ id: 'c', name: 'Dependency C', type: 'Task', importance: 0.5 }],
          ],
        },
      ];
      mockGraphService._submit.mockResolvedValue(mockPaths);

      const result = await getUpstreamDependencies('Entity A');

      expect(result.dependencies.length).toBeGreaterThan(0);
      expect(result.direction).toBe('upstream');
      expect(result.description).toContain('depends on');
    });

    it('should calculate impact scores for dependencies', async () => {
      const mockPaths = [
        {
          objects: [
            [{ id: 'a', name: 'Entity A', type: 'Process' }],
            [{ id: 'b', name: 'Direct Dep', type: 'System', importance: 0.7 }],
            [{ id: 'c', name: 'Indirect Dep', type: 'Task', importance: 0.6 }],
          ],
        },
      ];
      mockGraphService._submit.mockResolvedValue(mockPaths);

      const result = await getUpstreamDependencies('Entity A');

      // Each dependency should have an impact score
      for (const dep of result.dependencies) {
        expect(dep.impactScore).toBeDefined();
        expect(dep.impactScore).toBeGreaterThanOrEqual(0);
        expect(dep.impactScore).toBeLessThanOrEqual(1);
      }
    });

    it('should respect maxDepth option', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      await getUpstreamDependencies('Entity A', { maxDepth: 3 });

      const query = mockGraphService._submit.mock.calls[0][0];
      expect(query).toContain('.times(3)');
    });

    it('should handle query errors gracefully', async () => {
      mockGraphService._submit.mockRejectedValue(new Error('Query failed'));

      const result = await getUpstreamDependencies('Entity A');

      expect(result.dependencies).toHaveLength(0);
      expect(result.metadata.error).toBeDefined();
    });
  });

  describe('getDownstreamImpact (F3.3.2)', () => {
    it('should return empty results for entity with no dependents', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      const result = await getDownstreamImpact('Leaf Entity');

      expect(result.sourceEntity).toBe('Leaf Entity');
      expect(result.direction).toBe('downstream');
      expect(result.impactedEntities).toHaveLength(0);
    });

    it('should find downstream impacted entities', async () => {
      const mockPaths = [
        {
          objects: [
            [{ id: 'a', name: 'Core System', type: 'System' }],
            [{ id: 'b', name: 'Dependent Process', type: 'Process', importance: 0.6 }],
          ],
        },
      ];
      mockGraphService._submit.mockResolvedValue(mockPaths);

      const result = await getDownstreamImpact('Core System');

      expect(result.impactedEntities.length).toBeGreaterThan(0);
      expect(result.direction).toBe('downstream');
      expect(result.description).toContain('depends on');
    });

    it('should sort impacted entities by impact score', async () => {
      const mockPaths = [
        {
          objects: [
            [{ id: 'a', name: 'Core', type: 'System' }],
            [{ id: 'b', name: 'High Impact', type: 'Process', importance: 0.9 }],
          ],
        },
        {
          objects: [
            [{ id: 'a', name: 'Core', type: 'System' }],
            [{ id: 'c', name: 'Low Impact', type: 'Task', importance: 0.1 }],
          ],
        },
      ];
      mockGraphService._submit.mockResolvedValue(mockPaths);

      const result = await getDownstreamImpact('Core');

      if (result.impactedEntities.length > 1) {
        expect(result.impactedEntities[0].impactScore)
          .toBeGreaterThanOrEqual(result.impactedEntities[1].impactScore);
      }
    });
  });

  describe('analyzeImpact (F3.3.3)', () => {
    it('should combine upstream and downstream analysis', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      const result = await analyzeImpact('Central Entity');

      expect(result.upstream).toBeDefined();
      expect(result.downstream).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should calculate risk level', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      const result = await analyzeImpact('Test Entity');

      expect(result.summary.riskLevel).toBeDefined();
      expect(['low', 'medium', 'high', 'critical']).toContain(result.summary.riskLevel);
    });

    it('should identify critical entities', async () => {
      const mockPaths = [
        {
          objects: [
            [{ id: 'a', name: 'Core', type: 'System' }],
            [{ id: 'b', name: 'Critical Dep', type: 'Process', importance: 0.95 }],
          ],
        },
      ];
      mockGraphService._submit.mockResolvedValue(mockPaths);

      const result = await analyzeImpact('Core');

      expect(result.summary.criticalCount).toBeDefined();
      expect(result.summary.criticalEntities).toBeDefined();
    });

    it('should provide type distribution', async () => {
      const mockPaths = [
        {
          objects: [
            [{ id: 'a', name: 'Core', type: 'System' }],
            [{ id: 'b', name: 'Process A', type: 'Process', importance: 0.5 }],
          ],
        },
        {
          objects: [
            [{ id: 'a', name: 'Core', type: 'System' }],
            [{ id: 'c', name: 'Task B', type: 'Task', importance: 0.5 }],
          ],
        },
      ];
      mockGraphService._submit.mockResolvedValue(mockPaths);

      const result = await analyzeImpact('Core');

      expect(result.summary.typeDistribution).toBeDefined();
      expect(typeof result.summary.typeDistribution).toBe('object');
    });
  });

  describe('simulateRemoval (F3.3.6)', () => {
    it('should simulate entity removal impact', async () => {
      mockGraphService._submit
        .mockResolvedValueOnce([]) // downstream query
        .mockResolvedValueOnce([]); // edge query

      const result = await simulateRemoval('Target Entity');

      expect(result.simulatedEntity).toBe('Target Entity');
      expect(result.action).toBe('removal');
      expect(result.impact).toBeDefined();
      expect(result.riskLevel).toBeDefined();
    });

    it('should categorize affected entities by severity', async () => {
      const mockPaths = [
        {
          objects: [
            [{ id: 'a', name: 'Target', type: 'System' }],
            [{ id: 'b', name: 'Direct', type: 'Process', importance: 0.5 }],
          ],
        },
        {
          objects: [
            [{ id: 'a', name: 'Target', type: 'System' }],
            [{ id: 'b', name: 'Direct', type: 'Process', importance: 0.5 }],
            [{ id: 'c', name: 'Indirect', type: 'Task', importance: 0.3 }],
          ],
        },
      ];
      mockGraphService._submit
        .mockResolvedValueOnce(mockPaths)
        .mockResolvedValueOnce([]);

      const result = await simulateRemoval('Target');

      expect(result.impact.directlyAffected).toBeDefined();
      expect(result.impact.indirectlyAffected).toBeDefined();
      expect(result.impact.criticallyAffected).toBeDefined();
    });

    it('should provide recommendation based on impact', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      const result = await simulateRemoval('Low Risk Entity');

      expect(result.recommendation).toBeDefined();
      expect(typeof result.recommendation).toBe('string');
    });
  });

  describe('getImpactAnalysisWithCache', () => {
    it('should cache results', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      // First call
      await getImpactAnalysisWithCache('Entity A', 'upstream');
      // Second call (should use cache)
      await getImpactAnalysisWithCache('Entity A', 'upstream');

      // _submit should only be called once due to caching
      expect(mockGraphService._submit).toHaveBeenCalledTimes(1);
    });

    it('should bypass cache when forceRefresh is true', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      await getImpactAnalysisWithCache('Entity A', 'upstream');
      await getImpactAnalysisWithCache('Entity A', 'upstream', { forceRefresh: true });

      expect(mockGraphService._submit).toHaveBeenCalledTimes(2);
    });

    it('should use different cache keys for different directions', async () => {
      mockGraphService._submit.mockResolvedValue([]);

      await getImpactAnalysisWithCache('Entity A', 'upstream');
      await getImpactAnalysisWithCache('Entity A', 'downstream');

      expect(mockGraphService._submit).toHaveBeenCalledTimes(2);
    });
  });

  describe('DEPENDENCY_EDGE_TYPES', () => {
    it('should have upstream edge types', () => {
      expect(DEPENDENCY_EDGE_TYPES.upstream).toBeDefined();
      expect(Array.isArray(DEPENDENCY_EDGE_TYPES.upstream)).toBe(true);
      expect(DEPENDENCY_EDGE_TYPES.upstream).toContain('DEPENDS_ON');
      expect(DEPENDENCY_EDGE_TYPES.upstream).toContain('REQUIRES');
      expect(DEPENDENCY_EDGE_TYPES.upstream).toContain('USES');
    });

    it('should have downstream edge types', () => {
      expect(DEPENDENCY_EDGE_TYPES.downstream).toBeDefined();
      expect(Array.isArray(DEPENDENCY_EDGE_TYPES.downstream)).toBe(true);
      expect(DEPENDENCY_EDGE_TYPES.downstream).toContain('PRODUCES');
      expect(DEPENDENCY_EDGE_TYPES.downstream).toContain('CONTAINS');
    });

    it('should have bidirectional edge types', () => {
      expect(DEPENDENCY_EDGE_TYPES.bidirectional).toBeDefined();
      expect(Array.isArray(DEPENDENCY_EDGE_TYPES.bidirectional)).toBe(true);
      expect(DEPENDENCY_EDGE_TYPES.bidirectional).toContain('RELATED_TO');
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.maxDepth).toBe(5);
      expect(DEFAULT_CONFIG.maxEntities).toBe(100);
      expect(DEFAULT_CONFIG.includeImportance).toBe(true);
      expect(DEFAULT_CONFIG.decayFactor).toBe(0.7);
    });

    it('should have reasonable decay factor', () => {
      expect(DEFAULT_CONFIG.decayFactor).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.decayFactor).toBeLessThan(1);
    });
  });
});
