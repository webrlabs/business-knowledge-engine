/**
 * Performance Dashboard Service Tests (F5.2.7)
 *
 * Tests for the real-time performance monitoring dashboard service.
 */

const {
  PerformanceDashboardService,
  getPerformanceDashboardService,
  resetPerformanceDashboardService,
  throughputMiddleware,
  ThroughputTracker,
  ThroughputBucket,
  HistoryStorage,
  generateSparkline,
  HEALTH_STATUS,
  CONFIG,
} = require('../performance-dashboard-service');

// Mock the logger and telemetry
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
  trackMetric: jest.fn(),
}));

// Mock dependent services
jest.mock('../latency-budget-service', () => ({
  getLatencyBudgetService: jest.fn(() => ({
    getHealthSummary: jest.fn(() => ({
      status: 'healthy',
      enabledOperations: 6,
      healthyOperations: 6,
      unhealthyOperations: 0,
      details: {
        query: { status: 'ok', p95: 500, budgetMs: 3000, utilization: 17 },
        search: { status: 'ok', p95: 300, budgetMs: 1500, utilization: 20 },
      },
    })),
    getAggregatedStats: jest.fn(() => ({
      operations: {
        query: { percentiles: { p95: 500 }, budgetMs: 3000 },
        search: { percentiles: { p95: 300 }, budgetMs: 1500 },
      },
      totals: { measurements: 100, breaches: 2, breachRate: 0.02 },
    })),
  })),
}));

jest.mock('../circuit-breaker-service', () => ({
  getCircuitBreakerService: jest.fn(() => ({
    getStatus: jest.fn(() => ({
      enabled: true,
      breakers: {
        'openai:completion': { state: 'closed', stats: { fires: 50, successes: 48, failures: 2 } },
        'search:query': { state: 'closed', stats: { fires: 100, successes: 99, failures: 1 } },
      },
      summary: { total: 2, open: 0, closed: 2, halfOpen: 0 },
    })),
    getOpenCircuits: jest.fn(() => []),
  })),
}));

jest.mock('../entity-resolution-cache', () => ({
  getEntityResolutionCache: jest.fn(() => ({
    getStats: jest.fn(() => ({
      enabled: true,
      caches: {
        resolvedEntities: { hits: 80, misses: 20, hitRate: 0.8, size: 100, maxSize: 5000 },
        embeddings: { hits: 90, misses: 10, hitRate: 0.9, size: 50, maxSize: 2000 },
      },
      totals: { hits: 170, misses: 30, overallHitRate: 0.85, totalSize: 150, totalMaxSize: 7000 },
    })),
    getHealthSummary: jest.fn(() => ({
      status: 'enabled',
      overallHitRate: '85.00%',
      utilization: '2.1%',
      totalCachedItems: 150,
      health: 'healthy',
    })),
  })),
}));

jest.mock('../user-rate-limit-service', () => ({
  getRateLimitStats: jest.fn(() => ({
    getGlobalStats: jest.fn(() => ({
      totalHits: 1000,
      totalBlocked: 5,
      uniqueKeys: 50,
      uptimeMs: 3600000,
      avgHitsPerMinute: '16.67',
      blockRate: '0.50%',
    })),
  })),
}));

const { log } = require('../../utils/logger');
const { trackMetric } = require('../../utils/telemetry');

