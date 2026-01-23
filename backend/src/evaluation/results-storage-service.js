/**
 * Results Storage Service
 *
 * Provides persistent storage for benchmark evaluation results with support
 * for trend analysis, regression detection, and historical comparisons.
 *
 * Feature: F1.3.2 - Results Storage
 *
 * Key capabilities:
 * - Store benchmark run results with full metadata
 * - Query historical results for trend analysis
 * - Compare runs to detect regressions
 * - Support both Cosmos DB and local JSON file storage
 * - Semantic versioning for schema evolution
 *
 * Best practices implemented:
 * - Version everything (metrics, code versions, timestamps)
 * - Support trend analysis and lineage tracking
 * - Follow patterns from MLflow/W&B for evaluation tracking
 *
 * @see https://mlflow.org/ - MLflow experiment tracking patterns
 * @see https://docs.wandb.ai/ - Weights & Biases best practices
 */

const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');
const { log } = require('../utils/logger');

/**
 * Configuration for results storage
 */
const CONFIG = {
  // Container settings
  CONTAINER_ID: process.env.COSMOS_DB_EVALUATION_CONTAINER || 'evaluation-results',
  DATABASE_ID: process.env.COSMOS_DB_DATABASE || 'knowledge-platform',

  // Partition strategy: Use runId for efficient single-run queries
  PARTITION_KEY_PATH: '/runId',

  // TTL settings (optional - set to -1 to disable)
  DEFAULT_TTL_SECONDS: -1, // -1 = no automatic expiration

  // Query limits
  MAX_RUNS_PER_QUERY: 100,
  MAX_COMPARISONS: 10,

  // Version tracking for schema evolution
  SCHEMA_VERSION: '1.0.0',

  // Local storage fallback
  LOCAL_STORAGE_PATH: process.env.EVALUATION_RESULTS_PATH ||
    path.join(__dirname, '../../data/evaluation-results'),
};

/**
 * Document types stored in the evaluation results container
 */
const DOC_TYPES = {
  BENCHMARK_RUN: 'benchmark_run',
  SUITE_RESULT: 'suite_result',
  BASELINE: 'baseline',
  COMPARISON: 'comparison',
};

/**
 * Storage backends
 */
const STORAGE_BACKENDS = {
  COSMOS_DB: 'cosmos_db',
  LOCAL_JSON: 'local_json',
};

let client = null;
let database = null;
let container = null;
let storageBackend = null;

/**
 * Determine which storage backend to use
 */
function determineStorageBackend() {
  if (storageBackend) {
    return storageBackend;
  }

  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  if (endpoint) {
    storageBackend = STORAGE_BACKENDS.COSMOS_DB;
    log.info('Using Cosmos DB for evaluation results storage');
  } else {
    storageBackend = STORAGE_BACKENDS.LOCAL_JSON;
    log.info('Using local JSON file for evaluation results storage', {
      path: CONFIG.LOCAL_STORAGE_PATH,
    });
  }

  return storageBackend;
}

/**
 * Get or create the Cosmos client
 */
function getClient() {
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const key = process.env.COSMOS_DB_KEY;

  if (!endpoint) {
    throw new Error('COSMOS_DB_ENDPOINT is required for Cosmos DB storage');
  }

  if (client) {
    return client;
  }

  if (key) {
    client = new CosmosClient({ endpoint, key });
  } else {
    client = new CosmosClient({
      endpoint,
      aadCredentials: new DefaultAzureCredential(),
    });
  }

  return client;
}

/**
 * Initialize the evaluation results container (Cosmos DB)
 */
async function initCosmosContainer() {
  if (container) {
    return container;
  }

  try {
    const cosmosClient = getClient();

    // Create or get database
    const { database: db } = await cosmosClient.databases.createIfNotExists({
      id: CONFIG.DATABASE_ID,
    });
    database = db;

    // Create or get evaluation results container
    const { container: cont } = await database.containers.createIfNotExists({
      id: CONFIG.CONTAINER_ID,
      partitionKey: {
        paths: [CONFIG.PARTITION_KEY_PATH],
      },
      ...(CONFIG.DEFAULT_TTL_SECONDS > 0 && {
        defaultTtl: CONFIG.DEFAULT_TTL_SECONDS,
      }),
    });
    container = cont;

    log.info('Evaluation results container initialized', {
      containerId: CONFIG.CONTAINER_ID,
      databaseId: CONFIG.DATABASE_ID,
    });

    return container;
  } catch (error) {
    log.errorWithStack('Failed to initialize evaluation results container', error);
    throw error;
  }
}

