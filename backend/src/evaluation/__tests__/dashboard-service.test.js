/**
 * Tests for Dashboard Service (F1.3.5)
 *
 * Tests the evaluation dashboard generation functionality including:
 * - Sparkline generation
 * - Dashboard data structure
 * - Markdown report generation
 * - Comparison report generation
 * - Quick status checks
 */

const {
  DashboardService,
  getDashboardService,
  generateSparkline,
  CONFIG,
} = require('../dashboard-service');

// Mock the results storage service
jest.mock('../results-storage-service', () => {
  const mockRuns = [
    {
      runId: 'run_1',
      name: 'Test Run 1',
      timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
      summary: {
        overallPassed: true,
        keyMetrics: {
          mrr: 0.85,
          map: 0.80,
          answerQuality: 0.75,
          groundingScore: 0.90,
          citationAccuracy: 0.88,
          entityF1: 0.82,
          entityPrecision: 0.85,
          entityRecall: 0.79,
          relationshipF1: 0.78,
          directionAccuracy: 0.92,
        },
      },
      source: {
        gitCommit: 'abc1234567890',
        gitBranch: 'main',
      },
    },
    {
      runId: 'run_2',
      name: 'Test Run 2',
      timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      summary: {
        overallPassed: true,
        keyMetrics: {
          mrr: 0.87,
          map: 0.82,
          answerQuality: 0.78,
          groundingScore: 0.91,
          citationAccuracy: 0.89,
          entityF1: 0.84,
          entityPrecision: 0.86,
          entityRecall: 0.82,
          relationshipF1: 0.80,
          directionAccuracy: 0.93,
        },
      },
      source: {
        gitCommit: 'def4567890123',
        gitBranch: 'main',
      },
    },
    {
      runId: 'run_3',
      name: 'Test Run 3',
      timestamp: new Date().toISOString(), // Today
      summary: {
        overallPassed: true,
        keyMetrics: {
          mrr: 0.88,
          map: 0.83,
          answerQuality: 0.79,
          groundingScore: 0.92,
          citationAccuracy: 0.90,
          entityF1: 0.85,
          entityPrecision: 0.87,
          entityRecall: 0.83,
          relationshipF1: 0.81,
          directionAccuracy: 0.94,
        },
      },
      source: {
        gitCommit: 'ghi7890123456',
        gitBranch: 'main',
      },
    },
  ];

  const mockBaseline = {
    name: 'default',
    sourceRunId: 'run_1',
    sourceRunTimestamp: mockRuns[0].timestamp,
    keyMetrics: mockRuns[0].summary.keyMetrics,
  };

  const mockStats = {
    backend: 'local_json',
    runCount: 3,
    baselineCount: 1,
    latestRunId: 'run_3',
    latestRunTimestamp: mockRuns[2].timestamp,
    latestOverallPassed: true,
  };

  return {
    getResultsStorageService: jest.fn(() => ({
      getStats: jest.fn().mockResolvedValue(mockStats),
      getRecentRuns: jest.fn().mockResolvedValue([...mockRuns].reverse()),
      getLatestRun: jest.fn().mockResolvedValue(mockRuns[2]),
      getBaseline: jest.fn().mockResolvedValue(mockBaseline),
      getAllMetricTrends: jest.fn().mockResolvedValue({
        mrr: {
          metricName: 'mrr',
          dataPoints: mockRuns.map((r) => ({
            runId: r.runId,
            timestamp: r.timestamp,
            value: r.summary.keyMetrics.mrr,
          })),
          statistics: {
            min: 0.85,
            max: 0.88,
            mean: 0.867,
            stdDev: 0.012,
            latest: 0.88,
            trend: 'improving',
          },
        },
        answerQuality: {
          metricName: 'answerQuality',
          dataPoints: mockRuns.map((r) => ({
            runId: r.runId,
            timestamp: r.timestamp,
            value: r.summary.keyMetrics.answerQuality,
          })),
          statistics: {
            min: 0.75,
            max: 0.79,
            mean: 0.773,
            stdDev: 0.016,
            latest: 0.79,
            trend: 'improving',
          },
        },
        groundingScore: {
          metricName: 'groundingScore',
          dataPoints: mockRuns.map((r) => ({
            runId: r.runId,
            timestamp: r.timestamp,
            value: r.summary.keyMetrics.groundingScore,
          })),
          statistics: {
            min: 0.90,
            max: 0.92,
            mean: 0.91,
            stdDev: 0.008,
            latest: 0.92,
            trend: 'stable',
          },
        },
        entityF1: {
          metricName: 'entityF1',
          dataPoints: mockRuns.map((r) => ({
            runId: r.runId,
            timestamp: r.timestamp,
            value: r.summary.keyMetrics.entityF1,
          })),
          statistics: {
            min: 0.82,
            max: 0.85,
            mean: 0.837,
            stdDev: 0.012,
            latest: 0.85,
            trend: 'improving',
          },
        },
      }),
      compareToBaseline: jest.fn().mockResolvedValue({
        baselineRun: { runId: 'run_1', timestamp: mockRuns[0].timestamp },
        currentRun: { runId: 'run_3', timestamp: mockRuns[2].timestamp },
        metrics: {
          mrr: { baseline: 0.85, current: 0.88, diff: 0.03, percentChange: 3.5 },
          answerQuality: { baseline: 0.75, current: 0.79, diff: 0.04, percentChange: 5.3 },
        },
        regressions: [],
        improvements: [
          { metric: 'mrr', baseline: 0.85, current: 0.88, diff: 0.03, percentChange: 3.5 },
          { metric: 'answerQuality', baseline: 0.75, current: 0.79, diff: 0.04, percentChange: 5.3 },
        ],
        unchanged: [],
        summary: {
          regressionCount: 0,
          improvementCount: 2,
          unchangedCount: 0,
          hasRegressions: false,
        },
      }),
    })),
  };
});

