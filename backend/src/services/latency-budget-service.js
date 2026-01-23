/**
 * Latency Budget Service (F5.2.5)
 *
 * Defines and enforces latency SLOs for different operation types.
 * Tracks latency metrics with time-bucketed rolling windows for
 * percentile calculations and trend analysis.
 *
 * Features:
 * - Operation-specific latency budgets (query <3s, processing <5min)
 * - Percentile tracking (P50, P95, P99) via bucketed time series
 * - Warning and critical alerts when SLOs are breached
 * - Telemetry integration for monitoring
 * - API endpoints for metrics exposure
 *
 * Usage:
 *   const { getLatencyBudgetService } = require('./services/latency-budget-service');
 *   const budgetService = getLatencyBudgetService();
 *
 *   // Record a latency measurement
 *   budgetService.recordLatency('query', 1500);
 *
 *   // Check if budget is healthy
 *   const status = budgetService.getOperationStatus('query');
 *
 *   // Get overall health
 *   const health = budgetService.getStatus();
 *
 * @module services/latency-budget-service
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');
const { getConfigurationService } = require('./configuration-service');

/**
 * Operation types with their corresponding config keys
 */
const OPERATION_TYPES = {
  QUERY: 'query',
  PROCESSING: 'processing',
  GRAPH_TRAVERSAL: 'graph_traversal',
  ENTITY_RESOLUTION: 'entity_resolution',
  SEARCH: 'search',
  OPENAI: 'openai',
};

/**
 * Config key mapping for operation budgets
 */
const OPERATION_CONFIG_MAP = {
  [OPERATION_TYPES.QUERY]: 'LATENCY_BUDGET_QUERY_MS',
  [OPERATION_TYPES.PROCESSING]: 'LATENCY_BUDGET_PROCESSING_MS',
  [OPERATION_TYPES.GRAPH_TRAVERSAL]: 'LATENCY_BUDGET_GRAPH_TRAVERSAL_MS',
  [OPERATION_TYPES.ENTITY_RESOLUTION]: 'LATENCY_BUDGET_ENTITY_RESOLUTION_MS',
  [OPERATION_TYPES.SEARCH]: 'LATENCY_BUDGET_SEARCH_MS',
  [OPERATION_TYPES.OPENAI]: 'LATENCY_BUDGET_OPENAI_MS',
};

/**
 * Severity levels for budget breaches
 */
const SEVERITY = {
  NONE: 'none',
  WARNING: 'warning',
  CRITICAL: 'critical',
  BREACH: 'breach',
};

/**
 * Time bucket for latency data
 */