describe('PerformanceDashboardService', () => {
  let service;

  beforeEach(() => {
    // Reset the singleton for each test
    resetPerformanceDashboardService();
    service = new PerformanceDashboardService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (service) {
      service.shutdown();
    }
    resetPerformanceDashboardService();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      service.initialize();

      expect(service._initialized).toBe(true);
      expect(service._initializationTime).toBeTruthy();
    });

    it('should not reinitialize if already initialized', () => {
      service.initialize();
      const initialTime = service._initializationTime;

      service.initialize();

      expect(service._initializationTime).toBe(initialTime);
    });

    it('should auto-initialize on first method call', () => {
      expect(service._initialized).toBe(false);

      service.getThroughput();

      expect(service._initialized).toBe(true);
    });
  });

  describe('recordRequest', () => {
    it('should record successful requests', () => {
      service.initialize();

      service.recordRequest('/api/documents', 200);
      service.recordRequest('/api/documents', 200);
      service.recordRequest('/api/query', 200);

      const stats = service._throughput.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalErrors).toBe(0);
    });

    it('should track error requests', () => {
      service.initialize();

      service.recordRequest('/api/documents', 200);
      service.recordRequest('/api/documents', 500);
      service.recordRequest('/api/query', 404);

      const stats = service._throughput.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalErrors).toBe(2);
    });
  });

  describe('getDashboard', () => {
    it('should return complete dashboard data', () => {
      service.initialize();

      // Record some requests
      service.recordRequest('/api/test', 200);
      service.recordRequest('/api/test', 500);

      const dashboard = service.getDashboard();

      expect(dashboard).toHaveProperty('throughput');
      expect(dashboard).toHaveProperty('latency');
      expect(dashboard).toHaveProperty('circuitBreakers');
      expect(dashboard).toHaveProperty('cache');
      expect(dashboard).toHaveProperty('health');
      expect(dashboard).toHaveProperty('sparklines');
      expect(dashboard).toHaveProperty('metadata');
    });

    it('should include health status', () => {
      service.initialize();
      const dashboard = service.getDashboard();

      expect(dashboard.health).toHaveProperty('status');
      expect(dashboard.health).toHaveProperty('score');
      expect(dashboard.health).toHaveProperty('issues');
      expect(Object.values(HEALTH_STATUS)).toContain(dashboard.health.status);
    });

    it('should include sparklines', () => {
      service.initialize();

      // Record some requests to generate sparkline data
      for (let i = 0; i < 10; i++) {
        service.recordRequest('/api/test', 200);
      }

      const dashboard = service.getDashboard();

      expect(dashboard.sparklines).toHaveProperty('throughput');
      expect(dashboard.sparklines).toHaveProperty('errorRate');
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status', () => {
      service.initialize();
      const health = service.getHealthStatus();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('score');
      expect(health).toHaveProperty('scorePercent');
      expect(health).toHaveProperty('issues');
      expect(health).toHaveProperty('timestamp');
    });

    it('should return healthy status with no issues', () => {
      service.initialize();
      const health = service.getHealthStatus();

      // With all mocked services being healthy
      expect(health.status).toBe(HEALTH_STATUS.HEALTHY);
      expect(health.score).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('getThroughput', () => {
    it('should return throughput metrics', () => {
      service.initialize();

      service.recordRequest('/api/test', 200);
      service.recordRequest('/api/test', 200);

      const throughput = service.getThroughput();

      expect(throughput).toHaveProperty('requestsPerSecond');
      expect(throughput).toHaveProperty('errorRate');
      expect(throughput).toHaveProperty('totalRequests');
      expect(throughput).toHaveProperty('sparkline');
    });

    it('should calculate correct error rate', () => {
      service.initialize();

      // 2 successful, 1 error
      service.recordRequest('/api/test', 200);
      service.recordRequest('/api/test', 200);
      service.recordRequest('/api/test', 500);

      const throughput = service.getThroughput();

      expect(throughput.totalErrors).toBe(1);
      expect(throughput.totalRequests).toBe(3);
    });
  });

  describe('getLatencyMetrics', () => {
    it('should return latency metrics', () => {
      service.initialize();
      const latency = service.getLatencyMetrics();

      expect(latency.available).toBe(true);
      expect(latency).toHaveProperty('summary');
      expect(latency).toHaveProperty('operations');
      expect(latency).toHaveProperty('totals');
    });
  });

  describe('getCircuitBreakerMetrics', () => {
    it('should return circuit breaker metrics', () => {
      service.initialize();
      const cbMetrics = service.getCircuitBreakerMetrics();

      expect(cbMetrics.available).toBe(true);
      expect(cbMetrics).toHaveProperty('enabled');
      expect(cbMetrics).toHaveProperty('summary');
      expect(cbMetrics).toHaveProperty('breakers');
    });
  });

  describe('getCacheMetrics', () => {
    it('should return cache metrics', () => {
      service.initialize();
      const cacheMetrics = service.getCacheMetrics();

      expect(cacheMetrics.available).toBe(true);
      expect(cacheMetrics).toHaveProperty('health');
      expect(cacheMetrics).toHaveProperty('caches');
      expect(cacheMetrics).toHaveProperty('totals');
    });
  });

  describe('getRateLimitMetrics', () => {
    it('should return rate limit metrics', () => {
      service.initialize();
      const rateLimitMetrics = service.getRateLimitMetrics();

      expect(rateLimitMetrics.available).toBe(true);
      expect(rateLimitMetrics).toHaveProperty('totalHits');
      expect(rateLimitMetrics).toHaveProperty('totalBlocked');
    });
  });

  describe('getHistory', () => {
    it('should return empty history initially', () => {
      service.initialize();
      const history = service.getHistory(Date.now() - 3600000);

      expect(history).toHaveProperty('snapshots');
      expect(history).toHaveProperty('trends');
      expect(history).toHaveProperty('summary');
      expect(history.snapshots).toEqual([]);
    });

    it('should include time range in response', () => {
      service.initialize();
      const startTime = Date.now() - 3600000;
      const endTime = Date.now();

      const history = service.getHistory(startTime, endTime);

      expect(history.timeRange).toHaveProperty('start');
      expect(history.timeRange).toHaveProperty('end');
      expect(history.timeRange).toHaveProperty('durationMs');
    });
  });

  describe('generateTextReport', () => {
    it('should generate a text report', () => {
      service.initialize();

      service.recordRequest('/api/test', 200);

      const report = service.generateTextReport();

      expect(typeof report).toBe('string');
      expect(report).toContain('PERFORMANCE DASHBOARD');
      expect(report).toContain('Overall Health');
      expect(report).toContain('THROUGHPUT');
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      service.initialize();

      // Record some data
      service.recordRequest('/api/test', 200);
      service.recordRequest('/api/test', 500);

      // Reset
      service.reset();

      const throughput = service.getThroughput();
      expect(throughput.totalRequests).toBe(0);
      expect(throughput.totalErrors).toBe(0);
    });
  });
});

describe('ThroughputTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new ThroughputTracker(60000, 60); // 1 minute window, 60 buckets
  });

  describe('record', () => {
    it('should record requests', () => {
      tracker.record('/api/test', 200);
      tracker.record('/api/test', 200);

      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalErrors).toBe(0);
    });

    it('should track errors', () => {
      tracker.record('/api/test', 200);
      tracker.record('/api/test', 500);
      tracker.record('/api/test', 404);

      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalErrors).toBe(2);
    });
  });

  describe('getRequestsPerSecond', () => {
    it('should calculate RPS', () => {
      // Record multiple requests
      for (let i = 0; i < 100; i++) {
        tracker.record('/api/test', 200);
      }

      const rps = tracker.getRequestsPerSecond();
      expect(rps).toBeGreaterThan(0);
    });

    it('should return 0 with no requests', () => {
      const rps = tracker.getRequestsPerSecond();
      expect(rps).toBe(0);
    });
  });

  describe('getErrorRate', () => {
    it('should calculate correct error rate', () => {
      // 8 successful, 2 errors = 20% error rate
      for (let i = 0; i < 8; i++) {
        tracker.record('/api/test', 200);
      }
      tracker.record('/api/test', 500);
      tracker.record('/api/test', 500);

      const errorRate = tracker.getErrorRate();
      expect(errorRate).toBeCloseTo(0.2, 2);
    });

    it('should return 0 with no errors', () => {
      tracker.record('/api/test', 200);
      tracker.record('/api/test', 200);

      const errorRate = tracker.getErrorRate();
      expect(errorRate).toBe(0);
    });
  });

  describe('getHistory', () => {
    it('should return history array', () => {
      tracker.record('/api/test', 200);

      const history = tracker.getHistory();
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });

    it('should include rps and errorRate per bucket', () => {
      tracker.record('/api/test', 200);
      tracker.record('/api/test', 500);

      const history = tracker.getHistory();
      const lastBucket = history[history.length - 1];

      expect(lastBucket).toHaveProperty('timestamp');
      expect(lastBucket).toHaveProperty('rps');
      expect(lastBucket).toHaveProperty('errorRate');
    });
  });

  describe('reset', () => {
    it('should reset all data', () => {
      tracker.record('/api/test', 200);
      tracker.record('/api/test', 500);

      tracker.reset();

      const stats = tracker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalErrors).toBe(0);
    });
  });
});

