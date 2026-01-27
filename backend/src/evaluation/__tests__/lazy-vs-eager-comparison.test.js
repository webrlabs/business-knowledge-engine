const {
  compareStrategies,
  runComparisonBenchmark,
  formatComparisonReport,
  formatComparisonReportMarkdown,
  formatComparisonReportJSON,
  calculateAggregateMetrics,
  createSampleComparisonDataset,
  getRecommendation,
  DEFAULT_CONFIG,
} = require('../lazy-vs-eager-comparison');
const { getGraphRAGService } = require('../../services/graph-rag-service');
const { evaluateBatch } = require('../llm-judge');
const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('../../services/graph-rag-service');
jest.mock('../llm-judge');
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Lazy vs Eager Comparison Service (F6.2.4)', () => {
  let mockGraphRAGService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGraphRAGService = {
      generateAnswer: jest.fn(),
    };
    getGraphRAGService.mockReturnValue(mockGraphRAGService);

    // Default mock implementation for evaluateBatch
    evaluateBatch.mockResolvedValue({
      evaluations: [
        { overallScore: 4.5, dimensions: { helpfulness: { score: 5 }, accuracy: { score: 4 } } },
        { overallScore: 4.0, dimensions: { helpfulness: { score: 4 }, accuracy: { score: 4 } } },
      ],
    });
  });

  const testQueries = [
    { question: 'Test Q1', expectedAnswer: 'A1' },
    { question: 'Test Q2', expectedAnswer: 'A2' },
  ];

  describe('compareStrategies', () => {
    it('should compare strategies successfully', async () => {
      mockGraphRAGService.generateAnswer
        .mockImplementationOnce(async () => ({
          answer: 'Eager Answer 1',
          metadata: { processingTimeMs: 100, communityCount: 5 },
          context: 'Context 1',
        }))
        .mockImplementationOnce(async () => ({
          answer: 'Lazy Answer 1',
          metadata: { processingTimeMs: 200, communityCount: 3 },
          context: 'Context 1',
        }))
        .mockImplementationOnce(async () => ({
          answer: 'Eager Answer 2',
          metadata: { processingTimeMs: 150, communityCount: 6 },
          context: 'Context 2',
        }))
        .mockImplementationOnce(async () => ({
          answer: 'Lazy Answer 2',
          metadata: { processingTimeMs: 250, communityCount: 4 },
          context: 'Context 2',
        }));

      const results = await compareStrategies(testQueries);

      expect(results).toBeDefined();
      expect(results.summary.queryCount).toBe(2);
      expect(evaluateBatch).toHaveBeenCalledTimes(2);
      expect(results.summary.communities.eagerAvg).toBe(5.5);
      expect(results.summary.communities.lazyAvg).toBe(3.5);
    });

    it('should pass options to GraphRAG service correctly', async () => {
      mockGraphRAGService.generateAnswer.mockResolvedValue({
        answer: 'Test answer',
        metadata: { communityCount: 2 },
        context: 'Context',
      });

      await compareStrategies([{ question: 'Test' }]);

      // First call should be Eager (lazySummaries: false)
      expect(mockGraphRAGService.generateAnswer).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ lazySummaries: false, includeCommunityContext: true })
      );

      // Second call should be Lazy (lazySummaries: true)
      expect(mockGraphRAGService.generateAnswer).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ lazySummaries: true, includeCommunityContext: true })
      );
    });

    it('should handle errors gracefully', async () => {
      mockGraphRAGService.generateAnswer.mockRejectedValue(new Error('Simulated failure'));

      const results = await compareStrategies([{ question: 'Fail Me' }]);

      expect(results.details[0].eager.answer).toBe('Error');
      expect(results.details[0].lazy.answer).toBe('Error');
    });

    it('should calculate latency difference correctly', async () => {
      mockGraphRAGService.generateAnswer.mockResolvedValue({
        answer: 'Answer',
        metadata: { communityCount: 2 },
        context: 'Context',
      });

      const results = await compareStrategies([{ question: 'Test' }]);

      expect(results.details[0]).toHaveProperty('latencyDiff');
      expect(results.details[0]).toHaveProperty('latencyDiffPercent');
    });

    it('should support query field as alternative to question', async () => {
      mockGraphRAGService.generateAnswer.mockResolvedValue({
        answer: 'Answer',
        metadata: { communityCount: 2 },
        context: 'Context',
      });

      const queries = [{ query: 'Alternative field' }];
      await compareStrategies(queries);

      expect(mockGraphRAGService.generateAnswer).toHaveBeenCalledWith(
        'Alternative field',
        expect.any(Object)
      );
    });
  });

  describe('calculateAggregateMetrics', () => {
    it('should calculate averages correctly', () => {
      const results = [
        { eager: { latency: 100, quality: 4.0, communityCount: 5 }, lazy: { latency: 150, quality: 3.5, communityCount: 3 } },
        { eager: { latency: 200, quality: 4.5, communityCount: 7 }, lazy: { latency: 250, quality: 4.0, communityCount: 4 } },
      ];

      const aggregate = calculateAggregateMetrics(results);

      expect(aggregate.queryCount).toBe(2);
      expect(aggregate.latency.eagerAvg).toBe(150);
      expect(aggregate.latency.lazyAvg).toBe(200);
      expect(aggregate.quality.eagerAvg).toBe(4.25);
      expect(aggregate.quality.lazyAvg).toBe(3.75);
    });

    it('should determine winners correctly', () => {
      const results = [
        { eager: { latency: 100, quality: 4.0 }, lazy: { latency: 200, quality: 3.5 } },
        { eager: { latency: 150, quality: 4.5 }, lazy: { latency: 300, quality: 4.0 } },
      ];

      const aggregate = calculateAggregateMetrics(results);

      expect(aggregate.latency.winner).toBe('Eager'); // Lower is better
      expect(aggregate.quality.winner).toBe('Eager'); // Higher is better
    });

    it('should count wins correctly', () => {
      const results = [
        { eager: { latency: 100, quality: 4.0 }, lazy: { latency: 200, quality: 5.0 } },
        { eager: { latency: 200, quality: 4.0 }, lazy: { latency: 100, quality: 4.0 } },
        { eager: { latency: 150, quality: 3.0 }, lazy: { latency: 150, quality: 3.0 } },
      ];

      const aggregate = calculateAggregateMetrics(results);

      expect(aggregate.wins.latency.eager).toBe(1);
      expect(aggregate.wins.latency.lazy).toBe(1);
      expect(aggregate.wins.latency.tie).toBe(1);
      expect(aggregate.wins.quality.tie).toBe(2);
      expect(aggregate.wins.quality.lazy).toBe(1);
    });

    it('should handle empty results', () => {
      const aggregate = calculateAggregateMetrics([]);
      expect(aggregate).toEqual({});
    });
  });

  describe('formatComparisonReport', () => {
    const mockResults = {
      totalTimeMs: 1000,
      summary: {
        queryCount: 10,
        latency: {
          eagerAvg: 100,
          lazyAvg: 200,
          diff: 100,
          diffPercent: 100,
          winner: 'Eager',
        },
        quality: {
          eagerAvg: 4.5,
          lazyAvg: 4.0,
          diff: -0.5,
          winner: 'Eager',
        },
        communities: {
          eagerAvg: 5,
          lazyAvg: 3,
        },
        wins: {
          latency: { eager: 10, lazy: 0, tie: 0 },
          quality: { eager: 8, lazy: 2, tie: 0 },
        },
      },
    };

    it('should format text report correctly', () => {
      const report = formatComparisonReport(mockResults);
      expect(report).toContain('LAZY VS EAGER GRAPHRAG COMPARISON REPORT');
      expect(report).toContain('Queries Tested:     10');
      expect(report).toContain('Eager Average:      100 ms');
      expect(report).toContain('Winner:             EAGER');
    });

    it('should include latency metrics', () => {
      const report = formatComparisonReport(mockResults);
      expect(report).toContain('Lazy Average:       200 ms');
      expect(report).toContain('Difference:         +100 ms');
    });

    it('should include quality metrics', () => {
      const report = formatComparisonReport(mockResults);
      expect(report).toContain('4.5');
      // Lazy average 4.0 may be formatted as "4" without decimal
      expect(report).toMatch(/Lazy Average:\s+4/);
    });

    it('should include community insights', () => {
      const report = formatComparisonReport(mockResults);
      expect(report).toContain('Avg Communities (Eager): 5');
      expect(report).toContain('Avg Communities (Lazy):  3');
    });
  });

  describe('formatComparisonReportMarkdown', () => {
    const mockResults = {
      totalTimeMs: 1000,
      summary: {
        queryCount: 5,
        latency: { eagerAvg: 150, lazyAvg: 200, diff: 50, diffPercent: 33.3, winner: 'Eager' },
        quality: { eagerAvg: 4.2, lazyAvg: 4.0, diff: -0.2, winner: 'Eager' },
        communities: { eagerAvg: 4, lazyAvg: 2 },
        wins: { latency: { eager: 4, lazy: 1, tie: 0 }, quality: { eager: 3, lazy: 2, tie: 0 } },
      },
      details: [
        { query: 'Test query 1', eager: { latency: 100, quality: 4.0 }, lazy: { latency: 120, quality: 3.8 } },
      ],
    };

    it('should generate valid markdown', () => {
      const report = formatComparisonReportMarkdown(mockResults);
      expect(report).toContain('# Lazy vs Eager GraphRAG Comparison Report');
      expect(report).toContain('## Overview');
      expect(report).toContain('## Latency Comparison');
      expect(report).toContain('## Quality Comparison');
    });

    it('should include tables', () => {
      const report = formatComparisonReportMarkdown(mockResults);
      expect(report).toContain('| Metric | Value |');
      expect(report).toContain('| Strategy | Avg Latency | Win Count |');
    });

    it('should include per-query details', () => {
      const report = formatComparisonReportMarkdown(mockResults);
      expect(report).toContain('## Per-Query Details');
      expect(report).toContain('Test query 1');
    });
  });

  describe('formatComparisonReportJSON', () => {
    it('should generate valid JSON', () => {
      const mockResults = {
        totalTimeMs: 500,
        config: { iterations: 1 },
        summary: { queryCount: 2 },
        details: [],
      };

      const jsonString = formatComparisonReportJSON(mockResults);
      const parsed = JSON.parse(jsonString);

      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.feature).toBe('F6.2.4');
      expect(parsed.summary).toBeDefined();
    });
  });

  describe('createSampleComparisonDataset', () => {
    it('should create valid dataset', () => {
      const dataset = createSampleComparisonDataset();

      expect(dataset.metadata).toBeDefined();
      expect(dataset.metadata.name).toBe('lazy-vs-eager-sample');
      expect(dataset.queries).toBeDefined();
      expect(Array.isArray(dataset.queries)).toBe(true);
      expect(dataset.queries.length).toBeGreaterThan(0);
    });

    it('should include required fields in queries', () => {
      const dataset = createSampleComparisonDataset();

      dataset.queries.forEach(query => {
        expect(query.question).toBeDefined();
        expect(query.category).toBeDefined();
      });
    });
  });

  describe('getRecommendation', () => {
    it('should recommend Eager when it wins both quality and latency', () => {
      const summary = {
        quality: { eagerAvg: 4.5, lazyAvg: 4.0, winner: 'Eager' },
        latency: { eagerAvg: 100, lazyAvg: 200, winner: 'Eager' },
        communities: { eagerAvg: 5, lazyAvg: 3 },
      };

      const rec = getRecommendation(summary);

      expect(rec.recommended).toBe('Eager');
      expect(rec.eagerScore).toBeGreaterThan(rec.lazyScore);
      expect(rec.reasons.length).toBeGreaterThan(0);
    });

    it('should recommend Lazy when it wins both quality and latency', () => {
      const summary = {
        quality: { eagerAvg: 3.5, lazyAvg: 4.5, winner: 'Lazy' },
        latency: { eagerAvg: 200, lazyAvg: 100, winner: 'Lazy' },
        communities: { eagerAvg: 5, lazyAvg: 2 },
      };

      const rec = getRecommendation(summary);

      expect(rec.recommended).toBe('Lazy');
      expect(rec.lazyScore).toBeGreaterThan(rec.eagerScore);
    });

    it('should prioritize quality over latency', () => {
      const summary = {
        quality: { eagerAvg: 4.5, lazyAvg: 3.5, winner: 'Eager' },
        latency: { eagerAvg: 300, lazyAvg: 100, winner: 'Lazy' },
        communities: { eagerAvg: 5, lazyAvg: 3 },
      };

      const rec = getRecommendation(summary);

      // Quality weight is 0.6, latency weight is 0.4
      // Eager: 0.6 (quality), Lazy: 0.4 (latency)
      expect(rec.recommended).toBe('Eager');
    });

    it('should provide advice text', () => {
      const summary = {
        quality: { winner: 'Eager', eagerAvg: 4, lazyAvg: 3 },
        latency: { winner: 'Eager', eagerAvg: 100, lazyAvg: 200 },
        communities: { eagerAvg: 5, lazyAvg: 3 },
      };

      const rec = getRecommendation(summary);

      expect(rec.advice).toBeDefined();
      expect(rec.advice.length).toBeGreaterThan(0);
    });
  });

  describe('runComparisonBenchmark', () => {
    it('should load and run benchmark from file', async () => {
      mockGraphRAGService.generateAnswer.mockResolvedValue({
        answer: 'Benchmark answer',
        metadata: { communityCount: 3 },
        context: 'Context',
      });

      // Use the actual benchmark dataset file
      const datasetPath = path.join(__dirname, '..', 'datasets', 'lazy_vs_eager_benchmark.json');

      // Check if file exists
      if (!fs.existsSync(datasetPath)) {
        console.warn('Benchmark dataset not found, skipping test');
        return;
      }

      const results = await runComparisonBenchmark(datasetPath, { iterations: 1 });

      expect(results).toBeDefined();
      expect(results.dataset).toBeDefined();
      expect(results.summary.queryCount).toBeGreaterThan(0);
    });

    it('should throw error for missing dataset', async () => {
      await expect(runComparisonBenchmark('/nonexistent/path.json')).rejects.toThrow('Failed to load dataset');
    });

    it('should throw error for empty queries', async () => {
      // Create a temp file with empty queries
      const tempPath = path.join(__dirname, 'temp-empty-dataset.json');
      fs.writeFileSync(tempPath, JSON.stringify({ queries: [] }));

      try {
        await expect(runComparisonBenchmark(tempPath)).rejects.toThrow('must contain a "queries" array');
      } finally {
        fs.unlinkSync(tempPath);
      }
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.iterations).toBe(1);
      expect(DEFAULT_CONFIG.warmup).toBe(false);
      expect(DEFAULT_CONFIG.judgeCriteria).toContain('helpfulness');
      expect(DEFAULT_CONFIG.judgeCriteria).toContain('accuracy');
      expect(DEFAULT_CONFIG.concurrency).toBe(1);
    });
  });
});
