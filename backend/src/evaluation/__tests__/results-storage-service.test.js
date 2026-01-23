/**
 * Tests for Results Storage Service
 *
 * Feature: F1.3.2 - Results Storage
 */

const path = require('path');
const fs = require('fs');

// Mock Cosmos DB client
jest.mock('@azure/cosmos', () => ({
  CosmosClient: jest.fn().mockImplementation(() => ({
    databases: {
      createIfNotExists: jest.fn().mockResolvedValue({
        database: {
          containers: {
            createIfNotExists: jest.fn().mockResolvedValue({
              container: {
                items: {
                  create: jest.fn().mockResolvedValue({ resource: {} }),
                  upsert: jest.fn().mockResolvedValue({ resource: {} }),
                  query: jest.fn().mockReturnValue({
                    fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
                  }),
                },
                item: jest.fn().mockReturnValue({
                  read: jest.fn().mockResolvedValue({ resource: {} }),
                  delete: jest.fn().mockResolvedValue({}),
                }),
              },
            }),
          },
        },
      }),
    },
  })),
}));

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

// Use local storage for tests
const TEST_STORAGE_PATH = path.join(__dirname, '../../data/test-evaluation-results');

describe('ResultsStorageService', () => {
  let ResultsStorageService;
  let getResultsStorageService;
  let CONFIG;
  let DOC_TYPES;
  let STORAGE_BACKENDS;
  let service;

  beforeAll(() => {
    // Set environment to use local storage for tests
    delete process.env.COSMOS_DB_ENDPOINT;
    process.env.EVALUATION_RESULTS_PATH = TEST_STORAGE_PATH;

    // Import after setting environment
    const module = require('../results-storage-service');
    ResultsStorageService = module.ResultsStorageService;
    getResultsStorageService = module.getResultsStorageService;
    CONFIG = module.CONFIG;
    DOC_TYPES = module.DOC_TYPES;
    STORAGE_BACKENDS = module.STORAGE_BACKENDS;
  });

  beforeEach(() => {
    // Clear test storage before each test
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true, force: true });
    }

    // Create fresh instance for each test
    service = new ResultsStorageService();
  });

  afterAll(() => {
    // Clean up test storage
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true, force: true });
    }
  });

  describe('Configuration', () => {
    test('should have correct default configuration', () => {
      expect(CONFIG.CONTAINER_ID).toBe('evaluation-results');
      expect(CONFIG.PARTITION_KEY_PATH).toBe('/runId');
      expect(CONFIG.SCHEMA_VERSION).toBe('1.0.0');
      expect(CONFIG.MAX_RUNS_PER_QUERY).toBe(100);
    });

    test('should have correct document types', () => {
      expect(DOC_TYPES.BENCHMARK_RUN).toBe('benchmark_run');
      expect(DOC_TYPES.SUITE_RESULT).toBe('suite_result');
      expect(DOC_TYPES.BASELINE).toBe('baseline');
      expect(DOC_TYPES.COMPARISON).toBe('comparison');
    });

    test('should have correct storage backends', () => {
      expect(STORAGE_BACKENDS.COSMOS_DB).toBe('cosmos_db');
      expect(STORAGE_BACKENDS.LOCAL_JSON).toBe('local_json');
    });
  });

  describe('Benchmark Run Storage', () => {
    const sampleBenchmarkResult = {
      metadata: {
        timestamp: '2026-01-22T10:00:00.000Z',
        config: {
          suite: 'all',
          threshold: 0.7,
        },
        totalLatencyMs: 5000,
        dataset: {
          name: 'test-dataset',
          version: '1.0.0',
        },
      },
      suites: {
        retrieval: {
          suite: 'retrieval',
          status: 'success',
          metrics: {
            mrr: 0.85,
            map: 0.78,
          },
          passed: true,
          threshold: 0.7,
        },
        'entity-extraction': {
          suite: 'entity-extraction',
          status: 'success',
          metrics: {
            precision: 0.92,
            recall: 0.88,
            f1: 0.90,
          },
          passed: true,
          threshold: 0.7,
        },
        grounding: {
          suite: 'grounding',
          status: 'success',
          metrics: {
            averageScore: 0.82,
          },
          passed: true,
          threshold: 0.7,
        },
      },
      summary: {
        total: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        errors: 0,
        overallPassed: true,
      },
    };

    test('should store a benchmark run', async () => {
      const result = await service.storeRun(sampleBenchmarkResult, {
        runName: 'Test Run',
        gitCommit: 'abc123',
        gitBranch: 'main',
        tags: { environment: 'test' },
      });

      expect(result).toBeDefined();
      expect(result.runId).toMatch(/^run_\d+_[a-z0-9]+$/);
      expect(result.name).toBe('Test Run');
      expect(result.source.gitCommit).toBe('abc123');
      expect(result.source.gitBranch).toBe('main');
      expect(result.tags.environment).toBe('test');
      expect(result.docType).toBe(DOC_TYPES.BENCHMARK_RUN);
    });

    test('should extract key metrics correctly', async () => {
      const result = await service.storeRun(sampleBenchmarkResult);

      expect(result.summary.keyMetrics).toBeDefined();
      expect(result.summary.keyMetrics.mrr).toBe(0.85);
      expect(result.summary.keyMetrics.map).toBe(0.78);
      expect(result.summary.keyMetrics.entityF1).toBe(0.90);
      expect(result.summary.keyMetrics.entityPrecision).toBe(0.92);
      expect(result.summary.keyMetrics.entityRecall).toBe(0.88);
      expect(result.summary.keyMetrics.groundingScore).toBe(0.82);
    });

    test('should retrieve a stored run by ID', async () => {
      const stored = await service.storeRun(sampleBenchmarkResult, {
        runName: 'Retrievable Run',
      });

      const retrieved = await service.getRun(stored.runId);

      expect(retrieved).toBeDefined();
      expect(retrieved.runId).toBe(stored.runId);
      expect(retrieved.name).toBe('Retrievable Run');
    });

    test('should return null for non-existent run', async () => {
      const result = await service.getRun('non_existent_run');
      expect(result).toBeNull();
    });

    test('should get recent runs in descending order', async () => {
      // Store multiple runs
      await service.storeRun(sampleBenchmarkResult, { runName: 'Run 1' });
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      await service.storeRun(sampleBenchmarkResult, { runName: 'Run 2' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.storeRun(sampleBenchmarkResult, { runName: 'Run 3' });

      const recentRuns = await service.getRecentRuns({ limit: 10 });

      expect(recentRuns.length).toBe(3);
      expect(recentRuns[0].name).toBe('Run 3');
      expect(recentRuns[1].name).toBe('Run 2');
      expect(recentRuns[2].name).toBe('Run 1');
    });

    test('should filter runs by git branch', async () => {
      await service.storeRun(sampleBenchmarkResult, { gitBranch: 'main' });
      await service.storeRun(sampleBenchmarkResult, { gitBranch: 'feature-x' });
      await service.storeRun(sampleBenchmarkResult, { gitBranch: 'main' });

      const mainRuns = await service.getRecentRuns({ gitBranch: 'main' });
      const featureRuns = await service.getRecentRuns({ gitBranch: 'feature-x' });

      expect(mainRuns.length).toBe(2);
      expect(featureRuns.length).toBe(1);
    });

    test('should filter runs by tags', async () => {
      await service.storeRun(sampleBenchmarkResult, { tags: { env: 'prod' } });
      await service.storeRun(sampleBenchmarkResult, { tags: { env: 'staging' } });
      await service.storeRun(sampleBenchmarkResult, { tags: { env: 'prod' } });

      const prodRuns = await service.getRecentRuns({ tags: { env: 'prod' } });

      expect(prodRuns.length).toBe(2);
    });

    test('should get latest run', async () => {
      await service.storeRun(sampleBenchmarkResult, { runName: 'Old Run' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.storeRun(sampleBenchmarkResult, { runName: 'Latest Run' });

      const latest = await service.getLatestRun();

      expect(latest).toBeDefined();
      expect(latest.name).toBe('Latest Run');
    });

    test('should delete a run', async () => {
      const stored = await service.storeRun(sampleBenchmarkResult);

      const deleted = await service.deleteRun(stored.runId);
      expect(deleted).toBe(true);

      const retrieved = await service.getRun(stored.runId);
      expect(retrieved).toBeNull();
    });

    test('should return false when deleting non-existent run', async () => {
      const deleted = await service.deleteRun('non_existent_run');
      expect(deleted).toBe(false);
    });
  });

  describe('Baseline Management', () => {
    const sampleBenchmarkResult = {
      metadata: { timestamp: new Date().toISOString() },
      suites: {
        retrieval: {
          status: 'success',
          metrics: { mrr: 0.85, map: 0.78 },
        },
      },
      summary: {
        total: 1,
        passed: 1,
        overallPassed: true,
        keyMetrics: { mrr: 0.85 },
      },
    };

    test('should set a baseline', async () => {
      const run = await service.storeRun(sampleBenchmarkResult);
      const baseline = await service.setBaseline(run.runId, 'test-baseline');

      expect(baseline).toBeDefined();
      expect(baseline.name).toBe('test-baseline');
      expect(baseline.sourceRunId).toBe(run.runId);
      expect(baseline.docType).toBe(DOC_TYPES.BASELINE);
    });

    test('should get a baseline', async () => {
      const run = await service.storeRun(sampleBenchmarkResult);
      await service.setBaseline(run.runId, 'my-baseline');

      const baseline = await service.getBaseline('my-baseline');

      expect(baseline).toBeDefined();
      expect(baseline.name).toBe('my-baseline');
    });

    test('should update existing baseline', async () => {
      const run1 = await service.storeRun(sampleBenchmarkResult);
      await service.setBaseline(run1.runId, 'shared-baseline');

      const run2 = await service.storeRun(sampleBenchmarkResult);
      const updatedBaseline = await service.setBaseline(run2.runId, 'shared-baseline');

      expect(updatedBaseline.sourceRunId).toBe(run2.runId);
    });

    test('should return null for non-existent baseline', async () => {
      const baseline = await service.getBaseline('non-existent');
      expect(baseline).toBeNull();
    });

    test('should throw error when setting baseline for non-existent run', async () => {
      await expect(service.setBaseline('non_existent_run', 'test')).rejects.toThrow(
        'Run not found'
      );
    });
  });

  describe('Trend Analysis', () => {
    test('should calculate metric trend', async () => {
      const baseResult = {
        metadata: { timestamp: new Date().toISOString() },
        suites: {},
        summary: { total: 1, passed: 1, overallPassed: true },
      };

      // Store runs with increasing MRR values
      for (let i = 0; i < 5; i++) {
        const result = {
          ...baseResult,
          suites: {
            retrieval: {
              status: 'success',
              metrics: { mrr: 0.7 + i * 0.05 },
            },
          },
        };
        await service.storeRun(result);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const trend = await service.getMetricTrend('mrr');

      expect(trend.metricName).toBe('mrr');
      expect(trend.dataPoints.length).toBe(5);
      expect(trend.statistics.min).toBeCloseTo(0.7, 4);
      expect(trend.statistics.max).toBeCloseTo(0.9, 4);
      expect(trend.statistics.latest).toBeCloseTo(0.9, 4);
      expect(trend.statistics.mean).toBeCloseTo(0.8, 2);
    });

    test('should detect improving trend', async () => {
      const baseResult = {
        metadata: { timestamp: new Date().toISOString() },
        suites: {},
        summary: { total: 1, passed: 1, overallPassed: true },
      };

      // Store 6 runs with clear improvement
      const values = [0.5, 0.52, 0.53, 0.7, 0.72, 0.75];
      for (const mrr of values) {
        const result = {
          ...baseResult,
          suites: {
            retrieval: {
              status: 'success',
              metrics: { mrr },
            },
          },
        };
        await service.storeRun(result);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const trend = await service.getMetricTrend('mrr');

      expect(trend.statistics.trend).toBe('improving');
    });

    test('should get all metric trends', async () => {
      const result = {
        metadata: { timestamp: new Date().toISOString() },
        suites: {
          retrieval: {
            status: 'success',
            metrics: { mrr: 0.85, map: 0.78 },
          },
          'entity-extraction': {
            status: 'success',
            metrics: { f1: 0.9, precision: 0.92, recall: 0.88 },
          },
        },
        summary: { total: 2, passed: 2, overallPassed: true },
      };

      await service.storeRun(result);
      await service.storeRun(result);

      const trends = await service.getAllMetricTrends();

      expect(trends.mrr).toBeDefined();
      expect(trends.map).toBeDefined();
      expect(trends.entityF1).toBeDefined();
      expect(trends.entityPrecision).toBeDefined();
      expect(trends.entityRecall).toBeDefined();
    });
  });

  describe('Run Comparison', () => {
    const createRunResult = (metrics) => ({
      metadata: { timestamp: new Date().toISOString() },
      suites: {
        retrieval: {
          status: 'success',
          metrics: { mrr: metrics.mrr || 0.8, map: metrics.map || 0.75 },
        },
        'entity-extraction': {
          status: 'success',
          metrics: { f1: metrics.entityF1 || 0.85 },
        },
      },
      summary: { total: 2, passed: 2, overallPassed: true },
    });

    test('should compare two runs', async () => {
      const run1 = await service.storeRun(createRunResult({ mrr: 0.8, entityF1: 0.85 }));
      const run2 = await service.storeRun(createRunResult({ mrr: 0.85, entityF1: 0.83 }));

      const comparison = await service.compareRuns(run1.runId, run2.runId);

      expect(comparison).toBeDefined();
      expect(comparison.baselineRun.runId).toBe(run1.runId);
      expect(comparison.currentRun.runId).toBe(run2.runId);
      expect(comparison.metrics.mrr).toBeDefined();
      expect(comparison.metrics.mrr.baseline).toBe(0.8);
      expect(comparison.metrics.mrr.current).toBe(0.85);
      expect(comparison.metrics.mrr.diff).toBeCloseTo(0.05, 4);
    });

    test('should identify regressions', async () => {
      const run1 = await service.storeRun(createRunResult({ mrr: 0.9, entityF1: 0.95 }));
      const run2 = await service.storeRun(createRunResult({ mrr: 0.7, entityF1: 0.75 }));

      const comparison = await service.compareRuns(run1.runId, run2.runId, {
        regressionThreshold: 0.05,
      });

      expect(comparison.summary.hasRegressions).toBe(true);
      expect(comparison.regressions.length).toBeGreaterThan(0);
      expect(comparison.regressions.some((r) => r.metric === 'mrr')).toBe(true);
    });

    test('should identify improvements', async () => {
      const run1 = await service.storeRun(createRunResult({ mrr: 0.7 }));
      const run2 = await service.storeRun(createRunResult({ mrr: 0.9 }));

      const comparison = await service.compareRuns(run1.runId, run2.runId);

      expect(comparison.improvements.some((i) => i.metric === 'mrr')).toBe(true);
    });

    test('should compare to baseline', async () => {
      const baselineRun = await service.storeRun(createRunResult({ mrr: 0.8 }));
      await service.setBaseline(baselineRun.runId, 'default');

      const currentRun = await service.storeRun(createRunResult({ mrr: 0.85 }));

      const comparison = await service.compareToBaseline(currentRun.runId);

      expect(comparison.baselineRun.runId).toBe(baselineRun.runId);
      expect(comparison.currentRun.runId).toBe(currentRun.runId);
    });

    test('should throw error when comparing non-existent runs', async () => {
      const run = await service.storeRun(createRunResult({}));

      await expect(service.compareRuns('non_existent', run.runId)).rejects.toThrow(
        'Run not found'
      );
    });
  });

  describe('Utility Methods', () => {
    test('should return storage statistics', async () => {
      const result = {
        metadata: { timestamp: new Date().toISOString() },
        suites: {},
        summary: { total: 0, passed: 0, overallPassed: true },
      };

      await service.storeRun(result);
      await service.storeRun(result);

      const stats = await service.getStats();

      expect(stats.backend).toBe(STORAGE_BACKENDS.LOCAL_JSON);
      expect(stats.runCount).toBe(2);
      expect(stats.schemaVersion).toBe(CONFIG.SCHEMA_VERSION);
    });

    test('should pass health check', async () => {
      const health = await service.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.backend).toBe(STORAGE_BACKENDS.LOCAL_JSON);
      expect(health.timestamp).toBeDefined();
    });
  });

  describe('Singleton Pattern', () => {
    test('should return same instance', () => {
      const instance1 = getResultsStorageService();
      const instance2 = getResultsStorageService();

      expect(instance1).toBe(instance2);
    });
  });
});