describe('ThroughputBucket', () => {
  let bucket;

  beforeEach(() => {
    bucket = new ThroughputBucket(Date.now());
  });

  describe('record', () => {
    it('should track requests by endpoint', () => {
      bucket.record('/api/test', 200, false);
      bucket.record('/api/test', 200, false);
      bucket.record('/api/other', 200, false);

      const json = bucket.toJSON();
      expect(json.requests).toBe(3);
      expect(json.byEndpoint['/api/test'].requests).toBe(2);
      expect(json.byEndpoint['/api/other'].requests).toBe(1);
    });

    it('should track requests by status code', () => {
      bucket.record('/api/test', 200, false);
      bucket.record('/api/test', 200, false);
      bucket.record('/api/test', 500, true);

      const json = bucket.toJSON();
      expect(json.byStatusCode['200']).toBe(2);
      expect(json.byStatusCode['500']).toBe(1);
    });

    it('should track errors', () => {
      bucket.record('/api/test', 200, false);
      bucket.record('/api/test', 500, true);
      bucket.record('/api/test', 404, true);

      expect(bucket.errors).toBe(2);
    });
  });

  describe('toJSON', () => {
    it('should calculate error rate', () => {
      bucket.record('/api/test', 200, false);
      bucket.record('/api/test', 500, true);

      const json = bucket.toJSON();
      expect(json.errorRate).toBeCloseTo(0.5, 2);
    });
  });
});

