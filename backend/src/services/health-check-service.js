/**
 * Health Check Service (FC.7)
 *
 * Provides comprehensive health checks for all system dependencies.
 * Supports Kubernetes-style readiness/liveness probes and detailed diagnostics.
 *
 * Features:
 * - Individual health checks per dependency (Cosmos DB, OpenAI, Azure Search, Gremlin, Blob Storage)
 * - Cached results to prevent excessive health check calls
 * - Kubernetes-compatible readiness/liveness probe endpoints
 * - Startup validation for all critical dependencies
 * - Health check history for trend analysis
 * - Configurable timeouts and thresholds
 *
 * Dependencies:
 * - circuit-breaker-service.js for service status
 * - configuration-service.js for config validation
 * - telemetry for monitoring integration
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');

// Health check status constants
const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown',
};

// Dependency names
const Dependencies = {
  COSMOS_DB: 'cosmos_db',
  GREMLIN: 'gremlin',
  OPENAI: 'openai',
  AZURE_SEARCH: 'azure_search',
  BLOB_STORAGE: 'blob_storage',
  DOC_INTELLIGENCE: 'doc_intelligence',
};

// Default configuration
const DEFAULT_CONFIG = {
  checkTimeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS) || 10000,
  cacheTimeMs: parseInt(process.env.HEALTH_CHECK_CACHE_MS) || 30000, // Cache results for 30s
  historySize: parseInt(process.env.HEALTH_CHECK_HISTORY_SIZE) || 100,
  startupRetries: parseInt(process.env.HEALTH_CHECK_STARTUP_RETRIES) || 3,
  startupRetryDelayMs: parseInt(process.env.HEALTH_CHECK_STARTUP_RETRY_DELAY_MS) || 5000,
  criticalDependencies: ['cosmos_db'], // Required for app to function
  optionalDependencies: ['gremlin', 'openai', 'azure_search', 'blob_storage', 'doc_intelligence'],
};

class HealthCheckService {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.cache = new Map(); // dependency -> { status, timestamp, details }
    this.history = []; // Array of { timestamp, results }
    this.startupComplete = false;
    this.startupErrors = [];
    this.listeners = new Set();
  }

  /**
   * Add a listener for health status changes
   * @param {Function} listener - Callback function(dependency, oldStatus, newStatus)
   */
  addListener(listener) {
    this.listeners.add(listener);
  }

  /**
   * Remove a health status listener
   * @param {Function} listener - Listener to remove
   */
  removeListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * Notify listeners of status change
   * @param {string} dependency - Dependency name
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   */
  _notifyListeners(dependency, oldStatus, newStatus) {
    for (const listener of this.listeners) {
      try {
        listener(dependency, oldStatus, newStatus);
      } catch (e) {
        log.warn({ error: e.message }, 'Health check listener error');
      }
    }
  }

  /**
   * Get cached result if still valid
   * @param {string} dependency - Dependency name
   * @returns {Object|null} Cached result or null
   */
  _getCached(dependency) {
    const cached = this.cache.get(dependency);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.config.cacheTimeMs) {
      return null;
    }
    return cached;
  }

  /**
   * Set cache entry for a dependency
   * @param {string} dependency - Dependency name
   * @param {Object} result - Health check result
   */
  _setCache(dependency, result) {
    const oldCached = this.cache.get(dependency);
    const oldStatus = oldCached?.status;

    this.cache.set(dependency, {
      ...result,
      timestamp: Date.now(),
    });

    // Notify listeners if status changed
    if (oldStatus && oldStatus !== result.status) {
      this._notifyListeners(dependency, oldStatus, result.status);
    }
  }

  /**
   * Execute a health check with timeout
   * @param {Function} checkFn - Async function to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Object>} Health check result
   */
  async _executeWithTimeout(checkFn, timeoutMs = this.config.checkTimeoutMs) {
    return Promise.race([
      checkFn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Health check timed out')), timeoutMs)
      ),
    ]);
  }

  /**
   * Check Cosmos DB health
   * @param {boolean} useCache - Whether to use cached result
   * @returns {Promise<Object>} Health status
   */
  async checkCosmosDb(useCache = true) {
    if (useCache) {
      const cached = this._getCached(Dependencies.COSMOS_DB);
      if (cached) return cached;
    }

    const startTime = Date.now();
    try {
      const { getClient } = require('../storage/cosmos');
      const client = getClient();

      // Try to read database account info
      const { resource } = await this._executeWithTimeout(async () => {
        return client.getDatabaseAccount();
      });

      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.HEALTHY,
        latencyMs,
        details: {
          endpoint: process.env.COSMOS_DB_ENDPOINT?.replace(/https?:\/\/([^.]+).*/, '$1'),
          databaseAccountId: resource?.id,
          writableLocations: resource?.writableLocations?.length || 0,
          readableLocations: resource?.readableLocations?.length || 0,
          consistencyPolicy: resource?.consistencyPolicy?.defaultConsistencyLevel,
        },
        message: 'Cosmos DB is healthy',
      };

      this._setCache(Dependencies.COSMOS_DB, result);
      trackMetric('health_check_latency', latencyMs, { dependency: 'cosmos_db' });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.UNHEALTHY,
        latencyMs,
        details: { error: error.message },
        message: `Cosmos DB health check failed: ${error.message}`,
      };

      this._setCache(Dependencies.COSMOS_DB, result);
      log.error({ error: error.message }, 'Cosmos DB health check failed');
      trackEvent('health_check_failure', { dependency: 'cosmos_db', error: error.message });
      return result;
    }
  }

  /**
   * Check Gremlin (Graph Database) health
   * @param {boolean} useCache - Whether to use cached result
   * @returns {Promise<Object>} Health status
   */
  async checkGremlin(useCache = true) {
    if (useCache) {
      const cached = this._getCached(Dependencies.GREMLIN);
      if (cached) return cached;
    }

    const startTime = Date.now();
    try {
      const { createGremlinClient, getGremlinConfig } = require('../clients/gremlin');
      const config = getGremlinConfig();

      if (!config.endpoint) {
        const result = {
          status: HealthStatus.UNKNOWN,
          latencyMs: 0,
          details: { configured: false },
          message: 'Gremlin endpoint not configured',
        };
        this._setCache(Dependencies.GREMLIN, result);
        return result;
      }

      const client = await this._executeWithTimeout(async () => {
        return createGremlinClient();
      });

      // Execute a simple query to verify connectivity
      await this._executeWithTimeout(async () => {
        return client.submit('g.V().count()');
      });

      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.HEALTHY,
        latencyMs,
        details: {
          endpoint: config.endpoint?.replace(/wss?:\/\/([^.]+).*/, '$1'),
          database: config.database,
          graph: config.graph,
        },
        message: 'Gremlin is healthy',
      };

      this._setCache(Dependencies.GREMLIN, result);
      trackMetric('health_check_latency', latencyMs, { dependency: 'gremlin' });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.UNHEALTHY,
        latencyMs,
        details: { error: error.message },
        message: `Gremlin health check failed: ${error.message}`,
      };

      this._setCache(Dependencies.GREMLIN, result);
      log.error({ error: error.message }, 'Gremlin health check failed');
      trackEvent('health_check_failure', { dependency: 'gremlin', error: error.message });
      return result;
    }
  }

  /**
   * Check OpenAI/Azure OpenAI health
   * @param {boolean} useCache - Whether to use cached result
   * @returns {Promise<Object>} Health status
   */
  async checkOpenAI(useCache = true) {
    if (useCache) {
      const cached = this._getCached(Dependencies.OPENAI);
      if (cached) return cached;
    }

    const startTime = Date.now();
    try {
      const { createOpenAIClient, getOpenAIConfig } = require('../clients');
      const config = getOpenAIConfig();

      if (!config.endpoint && !config.apiKey) {
        const result = {
          status: HealthStatus.UNKNOWN,
          latencyMs: 0,
          details: { configured: false },
          message: 'OpenAI not configured',
        };
        this._setCache(Dependencies.OPENAI, result);
        return result;
      }

      const client = createOpenAIClient();

      // Execute a minimal API call to verify connectivity
      // List models is a lightweight endpoint
      await this._executeWithTimeout(async () => {
        return client.models.list({ limit: 1 });
      });

      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.HEALTHY,
        latencyMs,
        details: {
          endpoint: config.endpoint?.replace(/https?:\/\/([^.]+).*/, '$1') || 'api.openai.com',
          deploymentName: config.deploymentName,
          isAzure: !!config.endpoint,
        },
        message: 'OpenAI is healthy',
      };

      this._setCache(Dependencies.OPENAI, result);
      trackMetric('health_check_latency', latencyMs, { dependency: 'openai' });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // Check if it's a circuit breaker open
      let status = HealthStatus.UNHEALTHY;
      let message = `OpenAI health check failed: ${error.message}`;

      if (error.message?.includes('circuit') || error.message?.includes('breaker')) {
        status = HealthStatus.DEGRADED;
        message = 'OpenAI circuit breaker is open - service temporarily unavailable';
      }

      const result = {
        status,
        latencyMs,
        details: { error: error.message },
        message,
      };

      this._setCache(Dependencies.OPENAI, result);
      log.error({ error: error.message }, 'OpenAI health check failed');
      trackEvent('health_check_failure', { dependency: 'openai', error: error.message });
      return result;
    }
  }

  /**
   * Check Azure AI Search health
   * @param {boolean} useCache - Whether to use cached result
   * @returns {Promise<Object>} Health status
   */
  async checkAzureSearch(useCache = true) {
    if (useCache) {
      const cached = this._getCached(Dependencies.AZURE_SEARCH);
      if (cached) return cached;
    }

    const startTime = Date.now();
    try {
      const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
      const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

      if (!endpoint) {
        const result = {
          status: HealthStatus.UNKNOWN,
          latencyMs: 0,
          details: { configured: false },
          message: 'Azure Search not configured',
        };
        this._setCache(Dependencies.AZURE_SEARCH, result);
        return result;
      }

      const { createSearchClient } = require('../clients/search');
      const client = createSearchClient();

      // Execute a minimal search to verify connectivity
      await this._executeWithTimeout(async () => {
        return client.search('*', { top: 1 });
      });

      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.HEALTHY,
        latencyMs,
        details: {
          endpoint: endpoint?.replace(/https?:\/\/([^.]+).*/, '$1'),
          indexName,
        },
        message: 'Azure Search is healthy',
      };

      this._setCache(Dependencies.AZURE_SEARCH, result);
      trackMetric('health_check_latency', latencyMs, { dependency: 'azure_search' });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.UNHEALTHY,
        latencyMs,
        details: { error: error.message },
        message: `Azure Search health check failed: ${error.message}`,
      };

      this._setCache(Dependencies.AZURE_SEARCH, result);
      log.error({ error: error.message }, 'Azure Search health check failed');
      trackEvent('health_check_failure', { dependency: 'azure_search', error: error.message });
      return result;
    }
  }

  /**
   * Check Azure Blob Storage health
   * @param {boolean} useCache - Whether to use cached result
   * @returns {Promise<Object>} Health status
   */
  async checkBlobStorage(useCache = true) {
    if (useCache) {
      const cached = this._getCached(Dependencies.BLOB_STORAGE);
      if (cached) return cached;
    }

    const startTime = Date.now();
    try {
      const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

      if (!accountName && !connectionString) {
        const result = {
          status: HealthStatus.UNKNOWN,
          latencyMs: 0,
          details: { configured: false },
          message: 'Blob Storage not configured',
        };
        this._setCache(Dependencies.BLOB_STORAGE, result);
        return result;
      }

      const { getContainerClient } = require('../storage/blob');

      // Get container client and check if exists
      const containerClient = await this._executeWithTimeout(async () => {
        return getContainerClient();
      });

      const exists = await this._executeWithTimeout(async () => {
        return containerClient.exists();
      });

      const latencyMs = Date.now() - startTime;
      const result = {
        status: exists ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
        latencyMs,
        details: {
          accountName: accountName || connectionString?.match(/AccountName=([^;]+)/)?.[1],
          containerName: process.env.AZURE_STORAGE_CONTAINER_DOCUMENTS || 'documents',
          containerExists: exists,
        },
        message: exists
          ? 'Blob Storage is healthy'
          : 'Blob Storage container does not exist',
      };

      this._setCache(Dependencies.BLOB_STORAGE, result);
      trackMetric('health_check_latency', latencyMs, { dependency: 'blob_storage' });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.UNHEALTHY,
        latencyMs,
        details: { error: error.message },
        message: `Blob Storage health check failed: ${error.message}`,
      };

      this._setCache(Dependencies.BLOB_STORAGE, result);
      log.error({ error: error.message }, 'Blob Storage health check failed');
      trackEvent('health_check_failure', { dependency: 'blob_storage', error: error.message });
      return result;
    }
  }

  /**
   * Check Document Intelligence health
   * @param {boolean} useCache - Whether to use cached result
   * @returns {Promise<Object>} Health status
   */
  async checkDocIntelligence(useCache = true) {
    if (useCache) {
      const cached = this._getCached(Dependencies.DOC_INTELLIGENCE);
      if (cached) return cached;
    }

    const startTime = Date.now();
    try {
      const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;

      if (!endpoint) {
        const result = {
          status: HealthStatus.UNKNOWN,
          latencyMs: 0,
          details: { configured: false },
          message: 'Document Intelligence not configured',
        };
        this._setCache(Dependencies.DOC_INTELLIGENCE, result);
        return result;
      }

      // For Document Intelligence, we can't easily do a free health check
      // since all operations are billed. Just verify the endpoint is reachable.
      const fetch = require('node-fetch');
      const response = await this._executeWithTimeout(async () => {
        return fetch(`${endpoint}/formrecognizer/info?api-version=2023-07-31`, {
          method: 'GET',
          headers: {
            'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '',
          },
        });
      });

      const latencyMs = Date.now() - startTime;
      const isHealthy = response.status === 200 || response.status === 401; // 401 means endpoint is reachable but auth issue

      const result = {
        status: isHealthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
        latencyMs,
        details: {
          endpoint: endpoint?.replace(/https?:\/\/([^.]+).*/, '$1'),
          httpStatus: response.status,
        },
        message: isHealthy
          ? 'Document Intelligence is healthy'
          : `Document Intelligence returned status ${response.status}`,
      };

      this._setCache(Dependencies.DOC_INTELLIGENCE, result);
      trackMetric('health_check_latency', latencyMs, { dependency: 'doc_intelligence' });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const result = {
        status: HealthStatus.UNHEALTHY,
        latencyMs,
        details: { error: error.message },
        message: `Document Intelligence health check failed: ${error.message}`,
      };

      this._setCache(Dependencies.DOC_INTELLIGENCE, result);
      log.error({ error: error.message }, 'Document Intelligence health check failed');
      trackEvent('health_check_failure', { dependency: 'doc_intelligence', error: error.message });
      return result;
    }
  }

  /**
   * Check all dependencies
   * @param {boolean} useCache - Whether to use cached results
   * @returns {Promise<Object>} Combined health status
   */
  async checkAll(useCache = true) {
    const startTime = Date.now();

    // Run all checks in parallel
    const [cosmosDb, gremlin, openai, azureSearch, blobStorage, docIntelligence] =
      await Promise.all([
        this.checkCosmosDb(useCache),
        this.checkGremlin(useCache),
        this.checkOpenAI(useCache),
        this.checkAzureSearch(useCache),
        this.checkBlobStorage(useCache),
        this.checkDocIntelligence(useCache),
      ]);

    const dependencies = {
      [Dependencies.COSMOS_DB]: cosmosDb,
      [Dependencies.GREMLIN]: gremlin,
      [Dependencies.OPENAI]: openai,
      [Dependencies.AZURE_SEARCH]: azureSearch,
      [Dependencies.BLOB_STORAGE]: blobStorage,
      [Dependencies.DOC_INTELLIGENCE]: docIntelligence,
    };

    // Determine overall status
    const statuses = Object.values(dependencies).map((d) => d.status);
    const criticalStatuses = this.config.criticalDependencies.map(
      (dep) => dependencies[dep]?.status
    );

    let overallStatus = HealthStatus.HEALTHY;
    if (criticalStatuses.some((s) => s === HealthStatus.UNHEALTHY)) {
      overallStatus = HealthStatus.UNHEALTHY;
    } else if (statuses.some((s) => s === HealthStatus.UNHEALTHY)) {
      overallStatus = HealthStatus.DEGRADED;
    } else if (statuses.some((s) => s === HealthStatus.DEGRADED)) {
      overallStatus = HealthStatus.DEGRADED;
    }

    const totalLatencyMs = Date.now() - startTime;

    const result = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      totalLatencyMs,
      dependencies,
      summary: {
        healthy: statuses.filter((s) => s === HealthStatus.HEALTHY).length,
        degraded: statuses.filter((s) => s === HealthStatus.DEGRADED).length,
        unhealthy: statuses.filter((s) => s === HealthStatus.UNHEALTHY).length,
        unknown: statuses.filter((s) => s === HealthStatus.UNKNOWN).length,
      },
    };

    // Store in history
    this._addToHistory(result);

    trackMetric('health_check_total_latency', totalLatencyMs);
    trackEvent('health_check_complete', { status: overallStatus });

    return result;
  }

  /**
   * Add result to history
   * @param {Object} result - Health check result
   */
  _addToHistory(result) {
    this.history.push({
      timestamp: result.timestamp,
      status: result.status,
      summary: result.summary,
    });

    // Trim history if needed
    while (this.history.length > this.config.historySize) {
      this.history.shift();
    }
  }

  /**
   * Get health check history
   * @param {number} limit - Maximum entries to return
   * @returns {Array} Health check history
   */
  getHistory(limit = 20) {
    return this.history.slice(-limit);
  }

  /**
   * Kubernetes liveness probe - is the process alive?
   * @returns {Object} Liveness status
   */
  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Kubernetes readiness probe - is the app ready to serve traffic?
   * @returns {Promise<Object>} Readiness status
   */
  async getReadiness() {
    // Check critical dependencies
    const criticalResults = await Promise.all(
      this.config.criticalDependencies.map((dep) => {
        switch (dep) {
          case Dependencies.COSMOS_DB:
            return this.checkCosmosDb(true);
          case Dependencies.GREMLIN:
            return this.checkGremlin(true);
          default:
            return Promise.resolve({ status: HealthStatus.UNKNOWN });
        }
      })
    );

    const allCriticalHealthy = criticalResults.every(
      (r) => r.status === HealthStatus.HEALTHY || r.status === HealthStatus.DEGRADED
    );

    return {
      ready: allCriticalHealthy && this.startupComplete,
      timestamp: new Date().toISOString(),
      startupComplete: this.startupComplete,
      criticalDependencies: this.config.criticalDependencies.reduce((acc, dep, i) => {
        acc[dep] = criticalResults[i].status;
        return acc;
      }, {}),
    };
  }

  /**
   * Perform startup validation
   * @returns {Promise<Object>} Startup validation result
   */
  async performStartupValidation() {
    log.info('Performing startup health validation...');
    this.startupErrors = [];

    for (let attempt = 1; attempt <= this.config.startupRetries; attempt++) {
      try {
        const result = await this.checkAll(false); // Don't use cache for startup

        // Check critical dependencies
        const criticalOk = this.config.criticalDependencies.every((dep) => {
          const depStatus = result.dependencies[dep]?.status;
          return depStatus === HealthStatus.HEALTHY || depStatus === HealthStatus.DEGRADED;
        });

        if (criticalOk) {
          this.startupComplete = true;
          log.info(
            { attempt, status: result.status },
            'Startup health validation passed'
          );
          trackEvent('startup_validation_success', { attempt, status: result.status });
          return { success: true, result };
        }

        // Log which critical dependencies failed
        const failedCritical = this.config.criticalDependencies.filter(
          (dep) => result.dependencies[dep]?.status === HealthStatus.UNHEALTHY
        );
        this.startupErrors.push({
          attempt,
          failedDependencies: failedCritical,
          timestamp: new Date().toISOString(),
        });

        log.warn(
          { attempt, failedDependencies: failedCritical },
          'Startup health validation failed, retrying...'
        );

        if (attempt < this.config.startupRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.startupRetryDelayMs)
          );
        }
      } catch (error) {
        this.startupErrors.push({
          attempt,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        log.error({ error: error.message, attempt }, 'Startup validation error');
      }
    }

    // All retries exhausted
    this.startupComplete = false;
    log.error(
      { errors: this.startupErrors },
      'Startup health validation failed after all retries'
    );
    trackEvent('startup_validation_failure', { errors: this.startupErrors });
    return { success: false, errors: this.startupErrors };
  }

  /**
   * Get startup status
   * @returns {Object} Startup status
   */
  getStartupStatus() {
    return {
      complete: this.startupComplete,
      errors: this.startupErrors,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get configuration for health checks
   * @returns {Object} Configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration updates
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    log.info({ updates }, 'Health check configuration updated');
  }

  /**
   * Clear cached health check results
   * @param {string} dependency - Optional specific dependency to clear
   */
  clearCache(dependency = null) {
    if (dependency) {
      this.cache.delete(dependency);
    } else {
      this.cache.clear();
    }
    log.info({ dependency: dependency || 'all' }, 'Health check cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    const entries = [];
    const now = Date.now();

    for (const [dep, cached] of this.cache.entries()) {
      entries.push({
        dependency: dep,
        status: cached.status,
        age: now - cached.timestamp,
        isFresh: now - cached.timestamp < this.config.cacheTimeMs,
      });
    }

    return {
      size: this.cache.size,
      cacheTimeMs: this.config.cacheTimeMs,
      entries,
    };
  }

  /**
   * Get health summary with circuit breaker integration
   * @returns {Promise<Object>} Health summary
   */
  async getHealthSummary() {
    const healthResult = await this.checkAll(true);

    // Try to get circuit breaker status
    let circuitBreakers = {};
    try {
      const { getCircuitBreakerService } = require('./circuit-breaker-service');
      const cbService = getCircuitBreakerService();
      circuitBreakers = cbService.getAllStatus();
    } catch (e) {
      // Circuit breaker service not available
    }

    return {
      ...healthResult,
      circuitBreakers,
      cache: this.getCacheStats(),
      startup: this.getStartupStatus(),
    };
  }
}

// Singleton instance
let healthCheckService = null;

/**
 * Get or create the singleton HealthCheckService instance
 * @returns {HealthCheckService}
 */
function getHealthCheckService() {
  if (!healthCheckService) {
    healthCheckService = new HealthCheckService();
  }
  return healthCheckService;
}

/**
 * Reset the singleton instance (for testing)
 */
function resetHealthCheckService() {
  healthCheckService = null;
}

module.exports = {
  HealthCheckService,
  getHealthCheckService,
  resetHealthCheckService,
  HealthStatus,
  Dependencies,
};