class TimeBucket {
  constructor(timestamp) {
    this.timestamp = timestamp;
    this.measurements = [];
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  add(latencyMs) {
    this.measurements.push(latencyMs);
    this.count++;
    this.sum += latencyMs;
    if (latencyMs < this.min) this.min = latencyMs;
    if (latencyMs > this.max) this.max = latencyMs;
  }

  getAverage() {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  toJSON() {
    return {
      timestamp: this.timestamp,
      count: this.count,
      sum: this.sum,
      min: this.min === Infinity ? 0 : this.min,
      max: this.max === -Infinity ? 0 : this.max,
      avg: this.getAverage(),
    };
  }
}

/**
 * Operation metrics tracker with rolling window
 */
class OperationMetrics {
  constructor(operation, budgetMs, windowMs, bucketCount, retentionBuckets) {
    this.operation = operation;
    this.budgetMs = budgetMs;
    this.windowMs = windowMs;
    this.bucketCount = bucketCount;
    this.bucketDurationMs = Math.floor(windowMs / bucketCount);
    this.retentionBuckets = retentionBuckets;

    // Rolling window of buckets
    this.buckets = [];
    this.currentBucket = null;

    // Aggregate statistics
    this.totalCount = 0;
    this.totalBreaches = 0;
    this.lastBreachTime = null;
    this.breachesInWindow = 0;

    // Cached percentiles (recalculated on bucket rotation)
    this._cachedPercentiles = null;
    this._percentileCacheTime = 0;
  }

  /**
   * Get or create current bucket
   */
  getCurrentBucket() {
    const now = Date.now();
    const bucketTimestamp = Math.floor(now / this.bucketDurationMs) * this.bucketDurationMs;

    if (!this.currentBucket || this.currentBucket.timestamp !== bucketTimestamp) {
      // Rotate buckets
      if (this.currentBucket) {
        this.buckets.push(this.currentBucket);

        // Trim old buckets beyond retention
        while (this.buckets.length > this.retentionBuckets) {
          this.buckets.shift();
        }

        // Invalidate percentile cache
        this._cachedPercentiles = null;
      }

      this.currentBucket = new TimeBucket(bucketTimestamp);
    }

    return this.currentBucket;
  }

  /**
   * Record a latency measurement
   */
  record(latencyMs, isBreach) {
    const bucket = this.getCurrentBucket();
    bucket.add(latencyMs);

    this.totalCount++;
    if (isBreach) {
      this.totalBreaches++;
      this.lastBreachTime = Date.now();
    }
  }

  /**
   * Get measurements within the active window
   */
  getMeasurementsInWindow() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const measurements = [];

    // Add measurements from historical buckets
    for (const bucket of this.buckets) {
      if (bucket.timestamp >= windowStart) {
        measurements.push(...bucket.measurements);
      }
    }

    // Add current bucket
    if (this.currentBucket) {
      measurements.push(...this.currentBucket.measurements);
    }

    return measurements;
  }

  /**
   * Calculate percentile from sorted array
   */
  _calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * Get percentiles (P50, P95, P99)
   */
  getPercentiles() {
    const now = Date.now();
    const cacheValidMs = 1000; // Cache for 1 second

    if (this._cachedPercentiles && now - this._percentileCacheTime < cacheValidMs) {
      return this._cachedPercentiles;
    }

    const measurements = this.getMeasurementsInWindow();
    if (measurements.length === 0) {
      this._cachedPercentiles = { p50: 0, p95: 0, p99: 0, count: 0 };
      this._percentileCacheTime = now;
      return this._cachedPercentiles;
    }

    // Sort for percentile calculation
    const sorted = [...measurements].sort((a, b) => a - b);

    this._cachedPercentiles = {
      p50: this._calculatePercentile(sorted, 50),
      p95: this._calculatePercentile(sorted, 95),
      p99: this._calculatePercentile(sorted, 99),
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    };
    this._percentileCacheTime = now;

    return this._cachedPercentiles;
  }

  /**
   * Count breaches in the current window
   */
  getBreachesInWindow() {
    const measurements = this.getMeasurementsInWindow();
    return measurements.filter((m) => m > this.budgetMs).length;
  }

  /**
   * Get breach rate in current window
   */
  getBreachRate() {
    const measurements = this.getMeasurementsInWindow();
    if (measurements.length === 0) return 0;
    const breaches = measurements.filter((m) => m > this.budgetMs).length;
    return breaches / measurements.length;
  }

  /**
   * Get summary statistics
   */
  getStats() {
    const percentiles = this.getPercentiles();
    const breachRate = this.getBreachRate();

    return {
      operation: this.operation,
      budgetMs: this.budgetMs,
      windowMs: this.windowMs,
      percentiles,
      breachRate,
      breachCount: this.getBreachesInWindow(),
      totalCount: this.totalCount,
      totalBreaches: this.totalBreaches,
      lastBreachTime: this.lastBreachTime,
      bucketCount: this.buckets.length + (this.currentBucket ? 1 : 0),
    };
  }

  /**
   * Reset statistics
   */
  reset() {
    this.buckets = [];
    this.currentBucket = null;
    this.totalCount = 0;
    this.totalBreaches = 0;
    this.lastBreachTime = null;
    this.breachesInWindow = 0;
    this._cachedPercentiles = null;
    this._percentileCacheTime = 0;
  }

  /**
   * Update budget (when config changes)
   */
  updateBudget(newBudgetMs) {
    this.budgetMs = newBudgetMs;
  }
}

/**
 * Latency Budget Service
 */
class LatencyBudgetService {
  constructor() {
    this._metrics = new Map();
    this._config = null;
    this._initialized = false;
    this._initializationTime = null;
    this._listeners = new Map();
  }

