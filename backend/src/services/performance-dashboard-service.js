/**
 * Performance Dashboard Service (F5.2.7)
 *
 * Real-time latency and throughput monitoring aggregating metrics from:
 * - Latency Budget Service (operation latencies, SLO compliance)
 * - Circuit Breaker Service (service health, failure rates)
 * - Entity Resolution Cache (cache hit rates, utilization)
 * - User Rate Limit Service (rate limit stats)
 *
 * Features:
 * - Aggregated system health score
 * - Request throughput tracking with rolling windows
 * - Historical metric snapshots
 * - ASCII sparkline trend visualization
 * - Configurable refresh intervals
 * - Alert thresholds for degraded performance
 *
 * @module services/performance-dashboard-service
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');

// Configuration
const CONFIG = {
  // Throughput tracking
  THROUGHPUT_WINDOW_MS: parseInt(process.env.PERF_THROUGHPUT_WINDOW_MS, 10) || 60000, // 1 minute
  THROUGHPUT_BUCKET_COUNT: parseInt(process.env.PERF_THROUGHPUT_BUCKETS, 10) || 60, // 60 buckets = 1 second each

  // History retention
  HISTORY_MAX_ENTRIES: parseInt(process.env.PERF_HISTORY_MAX_ENTRIES, 10) || 360, // 6 hours at 1 min intervals
  HISTORY_SNAPSHOT_INTERVAL_MS: parseInt(process.env.PERF_HISTORY_SNAPSHOT_MS, 10) || 60000, // 1 minute

  // Health thresholds
  HEALTH_LATENCY_WARNING: parseFloat(process.env.PERF_HEALTH_LATENCY_WARNING || '0.7'), // P95 at 70% of budget
  HEALTH_LATENCY_CRITICAL: parseFloat(process.env.PERF_HEALTH_LATENCY_CRITICAL || '0.9'), // P95 at 90% of budget
  HEALTH_CACHE_HIT_WARNING: parseFloat(process.env.PERF_HEALTH_CACHE_HIT_WARNING || '0.5'), // 50% hit rate
  HEALTH_CACHE_HIT_CRITICAL: parseFloat(process.env.PERF_HEALTH_CACHE_HIT_CRITICAL || '0.3'), // 30% hit rate
  HEALTH_ERROR_RATE_WARNING: parseFloat(process.env.PERF_HEALTH_ERROR_RATE_WARNING || '0.05'), // 5% errors
  HEALTH_ERROR_RATE_CRITICAL: parseFloat(process.env.PERF_HEALTH_ERROR_RATE_CRITICAL || '0.1'), // 10% errors

  // Sparkline settings
  SPARKLINE_WIDTH: parseInt(process.env.PERF_SPARKLINE_WIDTH, 10) || 20,
};

/**
 * Health status levels
 */
const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  WARNING: 'warning',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown',
};

/**
 * Throughput bucket for tracking requests per time slice
 */
class ThroughputBucket {
  constructor(timestamp) {
    this.timestamp = timestamp;
    this.requests = 0;
    this.errors = 0;
    this.byEndpoint = new Map();
    this.byStatusCode = new Map();
  }

  record(endpoint, statusCode, isError = false) {
    this.requests++;
    if (isError) this.errors++;

    // Track by endpoint
    const current = this.byEndpoint.get(endpoint) || { requests: 0, errors: 0 };
    current.requests++;
    if (isError) current.errors++;
    this.byEndpoint.set(endpoint, current);

    // Track by status code
    const statusCount = this.byStatusCode.get(statusCode) || 0;
    this.byStatusCode.set(statusCode, statusCount + 1);
  }

  toJSON() {
    return {
      timestamp: this.timestamp,
      requests: this.requests,
      errors: this.errors,
      errorRate: this.requests > 0 ? this.errors / this.requests : 0,
      byEndpoint: Object.fromEntries(this.byEndpoint),
      byStatusCode: Object.fromEntries(this.byStatusCode),
    };
  }
}

/**
 * Rolling window throughput tracker
 */
class ThroughputTracker {
  constructor(windowMs, bucketCount) {
    this.windowMs = windowMs;
    this.bucketCount = bucketCount;
    this.bucketDurationMs = Math.floor(windowMs / bucketCount);
    this.buckets = [];
    this.currentBucket = null;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.startTime = Date.now();
  }

