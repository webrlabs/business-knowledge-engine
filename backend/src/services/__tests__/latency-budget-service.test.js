/**
 * Latency Budget Service Tests (F5.2.5)
 *
 * Tests for the latency budget tracking and SLO enforcement service.
 */

const {
  LatencyBudgetService,
  getLatencyBudgetService,
  recordLatency,
  withLatencyBudget,
  OPERATION_TYPES,
  SEVERITY,
} = require('../latency-budget-service');

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

// Mock the configuration service
jest.mock('../configuration-service', () => {
  const configValues = {
    LATENCY_BUDGET_ENABLED: true,
    LATENCY_BUDGET_ALERTS_ENABLED: true,
    LATENCY_BUDGET_QUERY_MS: 3000,
    LATENCY_BUDGET_PROCESSING_MS: 300000,
    LATENCY_BUDGET_GRAPH_TRAVERSAL_MS: 5000,
    LATENCY_BUDGET_ENTITY_RESOLUTION_MS: 2000,
    LATENCY_BUDGET_SEARCH_MS: 1500,
    LATENCY_BUDGET_OPENAI_MS: 30000,
    LATENCY_BUDGET_WARNING_THRESHOLD: 0.7,
    LATENCY_BUDGET_CRITICAL_THRESHOLD: 0.9,
    LATENCY_BUDGET_WINDOW_MS: 60000,
    LATENCY_BUDGET_BUCKET_COUNT: 60,
    LATENCY_BUDGET_RETENTION_BUCKETS: 1440,
  };

  const listeners = new Map();

  return {
    getConfigurationService: jest.fn(() => ({
      get: jest.fn((key) => configValues[key]),
      onChange: jest.fn((key, callback) => {
        if (!listeners.has(key)) {
          listeners.set(key, new Set());
        }
        listeners.get(key).add(callback);
        return () => listeners.get(key)?.delete(callback);
      }),
    })),
    CONFIG_CATEGORIES: {
      LATENCY_BUDGET: 'latency_budget',
    },
  };
});

const { trackEvent, trackMetric } = require('../../utils/telemetry');
const { log } = require('../../utils/logger');