describe('HistoryStorage', () => {
  let storage;

  beforeEach(() => {
    storage = new HistoryStorage(10);
  });

  describe('addSnapshot', () => {
    it('should add snapshots', () => {
      storage.addSnapshot({ value: 1 });
      storage.addSnapshot({ value: 2 });

      const summary = storage.getSummary();
      expect(summary.count).toBe(2);
    });

    it('should trim old snapshots when max exceeded', () => {
      // Add 15 snapshots to a storage with max 10
      for (let i = 0; i < 15; i++) {
        storage.addSnapshot({ value: i });
      }

      const summary = storage.getSummary();
      expect(summary.count).toBe(10);
    });

    it('should add timestamp to snapshots', () => {
      storage.addSnapshot({ value: 1 });

      const latest = storage.getLatest();
      expect(latest).toHaveProperty('timestamp');
      expect(typeof latest.timestamp).toBe('number');
    });
  });

  describe('getSnapshots', () => {
    it('should filter by time range', () => {
      const now = Date.now();

      // Add snapshots at different times
      storage.addSnapshot({ value: 1 });

      const snapshots = storage.getSnapshots(now - 1000, now + 1000);
      expect(snapshots.length).toBe(1);
    });

    it('should return empty array for out-of-range queries', () => {
      storage.addSnapshot({ value: 1 });

      const snapshots = storage.getSnapshots(0, 1000); // Very old range
      expect(snapshots.length).toBe(0);
    });
  });

  describe('getLatest', () => {
    it('should return null when empty', () => {
      const latest = storage.getLatest();
      expect(latest).toBeNull();
    });

    it('should return the most recent snapshot', () => {
      storage.addSnapshot({ value: 1 });
      storage.addSnapshot({ value: 2 });
      storage.addSnapshot({ value: 3 });

      const latest = storage.getLatest();
      expect(latest.value).toBe(3);
    });
  });

  describe('clear', () => {
    it('should remove all snapshots', () => {
      storage.addSnapshot({ value: 1 });
      storage.addSnapshot({ value: 2 });

      storage.clear();

      const summary = storage.getSummary();
      expect(summary.count).toBe(0);
    });
  });
});