  /**
   * Get or create current bucket
   */
  _getCurrentBucket() {
    const now = Date.now();
    const bucketTimestamp = Math.floor(now / this.bucketDurationMs) * this.bucketDurationMs;

    if (!this.currentBucket || this.currentBucket.timestamp !== bucketTimestamp) {
      // Rotate buckets
      if (this.currentBucket) {
        this.buckets.push(this.currentBucket);

        // Trim old buckets
        while (this.buckets.length > this.bucketCount) {
          this.buckets.shift();
        }
      }

      this.currentBucket = new ThroughputBucket(bucketTimestamp);
    }

    return this.currentBucket;
  }

  /**
   * Record a request
   */
  record(endpoint, statusCode) {
    const isError = statusCode >= 400;
    const bucket = this._getCurrentBucket();
    bucket.record(endpoint, statusCode, isError);

    this.totalRequests++;
    if (isError) this.totalErrors++;
  }

  /**
   * Get requests per second in the current window
   */
  getRequestsPerSecond() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let totalRequests = 0;
    let activeTimeMs = 0;

    // Count from historical buckets
    for (const bucket of this.buckets) {
      if (bucket.timestamp >= windowStart) {
        totalRequests += bucket.requests;
        activeTimeMs += this.bucketDurationMs;
      }
    }

    // Add current bucket
    if (this.currentBucket) {
      totalRequests += this.currentBucket.requests;
      activeTimeMs += Math.min(this.bucketDurationMs, now - this.currentBucket.timestamp);
    }

    // Calculate RPS
    const activeSeconds = activeTimeMs / 1000;
    return activeSeconds > 0 ? totalRequests / activeSeconds : 0;
  }

  /**
   * Get error rate in the current window
   */
  getErrorRate() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let totalRequests = 0;
    let totalErrors = 0;

    for (const bucket of this.buckets) {
      if (bucket.timestamp >= windowStart) {
        totalRequests += bucket.requests;
        totalErrors += bucket.errors;
      }
    }

    if (this.currentBucket) {
      totalRequests += this.currentBucket.requests;
      totalErrors += this.currentBucket.errors;
    }

    return totalRequests > 0 ? totalErrors / totalRequests : 0;
  }

  /**
   * Get throughput history (for sparklines)
   */
  getHistory() {
    const history = [];

    for (const bucket of this.buckets) {
      history.push({
        timestamp: bucket.timestamp,
        rps: bucket.requests / (this.bucketDurationMs / 1000),
        errorRate: bucket.requests > 0 ? bucket.errors / bucket.requests : 0,
      });
    }

    if (this.currentBucket) {
      const elapsed = Date.now() - this.currentBucket.timestamp;
      const seconds = Math.max(elapsed / 1000, 0.1);
      history.push({
        timestamp: this.currentBucket.timestamp,
        rps: this.currentBucket.requests / seconds,
        errorRate: this.currentBucket.requests > 0 ? this.currentBucket.errors / this.currentBucket.requests : 0,
      });
    }

    return history;
  }

  /**
   * Get statistics
   */
  getStats() {
    const rps = this.getRequestsPerSecond();
    const errorRate = this.getErrorRate();

    return {
      requestsPerSecond: parseFloat(rps.toFixed(2)),
      errorRate: parseFloat(errorRate.toFixed(4)),
      errorRatePercent: `${(errorRate * 100).toFixed(2)}%`,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      uptimeMs: Date.now() - this.startTime,
      bucketCount: this.buckets.length + (this.currentBucket ? 1 : 0),
      windowMs: this.windowMs,
    };
  }

  /**
   * Reset statistics
   */
  reset() {
    this.buckets = [];
    this.currentBucket = null;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.startTime = Date.now();
  }
}

/**
 * Historical snapshot storage
 */
class HistoryStorage {
  constructor(maxEntries) {
    this.maxEntries = maxEntries;
    this.snapshots = [];
  }

  /**
   * Add a snapshot
   */
  addSnapshot(snapshot) {
    this.snapshots.push({
      ...snapshot,
      timestamp: Date.now(),
    });

    // Trim old snapshots
    while (this.snapshots.length > this.maxEntries) {
      this.snapshots.shift();
    }
  }

  /**
   * Get snapshots within a time range
   */
  getSnapshots(startTime, endTime = Date.now()) {
    return this.snapshots.filter(
      s => s.timestamp >= startTime && s.timestamp <= endTime
    );
  }