  /**
   * Initialize the service
   */
  initialize() {
    if (this._initialized) {
      return;
    }

    this._config = getConfigurationService();

    // Initialize metrics for each operation type
    const windowMs = this._config.get('LATENCY_BUDGET_WINDOW_MS');
    const bucketCount = this._config.get('LATENCY_BUDGET_BUCKET_COUNT');
    const retentionBuckets = this._config.get('LATENCY_BUDGET_RETENTION_BUCKETS');

    for (const [operation, configKey] of Object.entries(OPERATION_CONFIG_MAP)) {
      const budgetMs = this._config.get(configKey);
      this._metrics.set(
        operation,
        new OperationMetrics(operation, budgetMs, windowMs, bucketCount, retentionBuckets)
      );
    }

    // Subscribe to config changes
    this._setupConfigListeners();

    this._initialized = true;
    this._initializationTime = new Date().toISOString();

    log.info('Latency budget service initialized', {
      operations: Object.keys(OPERATION_TYPES).length,
      windowMs,
      bucketCount,
      retentionBuckets,
    });
  }

  /**
   * Setup configuration change listeners
   */
  _setupConfigListeners() {
    // Listen for budget changes
    for (const [operation, configKey] of Object.entries(OPERATION_CONFIG_MAP)) {
      this._config.onChange(configKey, (newValue) => {
        const metrics = this._metrics.get(operation);
        if (metrics) {
          metrics.updateBudget(newValue);
          log.info(`Latency budget updated for ${operation}`, { newBudgetMs: newValue });
        }
      });
    }
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    this._ensureInitialized();
    return this._config.get('LATENCY_BUDGET_ENABLED');
  }

  /**
   * Check if alerts are enabled
   */
  areAlertsEnabled() {
    this._ensureInitialized();
    return this._config.get('LATENCY_BUDGET_ALERTS_ENABLED');
  }

  /**
   * Get budget for an operation
   */
  getBudget(operation) {
    this._ensureInitialized();
    const configKey = OPERATION_CONFIG_MAP[operation];
    if (!configKey) {
      log.warn(`Unknown operation type: ${operation}`);
      return null;
    }
    return this._config.get(configKey);
  }

  /**
   * Determine severity based on latency vs budget
   */
  _determineSeverity(latencyMs, budgetMs) {
    const warningThreshold = this._config.get('LATENCY_BUDGET_WARNING_THRESHOLD');
    const criticalThreshold = this._config.get('LATENCY_BUDGET_CRITICAL_THRESHOLD');

    const ratio = latencyMs / budgetMs;

    if (ratio > 1.0) {
      return SEVERITY.BREACH;
    } else if (ratio >= criticalThreshold) {
      return SEVERITY.CRITICAL;
    } else if (ratio >= warningThreshold) {
      return SEVERITY.WARNING;
    }
    return SEVERITY.NONE;
  }

  /**
   * Record a latency measurement
   * @param {string} operation - Operation type (query, processing, etc.)
   * @param {number} latencyMs - Measured latency in milliseconds
   * @param {Object} context - Optional context for telemetry
   * @returns {Object} - { severity, budgetMs, latencyMs, ratio, isBreach }
   */
  recordLatency(operation, latencyMs, context = {}) {
    this._ensureInitialized();

    if (!this.isEnabled()) {
      return { severity: SEVERITY.NONE, tracked: false };
    }

    const metrics = this._metrics.get(operation);
    if (!metrics) {
      // Create dynamic metrics for unknown operations with default budget
      const defaultBudget = this._config.get('LATENCY_BUDGET_QUERY_MS');
      const windowMs = this._config.get('LATENCY_BUDGET_WINDOW_MS');
      const bucketCount = this._config.get('LATENCY_BUDGET_BUCKET_COUNT');
      const retentionBuckets = this._config.get('LATENCY_BUDGET_RETENTION_BUCKETS');

      this._metrics.set(
        operation,
        new OperationMetrics(operation, defaultBudget, windowMs, bucketCount, retentionBuckets)
      );
      log.debug(`Created dynamic latency metrics for operation: ${operation}`);
    }

    const opMetrics = this._metrics.get(operation);
    const budgetMs = opMetrics.budgetMs;
    const severity = this._determineSeverity(latencyMs, budgetMs);
    const isBreach = severity === SEVERITY.BREACH;
    const ratio = latencyMs / budgetMs;

    // Record measurement
    opMetrics.record(latencyMs, isBreach);

    // Track metric
    trackMetric(`latency.${operation}`, latencyMs, {
      operation,
      budgetMs,
      severity,
      ...context,
    });

    // Emit alerts for warnings and breaches
    if (this.areAlertsEnabled() && severity !== SEVERITY.NONE) {
      this._emitAlert(operation, latencyMs, budgetMs, severity, context);
    }

    // Notify listeners
    this._notifyListeners(operation, {
      operation,
      latencyMs,
      budgetMs,
      severity,
      ratio,
      isBreach,
      context,
    });

    return {
      severity,
      budgetMs,
      latencyMs,
      ratio,
      isBreach,
      tracked: true,
    };
  }