describe('LatencyBudgetService', () => {
  let service;

  beforeEach(() => {
    // Create a fresh instance for each test
    service = new LatencyBudgetService();
    service.initialize();
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.reset();
  });

  describe('initialization', () => {
    it('should initialize with default operation types', () => {
      expect(service._initialized).toBe(true);
      expect(service._metrics.size).toBe(Object.keys(OPERATION_TYPES).length);
    });

    it('should not reinitialize if already initialized', () => {
      const initialTime = service._initializationTime;
      service.initialize();
      expect(service._initializationTime).toBe(initialTime);
    });

    it('should set correct budgets from config', () => {
      const queryMetrics = service._metrics.get('query');
      expect(queryMetrics.budgetMs).toBe(3000);

      const processingMetrics = service._metrics.get('processing');
      expect(processingMetrics.budgetMs).toBe(300000);
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled in config', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('getBudget', () => {
    it('should return the correct budget for known operations', () => {
      expect(service.getBudget('query')).toBe(3000);
      expect(service.getBudget('processing')).toBe(300000);
      expect(service.getBudget('search')).toBe(1500);
    });

    it('should return null for unknown operations', () => {
      expect(service.getBudget('unknown_operation')).toBeNull();
    });
  });

  describe('recordLatency', () => {
    it('should record latency and return result', () => {
      const result = service.recordLatency('query', 1000);

      expect(result.tracked).toBe(true);
      expect(result.latencyMs).toBe(1000);
      expect(result.budgetMs).toBe(3000);
      expect(result.isBreach).toBe(false);
      expect(result.severity).toBe(SEVERITY.NONE);
    });

    it('should detect warning severity', () => {
      // 70% of 3000ms = 2100ms
      const result = service.recordLatency('query', 2200);

      expect(result.severity).toBe(SEVERITY.WARNING);
      expect(result.isBreach).toBe(false);
    });

    it('should detect critical severity', () => {
      // 90% of 3000ms = 2700ms
      const result = service.recordLatency('query', 2800);

      expect(result.severity).toBe(SEVERITY.CRITICAL);
      expect(result.isBreach).toBe(false);
    });

    it('should detect breach severity', () => {
      const result = service.recordLatency('query', 3500);

      expect(result.severity).toBe(SEVERITY.BREACH);
      expect(result.isBreach).toBe(true);
    });

    it('should track metric for each measurement', () => {
      service.recordLatency('query', 1000, { userId: 'test-user' });

      expect(trackMetric).toHaveBeenCalledWith(
        'latency.query',
        1000,
        expect.objectContaining({
          operation: 'query',
          budgetMs: 3000,
          severity: 'none',
          userId: 'test-user',
        })
      );
    });

    it('should emit telemetry event on breach', () => {
      service.recordLatency('query', 4000);

      expect(trackEvent).toHaveBeenCalledWith(
        'LatencyBudgetBreach',
        expect.objectContaining({
          operation: 'query',
          latencyMs: 4000,
          budgetMs: 3000,
          severity: 'breach',
        })
      );
    });

    it('should log warning on warning severity', () => {
      service.recordLatency('query', 2200);

      expect(log.warn).toHaveBeenCalledWith(
        'Latency budget WARNING for query',
        expect.any(Object)
      );
    });

    it('should log error on breach severity', () => {
      service.recordLatency('query', 4000);

      expect(log.error).toHaveBeenCalledWith(
        'Latency budget BREACH for query',
        expect.any(Object)
      );
    });

    it('should create dynamic metrics for unknown operations', () => {
      const result = service.recordLatency('custom_operation', 1000);

      expect(result.tracked).toBe(true);
      expect(service._metrics.has('custom_operation')).toBe(true);
    });
  });

  describe('percentile calculations', () => {
    it('should calculate percentiles correctly', () => {
      // Record 100 measurements with known distribution
      for (let i = 1; i <= 100; i++) {
        service.recordLatency('query', i * 10);
      }

      const metrics = service.getOperationMetrics('query');

      // P50 should be around 500 (50th value)
      expect(metrics.percentiles.p50).toBe(500);
      // P95 should be around 950 (95th value)
      expect(metrics.percentiles.p95).toBe(950);
      // P99 should be around 990 (99th value)
      expect(metrics.percentiles.p99).toBe(990);
    });

    it('should return 0 for empty metrics', () => {
      const metrics = service.getOperationMetrics('query');

      expect(metrics.percentiles.p50).toBe(0);
      expect(metrics.percentiles.p95).toBe(0);
      expect(metrics.percentiles.p99).toBe(0);
    });
  });

  describe('getOperationMetrics', () => {
    it('should return correct metrics for an operation', () => {
      service.recordLatency('query', 1000);
      service.recordLatency('query', 2000);
      service.recordLatency('query', 4000); // breach

      const metrics = service.getOperationMetrics('query');

      expect(metrics.operation).toBe('query');
      expect(metrics.budgetMs).toBe(3000);
      expect(metrics.totalCount).toBe(3);
      expect(metrics.totalBreaches).toBe(1);
    });

    it('should return null for unknown operation', () => {
      const metrics = service.getOperationMetrics('nonexistent');
      expect(metrics).toBeNull();
    });
  });

  describe('getOperationStatus', () => {
    it('should return healthy status when P95 is within budget', () => {
      service.recordLatency('query', 1000);
      service.recordLatency('query', 1500);
      service.recordLatency('query', 2000);

      const status = service.getOperationStatus('query');

      expect(status.healthy).toBe(true);
      expect(status.operation).toBe('query');
    });

    it('should return unhealthy status when P95 exceeds budget', () => {
      // Record mostly high latencies
      for (let i = 0; i < 10; i++) {
        service.recordLatency('query', 4000); // breaches
      }

      const status = service.getOperationStatus('query');

      expect(status.healthy).toBe(false);
      expect(status.severity).toBe(SEVERITY.BREACH);
    });

    it('should return null for unknown operation', () => {
      expect(service.getOperationStatus('nonexistent')).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('should return overall service status', () => {
      service.recordLatency('query', 1000);
      service.recordLatency('search', 500);

      const status = service.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.healthy).toBe(true);
      expect(status.operations).toBeDefined();
      expect(status.summary.total).toBe(6); // All operation types
    });

    it('should reflect unhealthy operations in summary', () => {
      // Make one operation unhealthy
      for (let i = 0; i < 10; i++) {
        service.recordLatency('query', 4000);
      }

      const status = service.getStatus();

      expect(status.summary.unhealthy).toBeGreaterThan(0);
    });
  });

  describe('getAggregatedStats', () => {
    it('should return stats for all operations', () => {
      service.recordLatency('query', 1000);
      service.recordLatency('search', 500);
      service.recordLatency('query', 4000);

      const stats = service.getAggregatedStats();

      expect(stats.operations.query).toBeDefined();
      expect(stats.operations.search).toBeDefined();
      expect(stats.totals.measurements).toBe(3);
      expect(stats.totals.breaches).toBe(1);
    });
  });

  describe('getHealthSummary', () => {
    it('should return simplified health summary', () => {
      service.recordLatency('query', 1000);

      const health = service.getHealthSummary();

      expect(health.status).toBe('healthy');
      expect(health.enabledOperations).toBe(6);
      expect(health.details.query).toBeDefined();
      expect(health.details.query.utilization).toBeDefined();
    });

    it('should show degraded status when unhealthy', () => {
      for (let i = 0; i < 10; i++) {
        service.recordLatency('query', 4000);
      }

      const health = service.getHealthSummary();

      expect(health.status).toBe('degraded');
      expect(health.unhealthyOperations).toBeGreaterThan(0);
    });
  });

  describe('resetOperation', () => {
    it('should reset metrics for a specific operation', () => {
      service.recordLatency('query', 1000);
      expect(service.getOperationMetrics('query').totalCount).toBe(1);

      service.resetOperation('query');

      expect(service.getOperationMetrics('query').totalCount).toBe(0);
    });

    it('should return false for unknown operation', () => {
      expect(service.resetOperation('nonexistent')).toBe(false);
    });
  });

  describe('resetAll', () => {
    it('should reset metrics for all operations', () => {
      service.recordLatency('query', 1000);
      service.recordLatency('search', 500);

      service.resetAll();

      expect(service.getOperationMetrics('query').totalCount).toBe(0);
      expect(service.getOperationMetrics('search').totalCount).toBe(0);
    });
  });

  describe('listeners', () => {
    it('should notify listeners on latency recorded', () => {
      const listener = jest.fn();
      service.onLatencyRecorded('query', listener);

      service.recordLatency('query', 1000);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'query',
          latencyMs: 1000,
        })
      );
    });

    it('should notify wildcard listeners for all operations', () => {
      const listener = jest.fn();
      service.onAnyLatencyRecorded(listener);

      service.recordLatency('query', 1000);
      service.recordLatency('search', 500);

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should allow unsubscribing', () => {
      const listener = jest.fn();
      const unsubscribe = service.onLatencyRecorded('query', listener);

      service.recordLatency('query', 1000);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      service.recordLatency('query', 2000);
      expect(listener).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('withBudget wrapper', () => {
    it('should wrap async functions and track latency', async () => {
      const asyncFn = jest.fn().mockResolvedValue('result');
      const wrapped = service.withBudget('query', asyncFn);

      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe('result');
      expect(asyncFn).toHaveBeenCalledWith('arg1', 'arg2');
      expect(service.getOperationMetrics('query').totalCount).toBe(1);
    });

    it('should track failed async functions', async () => {
      const error = new Error('Test error');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const wrapped = service.withBudget('query', asyncFn);

      await expect(wrapped()).rejects.toThrow('Test error');
      expect(service.getOperationMetrics('query').totalCount).toBe(1);
    });
  });

  describe('withBudgetSync wrapper', () => {
    it('should wrap sync functions and track latency', () => {
      const syncFn = jest.fn().mockReturnValue('result');
      const wrapped = service.withBudgetSync('query', syncFn);

      const result = wrapped('arg1');

      expect(result).toBe('result');
      expect(syncFn).toHaveBeenCalledWith('arg1');
      expect(service.getOperationMetrics('query').totalCount).toBe(1);
    });

    it('should track failed sync functions', () => {
      const error = new Error('Test error');
      const syncFn = jest.fn().mockImplementation(() => {
        throw error;
      });
      const wrapped = service.withBudgetSync('query', syncFn);

      expect(() => wrapped()).toThrow('Test error');
      expect(service.getOperationMetrics('query').totalCount).toBe(1);
    });
  });

  describe('getOperationTypes', () => {
    it('should return all operation types', () => {
      const types = service.getOperationTypes();

      expect(types).toContain('query');
      expect(types).toContain('processing');
      expect(types).toContain('search');
      expect(types.length).toBe(6);
    });
  });

  describe('isValidOperation', () => {
    it('should return true for known operations', () => {
      expect(service.isValidOperation('query')).toBe(true);
      expect(service.isValidOperation('processing')).toBe(true);
    });

    it('should return true for dynamically created operations', () => {
      service.recordLatency('custom_op', 1000);
      expect(service.isValidOperation('custom_op')).toBe(true);
    });

    it('should return false for unknown operations', () => {
      expect(service.isValidOperation('unknown_xyz')).toBe(false);
    });
  });

  describe('breach rate calculation', () => {
    it('should calculate breach rate correctly', () => {
      service.recordLatency('query', 1000); // ok
      service.recordLatency('query', 2000); // ok
      service.recordLatency('query', 4000); // breach
      service.recordLatency('query', 5000); // breach

      const metrics = service.getOperationMetrics('query');

      expect(metrics.breachRate).toBe(0.5); // 2/4 = 50%
    });

    it('should return 0 for empty metrics', () => {
      const metrics = service.getOperationMetrics('query');
      expect(metrics.breachRate).toBe(0);
    });
  });
});

describe('Module exports', () => {
  it('should export getLatencyBudgetService singleton', () => {
    const service1 = getLatencyBudgetService();
    const service2 = getLatencyBudgetService();
    expect(service1).toBe(service2);
  });

  it('should export recordLatency convenience function', () => {
    expect(typeof recordLatency).toBe('function');
  });

  it('should export withLatencyBudget convenience function', () => {
    expect(typeof withLatencyBudget).toBe('function');
  });

  it('should export OPERATION_TYPES constant', () => {
    expect(OPERATION_TYPES.QUERY).toBe('query');
    expect(OPERATION_TYPES.PROCESSING).toBe('processing');
  });

  it('should export SEVERITY constant', () => {
    expect(SEVERITY.NONE).toBe('none');
    expect(SEVERITY.WARNING).toBe('warning');
    expect(SEVERITY.CRITICAL).toBe('critical');
    expect(SEVERITY.BREACH).toBe('breach');
  });
});

describe('TimeBucket behavior', () => {
  let service;

  beforeEach(() => {
    service = new LatencyBudgetService();
    service.initialize();
  });

  afterEach(() => {
    service.reset();
  });

  it('should aggregate measurements in buckets', () => {
    // Record multiple measurements
    service.recordLatency('query', 100);
    service.recordLatency('query', 200);
    service.recordLatency('query', 300);

    const metrics = service.getOperationMetrics('query');

    expect(metrics.percentiles.min).toBe(100);
    expect(metrics.percentiles.max).toBe(300);
    expect(metrics.percentiles.avg).toBe(200);
  });

  it('should track min and max correctly', () => {
    service.recordLatency('query', 500);
    service.recordLatency('query', 100);
    service.recordLatency('query', 1000);
    service.recordLatency('query', 200);

    const metrics = service.getOperationMetrics('query');

    expect(metrics.percentiles.min).toBe(100);
    expect(metrics.percentiles.max).toBe(1000);
  });
});

describe('Edge cases', () => {
  let service;

  beforeEach(() => {
    service = new LatencyBudgetService();
    service.initialize();
  });

  afterEach(() => {
    service.reset();
  });

  it('should handle zero latency', () => {
    const result = service.recordLatency('query', 0);

    expect(result.tracked).toBe(true);
    expect(result.latencyMs).toBe(0);
    expect(result.severity).toBe(SEVERITY.NONE);
  });

  it('should handle very large latency values', () => {
    const result = service.recordLatency('query', 1000000); // 1000 seconds

    expect(result.tracked).toBe(true);
    expect(result.isBreach).toBe(true);
  });

  it('should handle listener errors gracefully', () => {
    const badListener = jest.fn().mockImplementation(() => {
      throw new Error('Listener error');
    });

    service.onLatencyRecorded('query', badListener);

    // Should not throw
    expect(() => {
      service.recordLatency('query', 1000);
    }).not.toThrow();

    expect(badListener).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('should handle context with special characters', () => {
    const result = service.recordLatency('query', 1000, {
      path: '/api/test?query=hello&foo=bar',
      message: 'Test with "quotes" and \'apostrophes\'',
    });

    expect(result.tracked).toBe(true);
  });
});