describe('DashboardService', () => {
  let service;

  beforeEach(() => {
    service = new DashboardService();
  });

  describe('generateSparkline', () => {
    it('should generate a sparkline for an array of values', () => {
      const values = [0.5, 0.6, 0.7, 0.8, 0.9];
      const sparkline = generateSparkline(values);

      expect(sparkline).toBeTruthy();
      expect(sparkline.length).toBe(5);
      // Sparkline should show increasing trend
      expect(sparkline[0]).not.toBe(sparkline[4]); // First and last should differ
    });

    it('should handle empty arrays', () => {
      const sparkline = generateSparkline([]);
      expect(sparkline).toBe('─'.repeat(15));
    });

    it('should handle single value arrays', () => {
      const sparkline = generateSparkline([0.5]);
      expect(sparkline).toBeTruthy();
      expect(sparkline.length).toBe(1);
    });

    it('should handle constant values', () => {
      const values = [0.5, 0.5, 0.5, 0.5, 0.5];
      const sparkline = generateSparkline(values);

      // All bars should be the same height
      const uniqueChars = new Set(sparkline.split(''));
      expect(uniqueChars.size).toBe(1);
    });

    it('should downsample long arrays', () => {
      const values = new Array(100).fill(0).map((_, i) => i / 100);
      const sparkline = generateSparkline(values, 15);

      expect(sparkline.length).toBe(15);
    });
  });

  describe('generateDashboard', () => {
    it('should generate a dashboard with all required sections', async () => {
      const dashboard = await service.generateDashboard();

      expect(dashboard).toHaveProperty('generatedAt');
      expect(dashboard).toHaveProperty('config');
      expect(dashboard).toHaveProperty('summary');
      expect(dashboard).toHaveProperty('latestRun');
      expect(dashboard).toHaveProperty('baseline');
      expect(dashboard).toHaveProperty('trends');
      expect(dashboard).toHaveProperty('health');
    });

    it('should include summary statistics', async () => {
      const dashboard = await service.generateDashboard();

      expect(dashboard.summary).toHaveProperty('totalRuns');
      expect(dashboard.summary).toHaveProperty('passedRuns');
      expect(dashboard.summary).toHaveProperty('failedRuns');
      expect(dashboard.summary).toHaveProperty('passRate');
    });

    it('should include health status', async () => {
      const dashboard = await service.generateDashboard();

      expect(dashboard.health).toHaveProperty('score');
      expect(dashboard.health).toHaveProperty('status');
      expect(dashboard.health).toHaveProperty('indicator');
      expect(['healthy', 'warning', 'critical']).toContain(dashboard.health.status);
    });

    it('should include trend data with sparklines', async () => {
      const dashboard = await service.generateDashboard();

      expect(dashboard.trends).toHaveProperty('mrr');
      expect(dashboard.trends.mrr).toHaveProperty('sparkline');
      expect(dashboard.trends.mrr).toHaveProperty('statistics');
      expect(dashboard.trends.mrr.statistics).toHaveProperty('trendIndicator');
    });

    it('should generate markdown format when requested', async () => {
      const markdown = await service.generateDashboard({ format: 'markdown' });

      expect(typeof markdown).toBe('string');
      expect(markdown).toContain('# Evaluation Dashboard');
      expect(markdown).toContain('## Overall Health');
      expect(markdown).toContain('## Metric Trends');
    });
  });

  describe('generateComparisonReport', () => {
    it('should generate a comparison report', async () => {
      const report = await service.generateComparisonReport();

      expect(report).toHaveProperty('baseline');
      expect(report).toHaveProperty('current');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('improvements');
      expect(report).toHaveProperty('regressions');
    });

    it('should identify improvements correctly', async () => {
      const report = await service.generateComparisonReport();

      expect(report.summary.improvements).toBeGreaterThan(0);
      expect(report.improvements.length).toBeGreaterThan(0);
    });

    it('should generate markdown format when requested', async () => {
      const markdown = await service.generateComparisonReport({ format: 'markdown' });

      expect(typeof markdown).toBe('string');
      expect(markdown).toContain('# Baseline Comparison Report');
      expect(markdown).toContain('## Metric Comparison');
    });
  });

  describe('getQuickStatus', () => {
    it('should return quick status data', async () => {
      const status = await service.getQuickStatus();

      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('lastRunPassed');
      expect(status).toHaveProperty('totalRuns');
      expect(status).toHaveProperty('hasBaseline');
      expect(status).toHaveProperty('keyMetrics');
    });
  });

  describe('getDashboardService singleton', () => {
    it('should return the same instance', () => {
      const instance1 = getDashboardService();
      const instance2 = getDashboardService();

      expect(instance1).toBe(instance2);
    });
  });
});

describe('CONFIG', () => {
  it('should have sparkline characters defined', () => {
    expect(CONFIG.SPARKLINE_CHARS).toBeDefined();
    expect(CONFIG.SPARKLINE_CHARS.length).toBe(8);
  });

  it('should have metric info defined', () => {
    expect(CONFIG.METRIC_INFO).toBeDefined();
    expect(CONFIG.METRIC_INFO.mrr).toBeDefined();
    expect(CONFIG.METRIC_INFO.mrr.name).toBe('Mean Reciprocal Rank');
  });

  it('should have threshold values', () => {
    expect(CONFIG.GOOD_THRESHOLD).toBeDefined();
    expect(CONFIG.WARNING_THRESHOLD).toBeDefined();
    expect(CONFIG.GOOD_THRESHOLD).toBeGreaterThan(CONFIG.WARNING_THRESHOLD);
  });
});