  /**
   * Get the latest snapshot
   */
  getLatest() {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    if (this.snapshots.length === 0) {
      return { count: 0, oldestTimestamp: null, newestTimestamp: null };
    }

    return {
      count: this.snapshots.length,
      maxEntries: this.maxEntries,
      oldestTimestamp: this.snapshots[0].timestamp,
      newestTimestamp: this.snapshots[this.snapshots.length - 1].timestamp,
      spanMs: this.snapshots[this.snapshots.length - 1].timestamp - this.snapshots[0].timestamp,
    };
  }

  /**
   * Clear all snapshots
   */
  clear() {
    this.snapshots = [];
  }
}

/**
 * Generate ASCII sparkline from data points
 */
function generateSparkline(values, width = CONFIG.SPARKLINE_WIDTH) {
  if (!values || values.length === 0) return '';

  const chars = ' ▁▂▃▄▅▆▇█';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Sample values if we have more than width
  let sampled = values;
  if (values.length > width) {
    const step = values.length / width;
    sampled = [];
    for (let i = 0; i < width; i++) {
      const idx = Math.floor(i * step);
      sampled.push(values[idx]);
    }
  }

  return sampled.map(v => {
    const normalized = (v - min) / range;
    const charIndex = Math.min(Math.floor(normalized * (chars.length - 1)), chars.length - 1);
    return chars[charIndex];
  }).join('');
}

/**
 * Performance Dashboard Service
 */
class PerformanceDashboardService {
  constructor() {
    this._throughput = new ThroughputTracker(
      CONFIG.THROUGHPUT_WINDOW_MS,
      CONFIG.THROUGHPUT_BUCKET_COUNT
    );
    this._history = new HistoryStorage(CONFIG.HISTORY_MAX_ENTRIES);
    this._snapshotInterval = null;
    this._initialized = false;
    this._initializationTime = null;

    // Lazy-loaded service references
    this._latencyService = null;
    this._circuitBreakerService = null;
    this._cacheService = null;
    this._rateLimitService = null;
  }

  /**
   * Initialize the service
   */
  initialize() {
    if (this._initialized) return;

    // Start periodic snapshot collection
    this._startSnapshotCollection();

    this._initialized = true;
    this._initializationTime = new Date().toISOString();

    log.info('Performance dashboard service initialized', {
      throughputWindowMs: CONFIG.THROUGHPUT_WINDOW_MS,
      historyMaxEntries: CONFIG.HISTORY_MAX_ENTRIES,
      snapshotIntervalMs: CONFIG.HISTORY_SNAPSHOT_INTERVAL_MS,
    });
  }

  /**
   * Start periodic snapshot collection
   */
  _startSnapshotCollection() {
    if (this._snapshotInterval) return;

    this._snapshotInterval = setInterval(() => {
      try {
        const snapshot = this._captureSnapshot();
        this._history.addSnapshot(snapshot);

        trackMetric('performance.snapshot', 1, {
          healthStatus: snapshot.health.status,
          healthScore: snapshot.health.score,
        });
      } catch (error) {
        log.error('Error capturing performance snapshot:', error);
      }
    }, CONFIG.HISTORY_SNAPSHOT_INTERVAL_MS);

    // Don't prevent Node.js from exiting
    if (this._snapshotInterval.unref) {
      this._snapshotInterval.unref();
    }
  }

  /**
   * Stop snapshot collection
   */
  _stopSnapshotCollection() {
    if (this._snapshotInterval) {
      clearInterval(this._snapshotInterval);
      this._snapshotInterval = null;
    }
  }

  /**
   * Get latency budget service (lazy load)
   */
  _getLatencyService() {
    if (!this._latencyService) {
      try {
        const { getLatencyBudgetService } = require('./latency-budget-service');
        this._latencyService = getLatencyBudgetService();
      } catch (e) {
        log.warn('Latency budget service not available:', e.message);
      }
    }
    return this._latencyService;
  }

  /**
   * Get circuit breaker service (lazy load)
   */
  _getCircuitBreakerService() {
    if (!this._circuitBreakerService) {
      try {
        const { getCircuitBreakerService } = require('./circuit-breaker-service');
        this._circuitBreakerService = getCircuitBreakerService();
      } catch (e) {
        log.warn('Circuit breaker service not available:', e.message);
      }
    }
    return this._circuitBreakerService;
  }

  /**
   * Get cache service (lazy load)
   */
  _getCacheService() {
    if (!this._cacheService) {
      try {
        const { getEntityResolutionCache } = require('./entity-resolution-cache');
        this._cacheService = getEntityResolutionCache();
      } catch (e) {
        log.warn('Entity resolution cache not available:', e.message);
      }
    }
    return this._cacheService;
  }