/**
 * Initialize local JSON storage
 */
function initLocalStorage() {
  if (!fs.existsSync(CONFIG.LOCAL_STORAGE_PATH)) {
    fs.mkdirSync(CONFIG.LOCAL_STORAGE_PATH, { recursive: true });
    log.info('Created local evaluation results directory', {
      path: CONFIG.LOCAL_STORAGE_PATH,
    });
  }
}

/**
 * Load all local results from JSON files
 */
function loadLocalResults() {
  initLocalStorage();

  const results = {
    runs: [],
    baselines: [],
    comparisons: [],
  };

  const runsFile = path.join(CONFIG.LOCAL_STORAGE_PATH, 'runs.json');
  const baselinesFile = path.join(CONFIG.LOCAL_STORAGE_PATH, 'baselines.json');
  const comparisonsFile = path.join(CONFIG.LOCAL_STORAGE_PATH, 'comparisons.json');

  if (fs.existsSync(runsFile)) {
    results.runs = JSON.parse(fs.readFileSync(runsFile, 'utf-8'));
  }
  if (fs.existsSync(baselinesFile)) {
    results.baselines = JSON.parse(fs.readFileSync(baselinesFile, 'utf-8'));
  }
  if (fs.existsSync(comparisonsFile)) {
    results.comparisons = JSON.parse(fs.readFileSync(comparisonsFile, 'utf-8'));
  }

  return results;
}

/**
 * Save local results to JSON files
 */
function saveLocalResults(results) {
  initLocalStorage();

  const runsFile = path.join(CONFIG.LOCAL_STORAGE_PATH, 'runs.json');
  const baselinesFile = path.join(CONFIG.LOCAL_STORAGE_PATH, 'baselines.json');
  const comparisonsFile = path.join(CONFIG.LOCAL_STORAGE_PATH, 'comparisons.json');

  fs.writeFileSync(runsFile, JSON.stringify(results.runs, null, 2));
  fs.writeFileSync(baselinesFile, JSON.stringify(results.baselines, null, 2));
  fs.writeFileSync(comparisonsFile, JSON.stringify(results.comparisons, null, 2));
}

/**
 * Results Storage Service
 * Provides persistent storage for evaluation results and trend analysis
 */
class ResultsStorageService {
  constructor() {
    this.initialized = false;
    this.backend = null;
  }

  /**
   * Ensure the storage is initialized
   */
  async _ensureInitialized() {
    if (this.initialized) {
      return;
    }

    this.backend = determineStorageBackend();

    if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
      await initCosmosContainer();
    } else {
      initLocalStorage();
    }