describe('generateSparkline', () => {
  it('should generate sparkline from values', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sparkline = generateSparkline(values);

    expect(typeof sparkline).toBe('string');
    expect(sparkline.length).toBeGreaterThan(0);
  });

  it('should return empty string for empty values', () => {
    const sparkline = generateSparkline([]);
    expect(sparkline).toBe('');
  });

  it('should return empty string for null/undefined', () => {
    expect(generateSparkline(null)).toBe('');
    expect(generateSparkline(undefined)).toBe('');
  });

  it('should handle single value', () => {
    const sparkline = generateSparkline([5]);
    expect(sparkline.length).toBe(1);
  });

  it('should use unicode block characters', () => {
    const values = [0, 0.5, 1];
    const sparkline = generateSparkline(values);

    // Should contain sparkline characters
    expect(/[▁▂▃▄▅▆▇█ ]/.test(sparkline)).toBe(true);
  });

  it('should respect width parameter', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const sparkline = generateSparkline(values, 10);

    expect(sparkline.length).toBe(10);
  });
});

describe('throughputMiddleware', () => {
  it('should return a middleware function', () => {
    const middleware = throughputMiddleware();
    expect(typeof middleware).toBe('function');
  });

  it('should call next()', () => {
    const middleware = throughputMiddleware();
    const req = { path: '/api/test' };
    const res = {
      on: jest.fn(),
    };
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should register finish handler', () => {
    const middleware = throughputMiddleware();
    const req = { path: '/api/test' };
    const res = {
      on: jest.fn(),
    };
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });
});

describe('Singleton management', () => {
  afterEach(() => {
    resetPerformanceDashboardService();
  });

  it('should return same instance', () => {
    const instance1 = getPerformanceDashboardService();
    const instance2 = getPerformanceDashboardService();

    expect(instance1).toBe(instance2);
  });

  it('should reset singleton', () => {
    const instance1 = getPerformanceDashboardService();
    resetPerformanceDashboardService();
    const instance2 = getPerformanceDashboardService();

    expect(instance1).not.toBe(instance2);
  });
});

describe('Health calculation', () => {
  let service;

  beforeEach(() => {
    resetPerformanceDashboardService();
    service = new PerformanceDashboardService();
    service.initialize();
  });

  afterEach(() => {
    service.shutdown();
  });

  it('should detect healthy status when all components are healthy', () => {
    const health = service.getHealthStatus();

    expect(health.status).toBe(HEALTH_STATUS.HEALTHY);
    expect(health.issues).toHaveLength(0);
  });

  it('should detect issues with high error rate', () => {
    // Record many errors
    for (let i = 0; i < 100; i++) {
      service.recordRequest('/api/test', 500);
    }

    const health = service.getHealthStatus();

    // Should have error rate issue
    expect(health.issues.some(i => i.component === 'throughput')).toBe(true);
  });
});

describe('HEALTH_STATUS constants', () => {
  it('should have expected values', () => {
    expect(HEALTH_STATUS.HEALTHY).toBe('healthy');
    expect(HEALTH_STATUS.WARNING).toBe('warning');
    expect(HEALTH_STATUS.CRITICAL).toBe('critical');
    expect(HEALTH_STATUS.UNKNOWN).toBe('unknown');
  });
});

describe('CONFIG constants', () => {
  it('should have expected default values', () => {
    expect(CONFIG.THROUGHPUT_WINDOW_MS).toBe(60000);
    expect(CONFIG.THROUGHPUT_BUCKET_COUNT).toBe(60);
    expect(CONFIG.HISTORY_MAX_ENTRIES).toBe(360);
    expect(CONFIG.SPARKLINE_WIDTH).toBe(20);
  });
});