  /**
   * Get rate limit stats (lazy load)
   */
  _getRateLimitStats() {
    try {
      const { getRateLimitStats } = require('./user-rate-limit-service');
      if (getRateLimitStats) {
        return getRateLimitStats().getGlobalStats();
      }
    } catch (e) {
      log.debug('Rate limit stats not available:', e.message);
    }
    return null;
  }

  /**
   * Record a request for throughput tracking
   */
  recordRequest(endpoint, statusCode) {
    this._ensureInitialized();
    this._throughput.record(endpoint, statusCode);
  }

  /**
   * Capture a performance snapshot
   */
  _captureSnapshot() {
    const latencyService = this._getLatencyService();
    const circuitBreakerService = this._getCircuitBreakerService();
    const cacheService = this._getCacheService();

    const snapshot = {
      throughput: this._throughput.getStats(),
      latency: latencyService ? latencyService.getHealthSummary() : null,
      circuitBreakers: circuitBreakerService ? circuitBreakerService.getStatus() : null,
      cache: cacheService ? cacheService.getHealthSummary() : null,
      rateLimit: this._getRateLimitStats(),
      health: null, // Calculated below
    };

    snapshot.health = this._calculateHealth(snapshot);
    return snapshot;
  }

  /**
   * Calculate overall health score
   */
  _calculateHealth(snapshot) {
    const scores = [];
    const issues = [];

    // Throughput health (error rate)
    const errorRate = snapshot.throughput.errorRate;
    if (errorRate >= CONFIG.HEALTH_ERROR_RATE_CRITICAL) {
      scores.push(0);
      issues.push({ component: 'throughput', issue: 'critical error rate', value: errorRate });
    } else if (errorRate >= CONFIG.HEALTH_ERROR_RATE_WARNING) {
      scores.push(0.5);
      issues.push({ component: 'throughput', issue: 'elevated error rate', value: errorRate });
    } else {
      scores.push(1);
    }

    // Latency health
    if (snapshot.latency) {
      const latencyStatus = snapshot.latency.status;
      if (latencyStatus === 'healthy') {
        scores.push(1);
      } else if (latencyStatus === 'degraded') {
        scores.push(0.5);
        issues.push({ component: 'latency', issue: 'degraded performance', details: snapshot.latency });
      } else {
        scores.push(0);
        issues.push({ component: 'latency', issue: 'unhealthy', details: snapshot.latency });
      }
    }

    // Circuit breaker health
    if (snapshot.circuitBreakers) {
      const { summary } = snapshot.circuitBreakers;
      if (summary.open > 0) {
        scores.push(0);
        issues.push({
          component: 'circuitBreakers',
          issue: `${summary.open} open circuits`,
          total: summary.total
        });
      } else if (summary.halfOpen > 0) {
        scores.push(0.5);
        issues.push({
          component: 'circuitBreakers',
          issue: `${summary.halfOpen} half-open circuits`,
          total: summary.total
        });
      } else {
        scores.push(1);
      }
    }

    // Cache health
    if (snapshot.cache) {
      const cacheHealth = snapshot.cache.health;
      if (cacheHealth === 'healthy') {
        scores.push(1);
      } else if (cacheHealth === 'degraded') {
        scores.push(0.5);
        issues.push({ component: 'cache', issue: 'degraded cache performance', details: snapshot.cache });
      } else {
        scores.push(0);
        issues.push({ component: 'cache', issue: 'unhealthy cache', details: snapshot.cache });
      }
    }

    // Calculate overall score (average)
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;

    // Determine status
    let status;
    if (avgScore >= 0.9) {
      status = HEALTH_STATUS.HEALTHY;
    } else if (avgScore >= 0.5) {
      status = HEALTH_STATUS.WARNING;
    } else {
      status = HEALTH_STATUS.CRITICAL;
    }

    return {
      status,
      score: parseFloat(avgScore.toFixed(3)),
      scorePercent: `${(avgScore * 100).toFixed(1)}%`,
      componentCount: scores.length,
      issues,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get the full dashboard data
   */
  getDashboard() {
    this._ensureInitialized();

    const snapshot = this._captureSnapshot();
    const history = this._history.getSnapshots(Date.now() - 3600000); // Last hour

    // Generate sparklines
    const throughputHistory = this._throughput.getHistory();
    const rpsValues = throughputHistory.map(h => h.rps);
    const errorRateValues = throughputHistory.map(h => h.errorRate);

    const healthScoreHistory = history.map(h => h.health?.score || 0);

    return {
      ...snapshot,
      sparklines: {
        throughput: generateSparkline(rpsValues),
        errorRate: generateSparkline(errorRateValues),
        healthScore: generateSparkline(healthScoreHistory),
      },
      history: {
        summary: this._history.getSummary(),
        recentSnapshots: history.slice(-10), // Last 10 snapshots
      },
      metadata: {
        initializationTime: this._initializationTime,
        currentTime: new Date().toISOString(),
        config: {
          throughputWindowMs: CONFIG.THROUGHPUT_WINDOW_MS,
          historyMaxEntries: CONFIG.HISTORY_MAX_ENTRIES,
          snapshotIntervalMs: CONFIG.HISTORY_SNAPSHOT_INTERVAL_MS,
        },
      },
    };
  }

  /**
   * Get just the health status (lightweight)
   */
  getHealthStatus() {
    this._ensureInitialized();

    const snapshot = this._captureSnapshot();
    return {
      status: snapshot.health.status,
      score: snapshot.health.score,
      scorePercent: snapshot.health.scorePercent,
      issues: snapshot.health.issues,
      timestamp: snapshot.health.timestamp,
    };
  }

  /**
   * Get throughput metrics
   */
  getThroughput() {
    this._ensureInitialized();

    const stats = this._throughput.getStats();
    const history = this._throughput.getHistory();
    const rpsValues = history.map(h => h.rps);

    return {
      ...stats,
      sparkline: generateSparkline(rpsValues),
      history: history.slice(-20), // Last 20 data points
    };
  }

  /**
   * Get latency metrics aggregated from latency budget service
   */
  getLatencyMetrics() {
    this._ensureInitialized();

    const latencyService = this._getLatencyService();
    if (!latencyService) {
      return { available: false, message: 'Latency budget service not available' };
    }

    const aggregated = latencyService.getAggregatedStats();
    const healthSummary = latencyService.getHealthSummary();

    // Generate sparklines for each operation's P95 trend
    const operationSparklines = {};
    for (const [operation, stats] of Object.entries(aggregated.operations)) {
      // We don't have history per operation in the service, so just show current
      operationSparklines[operation] = {
        p95: stats.percentiles.p95,
        budget: stats.budgetMs,
        utilization: `${Math.round((stats.percentiles.p95 / stats.budgetMs) * 100)}%`,
      };
    }

    return {
      available: true,
      summary: healthSummary,
      operations: operationSparklines,
      totals: aggregated.totals,
    };
  }

  /**
   * Get circuit breaker metrics
   */
  getCircuitBreakerMetrics() {
    this._ensureInitialized();

    const cbService = this._getCircuitBreakerService();
    if (!cbService) {
      return { available: false, message: 'Circuit breaker service not available' };
    }

    const status = cbService.getStatus();
    const openCircuits = cbService.getOpenCircuits();

    return {
      available: true,
      enabled: status.enabled,
      summary: status.summary,
      openCircuits,
      breakers: status.breakers,
    };
  }

  /**
   * Get cache metrics
   */
  getCacheMetrics() {
    this._ensureInitialized();

    const cacheService = this._getCacheService();
    if (!cacheService) {
      return { available: false, message: 'Cache service not available' };
    }

    const stats = cacheService.getStats();
    const healthSummary = cacheService.getHealthSummary();

    return {
      available: true,
      health: healthSummary,
      caches: stats.caches,
      totals: stats.totals,
    };
  }

  /**
   * Get rate limit metrics
   */
  getRateLimitMetrics() {
    this._ensureInitialized();

    const stats = this._getRateLimitStats();
    if (!stats) {
      return { available: false, message: 'Rate limit stats not available' };
    }

    return {
      available: true,
      ...stats,
    };
  }

  /**
   * Get historical data for a time range
   */
  getHistory(startTime, endTime = Date.now()) {
    this._ensureInitialized();

    const snapshots = this._history.getSnapshots(startTime, endTime);

    // Generate trend data
    const healthTrend = snapshots.map(s => ({
      timestamp: s.timestamp,
      score: s.health?.score || 0,
      status: s.health?.status || HEALTH_STATUS.UNKNOWN,
    }));

    const throughputTrend = snapshots.map(s => ({
      timestamp: s.timestamp,
      rps: s.throughput?.requestsPerSecond || 0,
      errorRate: s.throughput?.errorRate || 0,
    }));

    return {
      snapshots,
      trends: {
        health: healthTrend,
        throughput: throughputTrend,
      },
      summary: this._history.getSummary(),
      timeRange: {
        start: startTime,
        end: endTime,
        durationMs: endTime - startTime,
      },
    };
  }

  /**
   * Generate a text report for the dashboard
   */
  generateTextReport() {
    this._ensureInitialized();

    const dashboard = this.getDashboard();
    const lines = [];

    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║           PERFORMANCE DASHBOARD                              ║');
    lines.push('╠══════════════════════════════════════════════════════════════╣');

    // Health
    const healthIcon = {
      [HEALTH_STATUS.HEALTHY]: '✓',
      [HEALTH_STATUS.WARNING]: '⚠',
      [HEALTH_STATUS.CRITICAL]: '✗',
      [HEALTH_STATUS.UNKNOWN]: '?',
    }[dashboard.health.status];

    lines.push(`║ Overall Health: ${healthIcon} ${dashboard.health.status.toUpperCase().padEnd(10)} Score: ${dashboard.health.scorePercent.padEnd(6)} ║`);
    lines.push('╠══════════════════════════════════════════════════════════════╣');

    // Throughput
    lines.push('║ THROUGHPUT                                                   ║');
    lines.push(`║   RPS: ${dashboard.throughput.requestsPerSecond.toString().padEnd(10)} Error Rate: ${dashboard.throughput.errorRatePercent.padEnd(8)}    ║`);
    lines.push(`║   Trend: ${dashboard.sparklines.throughput.padEnd(20)}                            ║`);
    lines.push('╠══════════════════════════════════════════════════════════════╣');

    // Latency
    if (dashboard.latency) {
      lines.push('║ LATENCY                                                      ║');
      lines.push(`║   Status: ${(dashboard.latency.status || 'unknown').padEnd(15)}                            ║`);
      if (dashboard.latency.details) {
        for (const [op, detail] of Object.entries(dashboard.latency.details).slice(0, 3)) {
          lines.push(`║   ${op.padEnd(12)} P95: ${(detail.p95 || 0).toString().padEnd(6)}ms  Budget: ${(detail.budgetMs || 0).toString().padEnd(6)}ms ║`);
        }
      }
      lines.push('╠══════════════════════════════════════════════════════════════╣');
    }

    // Circuit Breakers
    if (dashboard.circuitBreakers) {
      const cb = dashboard.circuitBreakers.summary;
      lines.push('║ CIRCUIT BREAKERS                                             ║');
      lines.push(`║   Total: ${cb.total}  Closed: ${cb.closed}  Open: ${cb.open}  Half-Open: ${cb.halfOpen}       ║`);
      lines.push('╠══════════════════════════════════════════════════════════════╣');
    }

    // Cache
    if (dashboard.cache) {
      lines.push('║ CACHE                                                        ║');
      lines.push(`║   Status: ${(dashboard.cache.status || 'unknown').padEnd(10)} Hit Rate: ${(dashboard.cache.overallHitRate || '0%').padEnd(8)}       ║`);
      lines.push('╠══════════════════════════════════════════════════════════════╣');
    }

    // Issues
    if (dashboard.health.issues.length > 0) {
      lines.push('║ ISSUES                                                       ║');
      for (const issue of dashboard.health.issues.slice(0, 5)) {
        const msg = `${issue.component}: ${issue.issue}`.substring(0, 50);
        lines.push(`║   ⚠ ${msg.padEnd(55)} ║`);
      }
      lines.push('╠══════════════════════════════════════════════════════════════╣');
    }

    lines.push(`║ Generated: ${dashboard.metadata.currentTime.substring(0, 19).padEnd(45)} ║`);
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Reset all metrics
   */
  reset() {
    this._throughput.reset();
    this._history.clear();
    log.info('Performance dashboard metrics reset');
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
   * Shutdown the service
   */
  shutdown() {
    this._stopSnapshotCollection();
    log.info('Performance dashboard service shutdown');
  }
}

// Singleton instance
let instance = null;

/**
 * Get the performance dashboard service instance
 */
function getPerformanceDashboardService() {
  if (!instance) {
    instance = new PerformanceDashboardService();
    instance.initialize();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
function resetPerformanceDashboardService() {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

/**
 * Middleware to track request throughput
 */
function throughputMiddleware() {
  return (req, res, next) => {
    const service = getPerformanceDashboardService();

    // Track response after it's sent
    res.on('finish', () => {
      const endpoint = req.route?.path || req.path || 'unknown';
      service.recordRequest(endpoint, res.statusCode);
    });

    next();
  };
}

module.exports = {
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
};