    this.initialized = true;
  }

  // ==================== Benchmark Run Storage ====================

  /**
   * Store a complete benchmark run result
   *
   * @param {Object} benchmarkResult - Result from run-benchmark.js
   * @param {Object} options - Storage options
   * @param {string} options.runName - Optional human-readable run name
   * @param {string} options.gitCommit - Git commit hash
   * @param {string} options.gitBranch - Git branch name
   * @param {Object} options.tags - Custom tags for the run
   * @returns {Promise<Object>} Stored run document with ID
   */
  async storeRun(benchmarkResult, options = {}) {
    await this._ensureInitialized();

    const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    // Extract key metrics for easy querying
    const keyMetrics = this._extractKeyMetrics(benchmarkResult);

    const runDocument = {
      id: runId,
      runId, // Partition key
      docType: DOC_TYPES.BENCHMARK_RUN,
      name: options.runName || `Benchmark Run ${timestamp}`,
      timestamp,
      createdAt: timestamp,

      // Source tracking (MLOps best practice)
      source: {
        gitCommit: options.gitCommit || process.env.GIT_COMMIT || null,
        gitBranch: options.gitBranch || process.env.GIT_BRANCH || null,
        codeVersion: options.codeVersion || null,
        datasetVersion: benchmarkResult.metadata?.dataset?.version || null,
      },

      // Configuration used
      config: benchmarkResult.metadata?.config || {},

      // Summary metrics for quick access
      summary: {
        ...benchmarkResult.summary,
        keyMetrics,
      },

      // Full suite results
      suites: benchmarkResult.suites,

      // Metadata
      metadata: {
        ...benchmarkResult.metadata,
        schemaVersion: CONFIG.SCHEMA_VERSION,
      },

      // Custom tags for filtering
      tags: options.tags || {},

      // Performance tracking
      performance: {
        totalLatencyMs: benchmarkResult.metadata?.totalLatencyMs || 0,
      },
    };

    try {
      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        const { resource } = await container.items.create(runDocument);
        log.info('Benchmark run stored in Cosmos DB', {
          runId,
          passed: benchmarkResult.summary?.overallPassed,
        });
        return resource;
      } else {
        // Local JSON storage
        const results = loadLocalResults();
        results.runs.push(runDocument);
        saveLocalResults(results);
        log.info('Benchmark run stored locally', {
          runId,
          passed: benchmarkResult.summary?.overallPassed,
        });
        return runDocument;
      }
    } catch (error) {
      log.errorWithStack('Failed to store benchmark run', error);
      throw error;
    }
  }

  /**
   * Extract key metrics from benchmark result for easy querying
   */
  _extractKeyMetrics(benchmarkResult) {
    const metrics = {};

    for (const [suiteName, suiteResult] of Object.entries(benchmarkResult.suites || {})) {
      if (suiteResult.status === 'success' && suiteResult.metrics) {
        switch (suiteName) {
          case 'retrieval':
            metrics.mrr = suiteResult.metrics.mrr;
            metrics.map = suiteResult.metrics.map;
            break;
          case 'answer-quality':
            metrics.answerQuality = suiteResult.metrics.normalizedScore;
            break;
          case 'grounding':
            metrics.groundingScore = suiteResult.metrics.averageScore;
            break;
          case 'citation':
            metrics.citationAccuracy = suiteResult.metrics.averageScore;
            break;
          case 'entity-extraction':
            metrics.entityF1 = suiteResult.metrics.f1;
            metrics.entityPrecision = suiteResult.metrics.precision;
            metrics.entityRecall = suiteResult.metrics.recall;
            break;
          case 'relationship-extraction':
            metrics.relationshipF1 = suiteResult.metrics.f1;
            metrics.directionAccuracy = suiteResult.metrics.directionAccuracy;
            break;
        }
      }
    }

    return metrics;
  }

  /**
   * Get a benchmark run by ID
   *
   * @param {string} runId - Run identifier
   * @returns {Promise<Object|null>} Run document or null
   */
  async getRun(runId) {
    await this._ensureInitialized();

    try {
      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        const { resource } = await container.item(runId, runId).read();
        return resource;
      } else {
        const results = loadLocalResults();
        return results.runs.find((r) => r.runId === runId) || null;
      }
    } catch (error) {
      if (error.code === 404) {
        return null;
      }
      log.errorWithStack('Failed to get benchmark run', error);
      throw error;
    }
  }

  /**
   * Get recent benchmark runs
   *
   * @param {Object} options - Query options
   * @param {number} options.limit - Max runs to return (default: 10)
   * @param {Object} options.tags - Filter by tags
   * @param {string} options.gitBranch - Filter by git branch
   * @returns {Promise<Array>} List of runs
   */
  async getRecentRuns(options = {}) {
    await this._ensureInitialized();

    const { limit = 10, tags = null, gitBranch = null } = options;

    try {
      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        let queryText = `
          SELECT * FROM c
          WHERE c.docType = @docType
        `;
        const parameters = [{ name: '@docType', value: DOC_TYPES.BENCHMARK_RUN }];

        if (gitBranch) {
          queryText += ' AND c.source.gitBranch = @gitBranch';
          parameters.push({ name: '@gitBranch', value: gitBranch });
        }

        queryText += ' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit';
        parameters.push({ name: '@limit', value: limit });

        const { resources } = await container.items
          .query({ query: queryText, parameters })
          .fetchAll();

        // Filter by tags in memory (Cosmos DB doesn't easily support dynamic tag filtering)
        if (tags && Object.keys(tags).length > 0) {
          return resources.filter((run) => {
            for (const [key, value] of Object.entries(tags)) {
              if (run.tags?.[key] !== value) {
                return false;
              }
            }
            return true;
          });
        }

        return resources;
      } else {
        let runs = loadLocalResults().runs;

        if (gitBranch) {
          runs = runs.filter((r) => r.source?.gitBranch === gitBranch);
        }

        if (tags && Object.keys(tags).length > 0) {
          runs = runs.filter((run) => {
            for (const [key, value] of Object.entries(tags)) {
              if (run.tags?.[key] !== value) {
                return false;
              }
            }
            return true;
          });
        }

        // Sort by createdAt descending
        runs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return runs.slice(0, limit);
      }
    } catch (error) {
      log.errorWithStack('Failed to get recent runs', error);
      throw error;
    }
  }

  /**
   * Get the latest benchmark run
   *
   * @returns {Promise<Object|null>} Latest run or null
   */
  async getLatestRun() {
    const runs = await this.getRecentRuns({ limit: 1 });
    return runs.length > 0 ? runs[0] : null;
  }

  // ==================== Baseline Management ====================

  /**
   * Set a run as the baseline for comparison
   *
   * @param {string} runId - Run ID to set as baseline
   * @param {string} baselineName - Name for this baseline
   * @returns {Promise<Object>} Baseline document
   */
  async setBaseline(runId, baselineName = 'default') {
    await this._ensureInitialized();

    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const baselineId = `baseline_${baselineName}`;
    const timestamp = new Date().toISOString();

    const baselineDocument = {
      id: baselineId,
      runId: 'baselines', // Partition key for baselines
      docType: DOC_TYPES.BASELINE,
      name: baselineName,
      sourceRunId: runId,
      sourceRunTimestamp: run.timestamp,
      keyMetrics: run.summary?.keyMetrics || {},
      config: run.config,
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: CONFIG.SCHEMA_VERSION,
    };

    try {
      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        const { resource } = await container.items.upsert(baselineDocument);
        log.info('Baseline set', { baselineName, sourceRunId: runId });
        return resource;
      } else {
        const results = loadLocalResults();
        const existingIdx = results.baselines.findIndex((b) => b.name === baselineName);
        if (existingIdx >= 0) {
          results.baselines[existingIdx] = baselineDocument;
        } else {
          results.baselines.push(baselineDocument);
        }
        saveLocalResults(results);
        log.info('Baseline set locally', { baselineName, sourceRunId: runId });
        return baselineDocument;
      }
    } catch (error) {
      log.errorWithStack('Failed to set baseline', error);
      throw error;
    }
  }

  /**
   * Get the current baseline
   *
   * @param {string} baselineName - Baseline name (default: 'default')
   * @returns {Promise<Object|null>} Baseline document or null
   */
  async getBaseline(baselineName = 'default') {
    await this._ensureInitialized();

    const baselineId = `baseline_${baselineName}`;

    try {
      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        const { resource } = await container.item(baselineId, 'baselines').read();
        return resource;
      } else {
        const results = loadLocalResults();
        return results.baselines.find((b) => b.name === baselineName) || null;
      }
    } catch (error) {
      if (error.code === 404) {
        return null;
      }
      log.errorWithStack('Failed to get baseline', error);
      throw error;
    }
  }

  // ==================== Trend Analysis ====================

  /**
   * Get metric trends over time
   *
   * @param {string} metricName - Name of the metric to track
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of runs to include
   * @param {string} options.gitBranch - Filter by branch
   * @returns {Promise<Object>} Trend data with timestamps and values
   */
  async getMetricTrend(metricName, options = {}) {
    await this._ensureInitialized();

    const { limit = 20, gitBranch = null } = options;

    const runs = await this.getRecentRuns({ limit, gitBranch });

    // Reverse to get chronological order
    runs.reverse();

    const trend = {
      metricName,
      dataPoints: [],
      statistics: {
        min: Infinity,
        max: -Infinity,
        mean: 0,
        stdDev: 0,
        latest: null,
        trend: 'stable', // 'improving', 'degrading', 'stable'
      },
    };

    const values = [];

    for (const run of runs) {
      const value = run.summary?.keyMetrics?.[metricName];
      if (value !== undefined && value !== null) {
        trend.dataPoints.push({
          runId: run.runId,
          timestamp: run.timestamp,
          value,
          gitCommit: run.source?.gitCommit,
        });
        values.push(value);
      }
    }

    if (values.length > 0) {
      trend.statistics.min = Math.min(...values);
      trend.statistics.max = Math.max(...values);
      trend.statistics.mean = values.reduce((a, b) => a + b, 0) / values.length;
      trend.statistics.latest = values[values.length - 1];

      // Calculate standard deviation
      const squaredDiffs = values.map((v) => Math.pow(v - trend.statistics.mean, 2));
      trend.statistics.stdDev = Math.sqrt(
        squaredDiffs.reduce((a, b) => a + b, 0) / values.length
      );

      // Determine trend direction (compare recent 3 vs previous 3)
      if (values.length >= 6) {
        const recent = values.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const previous = values.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
        const diff = recent - previous;
        const threshold = trend.statistics.stdDev * 0.5;

        if (diff > threshold) {
          trend.statistics.trend = 'improving';
        } else if (diff < -threshold) {
          trend.statistics.trend = 'degrading';
        }
      }
    }

    return trend;
  }

  /**
   * Get all metric trends in one call
   *
   * @param {Object} options - Query options
   * @returns {Promise<Object>} All metric trends
   */
  async getAllMetricTrends(options = {}) {
    const metricNames = [
      'mrr',
      'map',
      'answerQuality',
      'groundingScore',
      'citationAccuracy',
      'entityF1',
      'entityPrecision',
      'entityRecall',
      'relationshipF1',
      'directionAccuracy',
    ];

    const trends = {};

    for (const metricName of metricNames) {
      trends[metricName] = await this.getMetricTrend(metricName, options);
    }

    return trends;
  }

  // ==================== Comparison ====================

  /**
   * Compare two runs and identify regressions
   *
   * @param {string} runId1 - First run ID (usually baseline)
   * @param {string} runId2 - Second run ID (usually current)
   * @param {Object} options - Comparison options
   * @param {number} options.regressionThreshold - Threshold for detecting regression (default: 0.05)
   * @returns {Promise<Object>} Comparison result
   */
  async compareRuns(runId1, runId2, options = {}) {
    await this._ensureInitialized();

    const { regressionThreshold = 0.05 } = options;

    const [run1, run2] = await Promise.all([this.getRun(runId1), this.getRun(runId2)]);

    if (!run1) {
      throw new Error(`Run not found: ${runId1}`);
    }
    if (!run2) {
      throw new Error(`Run not found: ${runId2}`);
    }

    const comparison = {
      id: `comparison_${Date.now()}`,
      runId: 'comparisons', // Partition key for comparisons
      docType: DOC_TYPES.COMPARISON,
      baselineRun: {
        runId: run1.runId,
        timestamp: run1.timestamp,
        name: run1.name,
      },
      currentRun: {
        runId: run2.runId,
        timestamp: run2.timestamp,
        name: run2.name,
      },
      metrics: {},
      regressions: [],
      improvements: [],
      unchanged: [],
      summary: {
        regressionCount: 0,
        improvementCount: 0,
        unchangedCount: 0,
        hasRegressions: false,
      },
      createdAt: new Date().toISOString(),
      schemaVersion: CONFIG.SCHEMA_VERSION,
    };

    // Compare key metrics
    const metrics1 = run1.summary?.keyMetrics || {};
    const metrics2 = run2.summary?.keyMetrics || {};
    const allMetrics = new Set([...Object.keys(metrics1), ...Object.keys(metrics2)]);

    for (const metricName of allMetrics) {
      const value1 = metrics1[metricName];
      const value2 = metrics2[metricName];

      if (value1 === undefined || value2 === undefined) {
        continue;
      }

      const diff = value2 - value1;
      const percentChange = value1 !== 0 ? (diff / value1) * 100 : 0;

      comparison.metrics[metricName] = {
        baseline: value1,
        current: value2,
        diff,
        percentChange,
      };

      // Determine if this is a regression, improvement, or unchanged
      // For most metrics, higher is better
      if (diff < -regressionThreshold) {
        comparison.regressions.push({
          metric: metricName,
          ...comparison.metrics[metricName],
        });
        comparison.summary.regressionCount++;
      } else if (diff > regressionThreshold) {
        comparison.improvements.push({
          metric: metricName,
          ...comparison.metrics[metricName],
        });
        comparison.summary.improvementCount++;
      } else {
        comparison.unchanged.push({
          metric: metricName,
          ...comparison.metrics[metricName],
        });
        comparison.summary.unchangedCount++;
      }
    }

    comparison.summary.hasRegressions = comparison.summary.regressionCount > 0;

    return comparison;
  }

  /**
   * Compare current run against baseline
   *
   * @param {string} runId - Current run ID
   * @param {string} baselineName - Baseline name (default: 'default')
   * @returns {Promise<Object>} Comparison result
   */
  async compareToBaseline(runId, baselineName = 'default') {
    const baseline = await this.getBaseline(baselineName);
    if (!baseline) {
      throw new Error(`Baseline not found: ${baselineName}`);
    }

    return this.compareRuns(baseline.sourceRunId, runId);
  }

  // ==================== Utility Methods ====================

  /**
   * Get storage statistics
   *
   * @returns {Promise<Object>} Storage statistics
   */
  async getStats() {
    await this._ensureInitialized();

    try {
      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        const queries = [
          {
            query: 'SELECT VALUE COUNT(1) FROM c WHERE c.docType = @docType',
            parameters: [{ name: '@docType', value: DOC_TYPES.BENCHMARK_RUN }],
          },
          {
            query: 'SELECT VALUE COUNT(1) FROM c WHERE c.docType = @docType',
            parameters: [{ name: '@docType', value: DOC_TYPES.BASELINE }],
          },
        ];

        const [runCount, baselineCount] = await Promise.all(
          queries.map(async (q) => {
            const { resources } = await container.items.query(q).fetchAll();
            return resources[0] || 0;
          })
        );

        const latestRun = await this.getLatestRun();

        return {
          backend: STORAGE_BACKENDS.COSMOS_DB,
          runCount,
          baselineCount,
          latestRunId: latestRun?.runId || null,
          latestRunTimestamp: latestRun?.timestamp || null,
          latestOverallPassed: latestRun?.summary?.overallPassed || null,
          schemaVersion: CONFIG.SCHEMA_VERSION,
        };
      } else {
        const results = loadLocalResults();
        const latestRun =
          results.runs.length > 0
            ? results.runs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
            : null;

        return {
          backend: STORAGE_BACKENDS.LOCAL_JSON,
          storagePath: CONFIG.LOCAL_STORAGE_PATH,
          runCount: results.runs.length,
          baselineCount: results.baselines.length,
          latestRunId: latestRun?.runId || null,
          latestRunTimestamp: latestRun?.timestamp || null,
          latestOverallPassed: latestRun?.summary?.overallPassed || null,
          schemaVersion: CONFIG.SCHEMA_VERSION,
        };
      }
    } catch (error) {
      log.errorWithStack('Failed to get storage stats', error);
      throw error;
    }
  }

  /**
   * Delete a benchmark run
   *
   * @param {string} runId - Run ID to delete
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteRun(runId) {
    await this._ensureInitialized();

    try {
      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        await container.item(runId, runId).delete();
        log.info('Benchmark run deleted', { runId });
        return true;
      } else {
        const results = loadLocalResults();
        const idx = results.runs.findIndex((r) => r.runId === runId);
        if (idx >= 0) {
          results.runs.splice(idx, 1);
          saveLocalResults(results);
          log.info('Benchmark run deleted locally', { runId });
          return true;
        }
        return false;
      }
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
      log.errorWithStack('Failed to delete benchmark run', error);
      throw error;
    }
  }

  /**
   * Check if storage is healthy and accessible
   *
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      await this._ensureInitialized();

      if (this.backend === STORAGE_BACKENDS.COSMOS_DB) {
        const { resources } = await container.items
          .query({
            query: 'SELECT VALUE 1',
            parameters: [],
          })
          .fetchAll();

        return {
          healthy: true,
          backend: STORAGE_BACKENDS.COSMOS_DB,
          containerId: CONFIG.CONTAINER_ID,
          databaseId: CONFIG.DATABASE_ID,
          timestamp: new Date().toISOString(),
        };
      } else {
        // Check if local storage is accessible
        const testFile = path.join(CONFIG.LOCAL_STORAGE_PATH, '.health-check');
        fs.writeFileSync(testFile, new Date().toISOString());
        fs.unlinkSync(testFile);

        return {
          healthy: true,
          backend: STORAGE_BACKENDS.LOCAL_JSON,
          storagePath: CONFIG.LOCAL_STORAGE_PATH,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Singleton instance
let instance = null;

function getResultsStorageService() {
  if (!instance) {
    instance = new ResultsStorageService();
  }
  return instance;
}

module.exports = {
  ResultsStorageService,
  getResultsStorageService,
  CONFIG,
  DOC_TYPES,
  STORAGE_BACKENDS,
};