  /**
   * Emit alert for budget warning/breach
   */
  _emitAlert(operation, latencyMs, budgetMs, severity, context) {
    const alertData = {
      operation,
      latencyMs,
      budgetMs,
      severity,
      ratio: latencyMs / budgetMs,
      timestamp: new Date().toISOString(),
      ...context,
    };

    if (severity === SEVERITY.BREACH) {
      log.error(`Latency budget BREACH for ${operation}`, alertData);
      trackEvent('LatencyBudgetBreach', alertData);
    } else if (severity === SEVERITY.CRITICAL) {
      log.warn(`Latency budget CRITICAL for ${operation}`, alertData);
      trackEvent('LatencyBudgetCritical', alertData);
    } else if (severity === SEVERITY.WARNING) {
      log.warn(`Latency budget WARNING for ${operation}`, alertData);
      trackEvent('LatencyBudgetWarning', alertData);
    }
  }

  /**
   * Get metrics for a specific operation
   */
  getOperationMetrics(operation) {
    this._ensureInitialized();

    const metrics = this._metrics.get(operation);
    if (!metrics) {
      return null;
    }

    return metrics.getStats();
  }

  /**
   * Get status for a specific operation
   */
  getOperationStatus(operation) {
    this._ensureInitialized();

    const metrics = this._metrics.get(operation);
    if (!metrics) {
      return null;
    }

    const stats = metrics.getStats();
    const p95 = stats.percentiles.p95;
    const severity = this._determineSeverity(p95, stats.budgetMs);

    return {
      operation,
      healthy: severity === SEVERITY.NONE,
      severity,
      p95,
      budgetMs: stats.budgetMs,
      breachRate: stats.breachRate,
      sampleCount: stats.percentiles.count,
    };
  }

  /**
   * Get overall service status
   */
  getStatus() {
    this._ensureInitialized();

    const enabled = this.isEnabled();
    const operations = {};
    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const [operation] of this._metrics) {
      const status = this.getOperationStatus(operation);
      operations[operation] = status;

      if (status.healthy) {
        healthyCount++;
      } else {
        unhealthyCount++;
      }
    }

    const overallHealthy = unhealthyCount === 0;

    return {
      enabled,
      healthy: overallHealthy,
      operations,
      summary: {
        total: this._metrics.size,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
      },
      initializationTime: this._initializationTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get aggregated statistics for all operations
   */
  getAggregatedStats() {
    this._ensureInitialized();

    const stats = {};
    let totalMeasurements = 0;
    let totalBreaches = 0;

    for (const [operation, metrics] of this._metrics) {
      const opStats = metrics.getStats();
      stats[operation] = opStats;
      totalMeasurements += opStats.totalCount;
      totalBreaches += opStats.totalBreaches;
    }

    return {
      operations: stats,
      totals: {
        measurements: totalMeasurements,
        breaches: totalBreaches,
        breachRate: totalMeasurements > 0 ? totalBreaches / totalMeasurements : 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reset statistics for an operation
   */
  resetOperation(operation) {
    this._ensureInitialized();

    const metrics = this._metrics.get(operation);
    if (metrics) {
      metrics.reset();
      log.info(`Latency budget metrics reset for ${operation}`);
      return true;
    }
    return false;
  }

  /**
   * Reset all statistics
   */
  resetAll() {
    this._ensureInitialized();

    for (const [operation, metrics] of this._metrics) {
      metrics.reset();
    }
    log.info('All latency budget metrics reset');
  }

  /**
   * Get health summary for dashboard
   */
  getHealthSummary() {
    this._ensureInitialized();

    const status = this.getStatus();
    const summary = {
      status: status.healthy ? 'healthy' : 'degraded',
      enabledOperations: status.summary.total,
      healthyOperations: status.summary.healthy,
      unhealthyOperations: status.summary.unhealthy,
      details: {},
    };

    for (const [operation, opStatus] of Object.entries(status.operations)) {
      summary.details[operation] = {
        status: opStatus.healthy ? 'ok' : opStatus.severity,
        p95: opStatus.p95,
        budgetMs: opStatus.budgetMs,
        utilization: Math.round((opStatus.p95 / opStatus.budgetMs) * 100),
      };
    }

    return summary;
  }

  /**
   * Register a listener for latency events
   */
  onLatencyRecorded(operation, callback) {
    if (!this._listeners.has(operation)) {
      this._listeners.set(operation, new Set());
    }
    this._listeners.get(operation).add(callback);

    return () => {
      const listeners = this._listeners.get(operation);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * Register a listener for all operations
   */
  onAnyLatencyRecorded(callback) {
    return this.onLatencyRecorded('*', callback);
  }

  /**
   * Notify listeners
   */
  _notifyListeners(operation, data) {
    // Notify operation-specific listeners
    const opListeners = this._listeners.get(operation);
    if (opListeners) {
      for (const callback of opListeners) {
        try {
          callback(data);
        } catch (error) {
          log.error(`Error in latency listener for ${operation}:`, error);
        }
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this._listeners.get('*');
    if (wildcardListeners) {
      for (const callback of wildcardListeners) {
        try {
          callback(data);
        } catch (error) {
          log.error('Error in wildcard latency listener:', error);
        }
      }
    }
  }

  /**
   * Create a timing wrapper for async functions
   */
  withBudget(operation, asyncFn) {
    return async (...args) => {
      const startTime = Date.now();
      try {
        const result = await asyncFn(...args);
        const latencyMs = Date.now() - startTime;
        this.recordLatency(operation, latencyMs, { success: true });
        return result;
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        this.recordLatency(operation, latencyMs, { success: false, error: error.message });
        throw error;
      }
    };
  }

  /**
   * Create a timing wrapper for sync functions
   */
  withBudgetSync(operation, fn) {
    return (...args) => {
      const startTime = Date.now();
      try {
        const result = fn(...args);
        const latencyMs = Date.now() - startTime;
        this.recordLatency(operation, latencyMs, { success: true });
        return result;
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        this.recordLatency(operation, latencyMs, { success: false, error: error.message });
        throw error;
      }
    };
  }

  /**
   * Ensure service is initialized
   */
  _ensureInitialized() {
    if (!this._initialized) {
      this.initialize();
    }
  }

  /**
   * Get list of operation types
   */
  getOperationTypes() {
    return Object.values(OPERATION_TYPES);
  }

  /**
   * Check if an operation type is valid
   */
  isValidOperation(operation) {
    return Object.values(OPERATION_TYPES).includes(operation) || this._metrics.has(operation);
  }

  /**
   * Reset service (for testing)
   */
  reset() {
    this._metrics.clear();
    this._listeners.clear();
    this._initialized = false;
    this._initializationTime = null;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the latency budget service instance
 */
function getLatencyBudgetService() {
  if (!instance) {
    instance = new LatencyBudgetService();
    instance.initialize();
  }
  return instance;
}

/**
 * Convenience function to record latency
 */
function recordLatency(operation, latencyMs, context = {}) {
  return getLatencyBudgetService().recordLatency(operation, latencyMs, context);
}

/**
 * Convenience function to wrap async functions with latency tracking
 */
function withLatencyBudget(operation, asyncFn) {
  return getLatencyBudgetService().withBudget(operation, asyncFn);
}

module.exports = {
  LatencyBudgetService,
  getLatencyBudgetService,
  recordLatency,
  withLatencyBudget,
  OPERATION_TYPES,
  SEVERITY,
};
