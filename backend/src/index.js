// Load environment variables first
require('dotenv').config();

// Validate environment configuration before initializing services
const { validateAndReport, getConfigurationSummary } = require('./utils/env-validator');
const envValid = validateAndReport({
  exitOnError: process.env.NODE_ENV === 'production', // Only exit on error in production
  logWarnings: true,
});

// Initialize Application Insights first (before other imports for best auto-collection)
const { initializeTelemetry, telemetryMiddleware, trackException, flushTelemetry } = require('./utils/telemetry');
initializeTelemetry();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger');
const { authenticateJwt } = require('./middleware/auth');
const { log, httpLogger, logStartup } = require('./utils/logger');
const {
  generalLimiter,
  // Note: Per-user rate limiters are now used from user-rate-limit-service.js (F5.3.5)
} = require('./middleware/rate-limit');
const {
  validateDocumentId,
  validateGraphRAGQuery,
  validateDocumentUpload,
  validateEntityAction,
  validateBatchRejection,
} = require('./middleware/validation');
const { uploadBuffer, deleteBlob, getBlobNameFromUrl } = require('./storage/blob');
const {
  createDocument,
  listDocuments,
  listDocumentsPaginated,
  getDocumentById,
  updateDocument,
  deleteDocument,
} = require('./storage/cosmos');
const { paginationMiddleware, paginateArray, parsePaginationParams } = require('./services/pagination-service');
const { getSearchService } = require('./services/search-service');
const { getAuditPersistenceService, startAuditRetentionScheduler } = require('./services/audit-persistence-service');
const { getAuditExportService, EXPORT_FORMATS } = require('./services/audit-export-service');
const { DocumentProcessor } = require('./pipelines/document-processor');
const { getGraphRAGQueryPipeline } = require('./pipelines/graphrag-query');
const { getGraphService } = require('./services/graph-service');
const { LeaderboardService } = require('./services/leaderboard-service');
const { getStagingService } = require('./services/staging-service');
const { getGraphRAGService } = require('./services/graph-rag-service');
const { getEntityResolutionService } = require('./services/entity-resolution-service');
const { getCommunitySummaryService } = require('./services/community-summary-service');
const { getPersonaService } = require('./personas/index');
const { initializeOntologyService } = require('./services/ontology-service');
const { getCircuitBreakerService } = require('./services/circuit-breaker-service');
const { getLatencyBudgetService, OPERATION_TYPES: LATENCY_OPERATION_TYPES } = require('./services/latency-budget-service');
const { getPerformanceDashboardService, throughputMiddleware, HEALTH_STATUS: PERF_HEALTH_STATUS } = require('./services/performance-dashboard-service');
const { getPromptInjectionService } = require('./services/prompt-injection-service');
const { promptInjectionGuard } = require('./middleware/prompt-injection');
const { getFeatureFlags, isFeatureEnabled, FLAG_CATEGORIES } = require('./services/feature-flags-service');
const { getConfigurationService, CONFIG_CATEGORIES, CONFIG_TYPES } = require('./services/configuration-service');
const {
  userGeneralLimiter,
  userQueryLimiter,
  userUploadLimiter,
  userProcessingLimiter,
  userStrictLimiter,
  getRateLimitStats,
  getUserRateLimitStats,
  resetRateLimitStats,
  getRateLimitConfig,
} = require('./services/user-rate-limit-service');
const { calculatePageRank, getTopEntitiesByPageRank } = require('./algorithms/pagerank');
const { calculateBetweenness, getTopEntitiesByBetweenness } = require('./algorithms/betweenness');
const {
  getUpstreamDependencies,
  getDownstreamImpact,
  analyzeImpact,
  simulateRemoval,
  getImpactAnalysisWithCache,
} = require('./services/impact-analysis-service');
const {
  getHealthCheckService,
  HealthStatus,
  Dependencies: HealthDependencies,
} = require('./services/health-check-service');

const app = express();
const PORT = process.env.PORT || process.env.API_PORT || 8080; // Port configuration

// Configure multer for file uploads (memory, then upload to Blob Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only specific file types
    const allowedTypes = ['.pdf', '.docx', '.pptx', '.xlsx', '.vsdx', '.doc', '.ppt', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Application Insights telemetry
app.use(telemetryMiddleware);

// Performance dashboard throughput tracking (F5.2.7)
app.use(throughputMiddleware());

// HTTP request logging
app.use(httpLogger);

// Apply general rate limiting to all API routes (IP-based, first line of defense)
app.use('/api', generalLimiter);

// Require Entra ID JWT for API routes
app.use('/api', authenticateJwt);

// Apply per-user rate limiting after authentication (F5.3.5)
// This provides finer-grained control with role-based multipliers
app.use('/api', userGeneralLimiter);

// Apply strict rate limiting to auth endpoints (combined user+IP)
app.use('/api/auth', userStrictLimiter);

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Business Process Knowledge Platform API',
}));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check if the API server is running and healthy
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /health/detailed:
 *   get:
 *     summary: Detailed health check
 *     description: Check API health with configuration status
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Detailed health information
 */
app.get('/health/detailed', (req, res) => {
  const configSummary = getConfigurationSummary();
  const allConfigured = Object.values(configSummary).every((s) => s.status === 'configured');

  res.json({
    status: allConfigured ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    configuration: configSummary,
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ==================== Comprehensive Health Checks (FC.7) ====================

/**
 * @swagger
 * /health/live:
 *   get:
 *     summary: Kubernetes liveness probe
 *     description: Check if the process is alive (always returns 200 if the server is running)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Process is alive
 */
app.get('/health/live', (req, res) => {
  const healthService = getHealthCheckService();
  res.json(healthService.getLiveness());
});

/**
 * @swagger
 * /health/ready:
 *   get:
 *     summary: Kubernetes readiness probe
 *     description: Check if the application is ready to serve traffic
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application is ready
 *       503:
 *         description: Application is not ready
 */
app.get('/health/ready', async (req, res) => {
  try {
    const healthService = getHealthCheckService();
    const readiness = await healthService.getReadiness();

    if (readiness.ready) {
      res.json(readiness);
    } else {
      res.status(503).json(readiness);
    }
  } catch (error) {
    res.status(503).json({
      ready: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /health/dependencies:
 *   get:
 *     summary: Check all dependency health
 *     description: Returns health status of all external dependencies (Cosmos DB, OpenAI, Search, Gremlin, Blob Storage)
 *     tags: [Health]
 *     parameters:
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *         description: Force refresh (bypass cache)
 *     responses:
 *       200:
 *         description: Dependency health status
 */
app.get('/health/dependencies', async (req, res) => {
  try {
    const healthService = getHealthCheckService();
    const useCache = req.query.refresh !== 'true';
    const result = await healthService.checkAll(useCache);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /health/dependencies/{dependency}:
 *   get:
 *     summary: Check specific dependency health
 *     description: Returns health status of a specific dependency
 *     tags: [Health]
 *     parameters:
 *       - in: path
 *         name: dependency
 *         required: true
 *         schema:
 *           type: string
 *           enum: [cosmos_db, gremlin, openai, azure_search, blob_storage, doc_intelligence]
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *         description: Force refresh (bypass cache)
 *     responses:
 *       200:
 *         description: Dependency health status
 *       400:
 *         description: Invalid dependency name
 */
app.get('/health/dependencies/:dependency', async (req, res) => {
  try {
    const healthService = getHealthCheckService();
    const useCache = req.query.refresh !== 'true';
    const { dependency } = req.params;

    let result;
    switch (dependency) {
      case HealthDependencies.COSMOS_DB:
        result = await healthService.checkCosmosDb(useCache);
        break;
      case HealthDependencies.GREMLIN:
        result = await healthService.checkGremlin(useCache);
        break;
      case HealthDependencies.OPENAI:
        result = await healthService.checkOpenAI(useCache);
        break;
      case HealthDependencies.AZURE_SEARCH:
        result = await healthService.checkAzureSearch(useCache);
        break;
      case HealthDependencies.BLOB_STORAGE:
        result = await healthService.checkBlobStorage(useCache);
        break;
      case HealthDependencies.DOC_INTELLIGENCE:
        result = await healthService.checkDocIntelligence(useCache);
        break;
      default:
        return res.status(400).json({
          error: 'Invalid dependency',
          validDependencies: Object.values(HealthDependencies),
        });
    }

    res.json({ dependency, ...result });
  } catch (error) {
    res.status(500).json({
      dependency: req.params.dependency,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /health/summary:
 *   get:
 *     summary: Get comprehensive health summary
 *     description: Returns health status with circuit breaker integration, cache stats, and startup status
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Comprehensive health summary
 */
app.get('/health/summary', async (req, res) => {
  try {
    const healthService = getHealthCheckService();
    const summary = await healthService.getHealthSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /health/history:
 *   get:
 *     summary: Get health check history
 *     description: Returns recent health check results for trend analysis
 *     tags: [Health]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of entries to return
 *     responses:
 *       200:
 *         description: Health check history
 */
app.get('/health/history', (req, res) => {
  const healthService = getHealthCheckService();
  const limit = parseInt(req.query.limit) || 20;
  const history = healthService.getHistory(limit);
  res.json({
    count: history.length,
    history,
  });
});

/**
 * @swagger
 * /health/startup:
 *   get:
 *     summary: Get startup validation status
 *     description: Returns the result of startup health validation
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Startup status
 */
app.get('/health/startup', (req, res) => {
  const healthService = getHealthCheckService();
  res.json(healthService.getStartupStatus());
});

/**
 * @swagger
 * /health/cache:
 *   get:
 *     summary: Get health check cache statistics
 *     description: Returns cache stats for health check results
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Cache statistics
 */
app.get('/health/cache', (req, res) => {
  const healthService = getHealthCheckService();
  res.json(healthService.getCacheStats());
});

/**
 * @swagger
 * /health/cache:
 *   delete:
 *     summary: Clear health check cache
 *     description: Clears cached health check results
 *     tags: [Health]
 *     parameters:
 *       - in: query
 *         name: dependency
 *         schema:
 *           type: string
 *         description: Optional specific dependency to clear
 *     responses:
 *       200:
 *         description: Cache cleared
 */
app.delete('/health/cache', (req, res) => {
  const healthService = getHealthCheckService();
  healthService.clearCache(req.query.dependency || null);
  res.json({
    success: true,
    message: req.query.dependency
      ? `Cache cleared for ${req.query.dependency}`
      : 'All health check cache cleared',
  });
});

/**
 * @swagger
 * /health/config:
 *   get:
 *     summary: Get health check configuration
 *     description: Returns current health check configuration
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Health check configuration
 */
app.get('/health/config', (req, res) => {
  const healthService = getHealthCheckService();
  res.json(healthService.getConfig());
});

// ==================== Circuit Breaker Monitoring ====================

/**
 * @swagger
 * /api/circuit-breakers:
 *   get:
 *     summary: Get circuit breaker status
 *     description: Returns status of all circuit breakers for external service monitoring
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Circuit breaker status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                   description: Whether circuit breakers are enabled
 *                 breakers:
 *                   type: object
 *                   description: Status of each circuit breaker
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     open:
 *                       type: integer
 *                     closed:
 *                       type: integer
 *                     halfOpen:
 *                       type: integer
 */
app.get('/api/circuit-breakers', (req, res) => {
  const cbService = getCircuitBreakerService();
  const status = cbService.getStatus();

  res.json({
    ...status,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/circuit-breakers/{service}:
 *   get:
 *     summary: Get circuit breaker status for a specific service
 *     description: Returns status of circuit breakers for a specific external service
 *     tags: [Health]
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *           enum: [openai, search, cosmos, gremlin, docIntelligence, blob]
 *         description: External service name
 *     responses:
 *       200:
 *         description: Service circuit breaker status
 *       404:
 *         description: Service not found or no breakers registered
 */
app.get('/api/circuit-breakers/:service', (req, res) => {
  const cbService = getCircuitBreakerService();
  const status = cbService.getServiceStatus(req.params.service);

  if (!status) {
    return res.status(404).json({
      error: 'Service not found or no circuit breakers registered',
      service: req.params.service,
    });
  }

  res.json({
    ...status,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/circuit-breakers/{key}/reset:
 *   post:
 *     summary: Reset a circuit breaker
 *     description: Manually reset a circuit breaker to closed state
 *     tags: [Health]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Circuit breaker key (service:operation)
 *     responses:
 *       200:
 *         description: Circuit breaker reset successfully
 *       404:
 *         description: Circuit breaker not found
 */
app.post('/api/circuit-breakers/:key/reset', authenticateJwt, (req, res) => {
  const cbService = getCircuitBreakerService();
  const success = cbService.reset(req.params.key);

  if (!success) {
    return res.status(404).json({
      error: 'Circuit breaker not found',
      key: req.params.key,
    });
  }

  log.info('Circuit breaker manually reset', {
    key: req.params.key,
    userId: req.user?.id,
  });

  res.json({
    success: true,
    message: 'Circuit breaker reset to closed state',
    key: req.params.key,
  });
});

/**
 * @swagger
 * /api/circuit-breakers/reset-all:
 *   post:
 *     summary: Reset all circuit breakers
 *     description: Manually reset all circuit breakers to closed state (admin only)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: All circuit breakers reset successfully
 */
app.post('/api/circuit-breakers/reset-all', authenticateJwt, (req, res) => {
  const cbService = getCircuitBreakerService();
  cbService.resetAll();

  log.info('All circuit breakers manually reset', {
    userId: req.user?.id,
  });

  res.json({
    success: true,
    message: 'All circuit breakers reset to closed state',
  });
});

/**
 * @swagger
 * /api/circuit-breakers/open:
 *   get:
 *     summary: Get list of open (failing) circuit breakers
 *     description: Returns list of circuit breakers currently in open state
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: List of open circuits
 */
app.get('/api/circuit-breakers/open', (req, res) => {
  const cbService = getCircuitBreakerService();
  const openCircuits = cbService.getOpenCircuits();

  res.json({
    hasOpenCircuits: openCircuits.length > 0,
    openCircuits,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Latency Budget Endpoints (F5.2.5)
// ============================================================================

/**
 * @swagger
 * /api/latency-budgets:
 *   get:
 *     summary: Get overall latency budget status
 *     description: Returns health status and metrics for all tracked operations
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Latency budget status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 healthy:
 *                   type: boolean
 *                 operations:
 *                   type: object
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     healthy:
 *                       type: integer
 *                     unhealthy:
 *                       type: integer
 */
app.get('/api/latency-budgets', (req, res) => {
  const budgetService = getLatencyBudgetService();
  const status = budgetService.getStatus();

  res.json(status);
});

/**
 * @swagger
 * /api/latency-budgets/stats:
 *   get:
 *     summary: Get aggregated latency statistics
 *     description: Returns detailed statistics for all operations including percentiles
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Aggregated latency statistics
 */
app.get('/api/latency-budgets/stats', (req, res) => {
  const budgetService = getLatencyBudgetService();
  const stats = budgetService.getAggregatedStats();

  res.json(stats);
});

/**
 * @swagger
 * /api/latency-budgets/health:
 *   get:
 *     summary: Get latency budget health summary
 *     description: Returns a simplified health summary suitable for dashboards
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Health summary
 */
app.get('/api/latency-budgets/health', (req, res) => {
  const budgetService = getLatencyBudgetService();
  const health = budgetService.getHealthSummary();

  res.json(health);
});

/**
 * @swagger
 * /api/latency-budgets/operations:
 *   get:
 *     summary: Get list of tracked operation types
 *     description: Returns list of all operation types being tracked
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: List of operation types
 */
app.get('/api/latency-budgets/operations', (req, res) => {
  const budgetService = getLatencyBudgetService();
  const operations = budgetService.getOperationTypes();

  res.json({
    operations,
    count: operations.length,
  });
});

/**
 * @swagger
 * /api/latency-budgets/{operation}:
 *   get:
 *     summary: Get metrics for a specific operation
 *     description: Returns detailed metrics and percentiles for a specific operation type
 *     tags: [Performance]
 *     parameters:
 *       - in: path
 *         name: operation
 *         required: true
 *         schema:
 *           type: string
 *           enum: [query, processing, graph_traversal, entity_resolution, search, openai]
 *         description: Operation type
 *     responses:
 *       200:
 *         description: Operation metrics
 *       404:
 *         description: Operation not found
 */
app.get('/api/latency-budgets/:operation', (req, res) => {
  const budgetService = getLatencyBudgetService();
  const metrics = budgetService.getOperationMetrics(req.params.operation);

  if (!metrics) {
    return res.status(404).json({
      error: 'Operation not found',
      operation: req.params.operation,
      availableOperations: budgetService.getOperationTypes(),
    });
  }

  res.json(metrics);
});

/**
 * @swagger
 * /api/latency-budgets/{operation}/status:
 *   get:
 *     summary: Get health status for a specific operation
 *     description: Returns simplified health status for an operation
 *     tags: [Performance]
 *     parameters:
 *       - in: path
 *         name: operation
 *         required: true
 *         schema:
 *           type: string
 *         description: Operation type
 *     responses:
 *       200:
 *         description: Operation health status
 *       404:
 *         description: Operation not found
 */
app.get('/api/latency-budgets/:operation/status', (req, res) => {
  const budgetService = getLatencyBudgetService();
  const status = budgetService.getOperationStatus(req.params.operation);

  if (!status) {
    return res.status(404).json({
      error: 'Operation not found',
      operation: req.params.operation,
    });
  }

  res.json(status);
});

/**
 * @swagger
 * /api/latency-budgets/{operation}/reset:
 *   post:
 *     summary: Reset metrics for a specific operation
 *     description: Clears all collected metrics for an operation (requires authentication)
 *     tags: [Performance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: operation
 *         required: true
 *         schema:
 *           type: string
 *         description: Operation type
 *     responses:
 *       200:
 *         description: Metrics reset successfully
 *       404:
 *         description: Operation not found
 */
app.post('/api/latency-budgets/:operation/reset', authenticateJwt, (req, res) => {
  const budgetService = getLatencyBudgetService();
  const success = budgetService.resetOperation(req.params.operation);

  if (!success) {
    return res.status(404).json({
      error: 'Operation not found',
      operation: req.params.operation,
    });
  }

  log.info('Latency budget metrics reset for operation', {
    operation: req.params.operation,
    userId: req.user?.id,
  });

  res.json({
    success: true,
    message: `Metrics reset for operation: ${req.params.operation}`,
  });
});

/**
 * @swagger
 * /api/latency-budgets/reset-all:
 *   post:
 *     summary: Reset all latency metrics
 *     description: Clears all collected metrics for all operations (requires authentication)
 *     tags: [Performance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All metrics reset successfully
 */
app.post('/api/latency-budgets/reset-all', authenticateJwt, (req, res) => {
  const budgetService = getLatencyBudgetService();
  budgetService.resetAll();

  log.info('All latency budget metrics reset', {
    userId: req.user?.id,
  });

  res.json({
    success: true,
    message: 'All latency budget metrics reset',
  });
});

/**
 * @swagger
 * /api/latency-budgets/record:
 *   post:
 *     summary: Manually record a latency measurement
 *     description: Record a latency measurement for a specific operation (for external integrations)
 *     tags: [Performance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - operation
 *               - latencyMs
 *             properties:
 *               operation:
 *                 type: string
 *                 description: Operation type
 *               latencyMs:
 *                 type: number
 *                 description: Latency in milliseconds
 *               context:
 *                 type: object
 *                 description: Additional context for the measurement
 *     responses:
 *       200:
 *         description: Measurement recorded
 *       400:
 *         description: Invalid request
 */
app.post('/api/latency-budgets/record', (req, res) => {
  const { operation, latencyMs, context = {} } = req.body;

  if (!operation || typeof latencyMs !== 'number' || latencyMs < 0) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'operation (string) and latencyMs (positive number) are required',
    });
  }

  const budgetService = getLatencyBudgetService();
  const result = budgetService.recordLatency(operation, latencyMs, context);

  res.json(result);
});

// ============================================================================
// Performance Dashboard Endpoints (F5.2.7)
// ============================================================================

/**
 * @swagger
 * /api/performance:
 *   get:
 *     summary: Get full performance dashboard
 *     description: Returns comprehensive performance metrics including throughput, latency, circuit breakers, cache, and health status
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Full dashboard data with sparklines and history
 */
app.get('/api/performance', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const dashboard = dashboardService.getDashboard();

  res.json(dashboard);
});

/**
 * @swagger
 * /api/performance/health:
 *   get:
 *     summary: Get overall system health status
 *     description: Returns a lightweight health status with score and any active issues
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, warning, critical, unknown]
 *                 score:
 *                   type: number
 *                 issues:
 *                   type: array
 */
app.get('/api/performance/health', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const health = dashboardService.getHealthStatus();

  res.json(health);
});

/**
 * @swagger
 * /api/performance/throughput:
 *   get:
 *     summary: Get throughput metrics
 *     description: Returns requests per second, error rates, and throughput history with sparkline
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Throughput metrics
 */
app.get('/api/performance/throughput', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const throughput = dashboardService.getThroughput();

  res.json(throughput);
});

/**
 * @swagger
 * /api/performance/latency:
 *   get:
 *     summary: Get aggregated latency metrics
 *     description: Returns latency metrics from all tracked operations
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Latency metrics
 */
app.get('/api/performance/latency', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const latency = dashboardService.getLatencyMetrics();

  res.json(latency);
});

/**
 * @swagger
 * /api/performance/circuit-breakers:
 *   get:
 *     summary: Get circuit breaker metrics for dashboard
 *     description: Returns circuit breaker status summary for the performance dashboard
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Circuit breaker metrics
 */
app.get('/api/performance/circuit-breakers', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const cbMetrics = dashboardService.getCircuitBreakerMetrics();

  res.json(cbMetrics);
});

/**
 * @swagger
 * /api/performance/cache:
 *   get:
 *     summary: Get cache metrics for dashboard
 *     description: Returns cache hit rates and utilization metrics
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Cache metrics
 */
app.get('/api/performance/cache', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const cacheMetrics = dashboardService.getCacheMetrics();

  res.json(cacheMetrics);
});

/**
 * @swagger
 * /api/performance/rate-limits:
 *   get:
 *     summary: Get rate limit metrics for dashboard
 *     description: Returns rate limit statistics for the performance dashboard
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: Rate limit metrics
 */
app.get('/api/performance/rate-limits', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const rateLimitMetrics = dashboardService.getRateLimitMetrics();

  res.json(rateLimitMetrics);
});

/**
 * @swagger
 * /api/performance/history:
 *   get:
 *     summary: Get historical performance data
 *     description: Returns performance snapshots for a given time range
 *     tags: [Performance]
 *     parameters:
 *       - in: query
 *         name: startTime
 *         schema:
 *           type: integer
 *         description: Start timestamp in milliseconds (default: 1 hour ago)
 *       - in: query
 *         name: endTime
 *         schema:
 *           type: integer
 *         description: End timestamp in milliseconds (default: now)
 *     responses:
 *       200:
 *         description: Historical performance data
 */
app.get('/api/performance/history', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const startTime = parseInt(req.query.startTime) || Date.now() - 3600000; // Default: 1 hour ago
  const endTime = parseInt(req.query.endTime) || Date.now();

  const history = dashboardService.getHistory(startTime, endTime);

  res.json(history);
});

/**
 * @swagger
 * /api/performance/report:
 *   get:
 *     summary: Get ASCII text report
 *     description: Returns a formatted text report of the performance dashboard
 *     tags: [Performance]
 *     produces:
 *       - text/plain
 *     responses:
 *       200:
 *         description: ASCII performance report
 */
app.get('/api/performance/report', (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  const report = dashboardService.generateTextReport();

  res.type('text/plain').send(report);
});

/**
 * @swagger
 * /api/performance/reset:
 *   post:
 *     summary: Reset performance metrics
 *     description: Clears all collected performance metrics and history (requires authentication)
 *     tags: [Performance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Metrics reset successfully
 */
app.post('/api/performance/reset', authenticateJwt, (req, res) => {
  const dashboardService = getPerformanceDashboardService();
  dashboardService.reset();

  log.info('Performance dashboard metrics reset', { userId: req.user?.oid });

  res.json({
    success: true,
    message: 'Performance metrics reset',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Feature Flags Endpoints (FC.1)
// ============================================================================

/**
 * @swagger
 * /api/feature-flags:
 *   get:
 *     summary: Get all feature flags
 *     description: Returns the state of all feature flags. Optionally filter by category.
 *     tags: [Configuration]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category (security, performance, ingestion, graphrag, evaluation, ui, experimental)
 *     responses:
 *       200:
 *         description: Feature flags state
 */
app.get('/api/feature-flags', (req, res) => {
  const flagsService = getFeatureFlags();
  const { category } = req.query;

  const flags = category ? flagsService.getFlags(category) : flagsService.getFlags();

  res.json({
    flags,
    categories: flagsService.getCategories(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/feature-flags/stats:
 *   get:
 *     summary: Get feature flags statistics
 *     description: Returns statistics about feature flag states
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Feature flags statistics
 */
app.get('/api/feature-flags/stats', (req, res) => {
  const flagsService = getFeatureFlags();
  const stats = flagsService.getStatistics();

  res.json({
    ...stats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/feature-flags/by-category:
 *   get:
 *     summary: Get feature flags grouped by category
 *     description: Returns all feature flags organized by their category
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Feature flags by category
 */
app.get('/api/feature-flags/by-category', (req, res) => {
  const flagsService = getFeatureFlags();
  const flagsByCategory = flagsService.getFlagsByCategory();

  res.json({
    flagsByCategory,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/feature-flags/{key}:
 *   get:
 *     summary: Get a specific feature flag
 *     description: Returns the state of a specific feature flag
 *     tags: [Configuration]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The feature flag key
 *     responses:
 *       200:
 *         description: Feature flag state
 *       404:
 *         description: Feature flag not found
 */
app.get('/api/feature-flags/:key', (req, res) => {
  const flagsService = getFeatureFlags();
  const flag = flagsService.getFlag(req.params.key);

  if (!flag) {
    return res.status(404).json({
      error: 'Feature flag not found',
      key: req.params.key,
    });
  }

  res.json({
    flag,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/feature-flags/{key}/enabled:
 *   get:
 *     summary: Check if a feature flag is enabled
 *     description: Returns a simple boolean indicating if the flag is enabled
 *     tags: [Configuration]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The feature flag key
 *     responses:
 *       200:
 *         description: Feature flag enabled status
 *       404:
 *         description: Feature flag not found
 */
app.get('/api/feature-flags/:key/enabled', (req, res) => {
  const flagsService = getFeatureFlags();

  if (!flagsService.hasFlag(req.params.key)) {
    return res.status(404).json({
      error: 'Feature flag not found',
      key: req.params.key,
    });
  }

  res.json({
    key: req.params.key,
    enabled: flagsService.isEnabled(req.params.key),
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/feature-flags/{key}/override:
 *   post:
 *     summary: Set a runtime override for a feature flag
 *     description: Temporarily override a feature flag value (does not persist across restarts)
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The feature flag key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *             required:
 *               - enabled
 *     responses:
 *       200:
 *         description: Override set successfully
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Feature flag not found
 */
app.post('/api/feature-flags/:key/override', authenticateJwt, (req, res) => {
  const flagsService = getFeatureFlags();
  const { key } = req.params;
  const { enabled } = req.body;

  if (!flagsService.hasFlag(key)) {
    return res.status(404).json({
      error: 'Feature flag not found',
      key,
    });
  }

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({
      error: 'Invalid request: enabled must be a boolean',
    });
  }

  const previousState = flagsService.getFlag(key);
  flagsService.setOverride(key, enabled);
  const newState = flagsService.getFlag(key);

  log.info('Feature flag override set via API', {
    key,
    previousEnabled: previousState.enabled,
    newEnabled: newState.enabled,
    userId: req.user?.id,
  });

  res.json({
    success: true,
    key,
    previousEnabled: previousState.enabled,
    newEnabled: newState.enabled,
    message: `Feature flag ${key} override set to ${enabled}`,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/feature-flags/{key}/override:
 *   delete:
 *     summary: Clear a runtime override for a feature flag
 *     description: Remove a temporary override, reverting to the default or environment value
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The feature flag key
 *     responses:
 *       200:
 *         description: Override cleared successfully
 *       404:
 *         description: Feature flag not found
 */
app.delete('/api/feature-flags/:key/override', authenticateJwt, (req, res) => {
  const flagsService = getFeatureFlags();
  const { key } = req.params;

  if (!flagsService.hasFlag(key)) {
    return res.status(404).json({
      error: 'Feature flag not found',
      key,
    });
  }

  const previousState = flagsService.getFlag(key);
  flagsService.clearOverride(key);
  const newState = flagsService.getFlag(key);

  log.info('Feature flag override cleared via API', {
    key,
    previousEnabled: previousState.enabled,
    newEnabled: newState.enabled,
    userId: req.user?.id,
  });

  res.json({
    success: true,
    key,
    previousEnabled: previousState.enabled,
    newEnabled: newState.enabled,
    message: `Feature flag ${key} override cleared`,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/feature-flags/overrides:
 *   delete:
 *     summary: Clear all runtime overrides
 *     description: Remove all temporary overrides, reverting all flags to defaults or environment values
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All overrides cleared successfully
 */
app.delete('/api/feature-flags/overrides', authenticateJwt, (req, res) => {
  const flagsService = getFeatureFlags();
  const statsBefore = flagsService.getStatistics();

  flagsService.clearAllOverrides();

  const statsAfter = flagsService.getStatistics();

  log.info('All feature flag overrides cleared via API', {
    clearedCount: statsBefore.overrides,
    userId: req.user?.id,
  });

  res.json({
    success: true,
    clearedCount: statsBefore.overrides,
    message: 'All feature flag overrides cleared',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Per-User Rate Limiting Endpoints (F5.3.5)
// ============================================================================

/**
 * @swagger
 * /api/rate-limits:
 *   get:
 *     summary: Get rate limit statistics
 *     description: Returns global rate limit statistics including top blocked users and request volume
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Rate limit statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 global:
 *                   type: object
 *                   description: Global statistics
 *                 topBlocked:
 *                   type: array
 *                   description: Top rate-limited users/IPs
 *                 topUsers:
 *                   type: array
 *                   description: Top users by request volume
 *                 roleMultipliers:
 *                   type: object
 *                   description: Rate limit multipliers by role
 *                 baseLimits:
 *                   type: object
 *                   description: Base rate limit configurations
 */
app.get('/api/rate-limits', (req, res) => {
  const stats = getRateLimitStats();
  res.json({
    ...stats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/rate-limits/config:
 *   get:
 *     summary: Get rate limit configuration
 *     description: Returns the current rate limit configuration including role multipliers and base limits
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Rate limit configuration
 */
app.get('/api/rate-limits/config', (req, res) => {
  const config = getRateLimitConfig();
  res.json({
    ...config,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/rate-limits/user/{userId}:
 *   get:
 *     summary: Get rate limit stats for a specific user
 *     description: Returns rate limit statistics for a specific user ID
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID to look up
 *     responses:
 *       200:
 *         description: User rate limit statistics
 *       404:
 *         description: No statistics found for user
 */
app.get('/api/rate-limits/user/:userId', authenticateJwt, (req, res) => {
  const { userId } = req.params;
  const stats = getUserRateLimitStats(userId);

  if (!stats) {
    return res.status(404).json({
      error: 'Not found',
      message: `No rate limit statistics found for user ${userId}`,
      userId,
    });
  }

  res.json({
    userId,
    stats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/rate-limits/me:
 *   get:
 *     summary: Get rate limit stats for current user
 *     description: Returns rate limit statistics for the currently authenticated user
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user's rate limit statistics
 */
app.get('/api/rate-limits/me', authenticateJwt, (req, res) => {
  const userId = req.user?.id;
  const stats = userId ? getUserRateLimitStats(userId) : null;

  res.json({
    userId,
    stats: stats || { hits: 0, blocked: 0, message: 'No activity recorded yet' },
    roles: req.user?.roles || [],
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/rate-limits/reset:
 *   post:
 *     summary: Reset rate limit statistics
 *     description: Clears all rate limit statistics (admin only)
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics reset successfully
 *       403:
 *         description: Insufficient permissions
 */
app.post('/api/rate-limits/reset', authenticateJwt, (req, res) => {
  // Only admins can reset stats
  const userRoles = req.user?.roles || [];
  const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

  if (!isAdmin) {
    log.warn('Rate limit stats reset attempt by non-admin', {
      userId: req.user?.id,
      roles: userRoles,
    });
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only administrators can reset rate limit statistics',
    });
  }

  resetRateLimitStats();

  log.info('Rate limit statistics reset via API', {
    userId: req.user?.id,
  });

  res.json({
    success: true,
    message: 'Rate limit statistics have been reset',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Configuration Management Endpoints (FC.2)
// ============================================================================

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get all configuration settings
 *     description: Returns all configuration settings. Optionally filter by category.
 *     tags: [Configuration]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category (openai, search, document_processing, chunking, cache, circuit_breaker, rate_limiting, graph, evaluation, entity_resolution, security, storage, telemetry)
 *     responses:
 *       200:
 *         description: Configuration settings
 */
app.get('/api/config', (req, res) => {
  const configService = getConfigurationService();
  const { category } = req.query;

  const configs = category ? configService.getAll(category) : configService.getAll();

  res.json({
    configs,
    categories: configService.getCategories(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/stats:
 *   get:
 *     summary: Get configuration statistics
 *     description: Returns statistics about configuration settings
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Configuration statistics
 */
app.get('/api/config/stats', (req, res) => {
  const configService = getConfigurationService();
  const stats = configService.getStatistics();

  res.json({
    ...stats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/by-category:
 *   get:
 *     summary: Get configuration grouped by category
 *     description: Returns all configuration settings organized by their category
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Configuration by category
 */
app.get('/api/config/by-category', (req, res) => {
  const configService = getConfigurationService();
  const configByCategory = configService.getByCategory();

  res.json({
    configByCategory,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/validate:
 *   get:
 *     summary: Validate all configuration settings
 *     description: Validates all current configuration values against their schemas
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Validation results
 */
app.get('/api/config/validate', (req, res) => {
  const configService = getConfigurationService();
  const validation = configService.validate();
  const initErrors = configService.getValidationErrors();

  res.json({
    valid: validation.valid && initErrors.length === 0,
    runtimeErrors: validation.errors,
    initializationErrors: initErrors,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/export:
 *   get:
 *     summary: Export configuration documentation
 *     description: Export all configuration definitions for documentation purposes
 *     tags: [Configuration]
 *     parameters:
 *       - in: query
 *         name: includeValues
 *         schema:
 *           type: boolean
 *         description: Include current values (default false for security)
 *     responses:
 *       200:
 *         description: Configuration export
 */
app.get('/api/config/export', (req, res) => {
  const configService = getConfigurationService();
  const includeValues = req.query.includeValues === 'true';
  const exported = configService.export(includeValues);

  res.json({
    configurations: exported,
    categories: CONFIG_CATEGORIES,
    types: CONFIG_TYPES,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/{key}:
 *   get:
 *     summary: Get a specific configuration setting
 *     description: Returns the full details of a specific configuration setting
 *     tags: [Configuration]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The configuration key
 *     responses:
 *       200:
 *         description: Configuration setting details
 *       404:
 *         description: Configuration setting not found
 */
app.get('/api/config/:key', (req, res) => {
  const configService = getConfigurationService();
  const config = configService.getWithMetadata(req.params.key);

  if (!config) {
    return res.status(404).json({
      error: 'Configuration not found',
      key: req.params.key,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    config,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/{key}/value:
 *   get:
 *     summary: Get configuration value only
 *     description: Returns just the current value of a configuration setting
 *     tags: [Configuration]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The configuration key
 *     responses:
 *       200:
 *         description: Configuration value
 *       404:
 *         description: Configuration setting not found
 */
app.get('/api/config/:key/value', (req, res) => {
  const configService = getConfigurationService();

  if (!configService.has(req.params.key)) {
    return res.status(404).json({
      error: 'Configuration not found',
      key: req.params.key,
      timestamp: new Date().toISOString(),
    });
  }

  const value = configService.get(req.params.key);

  res.json({
    key: req.params.key,
    value,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/{key}/override:
 *   post:
 *     summary: Set a runtime configuration override
 *     description: Temporarily override a configuration value. Does not persist across restarts.
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The configuration key to override
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 description: The new configuration value
 *     responses:
 *       200:
 *         description: Override set successfully
 *       400:
 *         description: Invalid configuration value
 *       404:
 *         description: Configuration not found
 */
app.post('/api/config/:key/override', authenticateJwt, (req, res) => {
  const configService = getConfigurationService();
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({
      error: 'Value is required',
      key,
      timestamp: new Date().toISOString(),
    });
  }

  if (!configService.has(key)) {
    return res.status(404).json({
      error: 'Configuration not found',
      key,
      timestamp: new Date().toISOString(),
    });
  }

  const result = configService.setOverride(key, value);

  if (!result.success) {
    return res.status(400).json({
      error: result.error,
      key,
      timestamp: new Date().toISOString(),
    });
  }

  log.info('Configuration override set via API', {
    key,
    userId: req.user?.id,
    restartRequired: result.restartRequired,
  });

  res.json({
    success: true,
    key,
    value: configService.get(key),
    restartRequired: result.restartRequired,
    message: result.restartRequired
      ? 'Override set, but restart required to take effect'
      : 'Override set successfully',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/{key}/override:
 *   delete:
 *     summary: Clear a runtime configuration override
 *     description: Remove a temporary override, reverting to default or environment value
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The configuration key
 *     responses:
 *       200:
 *         description: Override cleared successfully
 *       404:
 *         description: Configuration not found
 */
app.delete('/api/config/:key/override', authenticateJwt, (req, res) => {
  const configService = getConfigurationService();
  const { key } = req.params;

  if (!configService.has(key)) {
    return res.status(404).json({
      error: 'Configuration not found',
      key,
      timestamp: new Date().toISOString(),
    });
  }

  configService.clearOverride(key);

  log.info('Configuration override cleared via API', {
    key,
    userId: req.user?.id,
  });

  res.json({
    success: true,
    key,
    value: configService.get(key),
    message: 'Override cleared successfully',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/config/overrides:
 *   delete:
 *     summary: Clear all runtime configuration overrides
 *     description: Remove all temporary overrides, reverting all settings to defaults or environment values
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All overrides cleared successfully
 */
app.delete('/api/config/overrides', authenticateJwt, (req, res) => {
  const configService = getConfigurationService();
  const statsBefore = configService.getStatistics();

  configService.clearAllOverrides();

  const statsAfter = configService.getStatistics();

  log.info('All configuration overrides cleared via API', {
    clearedCount: statsBefore.overrides,
    userId: req.user?.id,
  });

  res.json({
    success: true,
    clearedCount: statsBefore.overrides,
    message: 'All configuration overrides cleared',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Audit Management Endpoints (F5.1.4)
// ============================================================================

/**
 * @swagger
 * /api/audit/retention:
 *   post:
 *     summary: Update audit log retention policy
 *     description: Update the number of days to retain audit logs. Updates both configuration and Cosmos DB container TTL. Admin only.
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - retentionDays
 *             properties:
 *               retentionDays:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of days to retain logs
 *     responses:
 *       200:
 *         description: Retention policy updated
 *       400:
 *         description: Invalid retention days
 *       403:
 *         description: Forbidden (non-admin)
 *       500:
 *         description: Update failed
 */
app.post('/api/audit/retention', authenticateJwt, async (req, res) => {
  // Check for admin role
  const userRoles = req.user?.roles || [];
  const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

  if (!isAdmin) {
    log.warn('Audit retention update attempt by non-admin', {
      userId: req.user?.id,
      roles: userRoles,
    });
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only administrators can update audit retention policy',
    });
  }

  const { retentionDays } = req.body;

  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    return res.status(400).json({
      error: 'Invalid retentionDays',
      message: 'Retention days must be a positive integer',
    });
  }

  try {
    const auditService = getAuditPersistenceService();
    const result = await auditService.updateRetentionPolicy(retentionDays);

    log.info('Audit retention policy updated via API', {
      userId: req.user?.id,
      retentionDays,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Failed to update audit retention policy', error);
    res.status(500).json({
      error: 'Update failed',
      message: error.message,
    });
  }
});

// ============================================================================
// Prompt Injection Detection Endpoints (F5.3.2)
// ============================================================================

/**
 * @swagger
 * /api/security/prompt-injection/analyze:
 *   post:
 *     summary: Analyze text for prompt injection attempts
 *     description: Analyzes the provided text for potential prompt injection attacks using pattern matching, heuristic scoring, and structural analysis.
 *     tags: [Security]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 description: The text to analyze for prompt injection
 *               messages:
 *                 type: array
 *                 description: Optional array of messages (chat format) to analyze
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                     content:
 *                       type: string
 *     responses:
 *       200:
 *         description: Analysis results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isRisky:
 *                   type: boolean
 *                 severity:
 *                   type: string
 *                   enum: [none, low, medium, high, critical]
 *                 action:
 *                   type: string
 *                   enum: [allow, warn, sanitize, block]
 *                 detections:
 *                   type: array
 *                 heuristicScore:
 *                   type: number
 */
app.post('/api/security/prompt-injection/analyze', async (req, res) => {
  try {
    const { text, messages } = req.body;
    const service = getPromptInjectionService();

    if (messages && Array.isArray(messages)) {
      const result = service.analyzeMessages(messages);
      return res.json(result);
    }

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text or messages array is required' });
    }

    const result = service.analyzeText(text);
    res.json(result);
  } catch (error) {
    log.errorWithStack('Prompt injection analysis error', error);
    res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
});

/**
 * @swagger
 * /api/security/prompt-injection/sanitize:
 *   post:
 *     summary: Sanitize text to remove prompt injection patterns
 *     description: Removes or neutralizes detected prompt injection patterns from the provided text.
 *     tags: [Security]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 description: The text to sanitize
 *     responses:
 *       200:
 *         description: Sanitization results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sanitized:
 *                   type: string
 *                 modifications:
 *                   type: array
 */
app.post('/api/security/prompt-injection/sanitize', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const service = getPromptInjectionService();
    const result = service.sanitizeText(text);
    res.json(result);
  } catch (error) {
    log.errorWithStack('Prompt injection sanitization error', error);
    res.status(500).json({ error: 'Sanitization failed', message: error.message });
  }
});

/**
 * @swagger
 * /api/security/prompt-injection/stats:
 *   get:
 *     summary: Get prompt injection detection statistics
 *     description: Returns statistics about prompt injection detection including total checks, blocks, warnings, and breakdowns by category and severity.
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: Detection statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalChecks:
 *                   type: integer
 *                 detectionsBlocked:
 *                   type: integer
 *                 detectionsWarned:
 *                   type: integer
 *                 detectionsByCategory:
 *                   type: object
 *                 detectionsBySeverity:
 *                   type: object
 *                 config:
 *                   type: object
 */
app.get('/api/security/prompt-injection/stats', (req, res) => {
  const service = getPromptInjectionService();
  const stats = service.getStats();
  res.json({
    ...stats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/security/prompt-injection/stats/reset:
 *   post:
 *     summary: Reset prompt injection detection statistics
 *     description: Resets all detection statistics to zero. Requires authentication.
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: Statistics reset successfully
 */
app.post('/api/security/prompt-injection/stats/reset', authenticateJwt, (req, res) => {
  const service = getPromptInjectionService();
  service.resetStats();
  res.json({
    success: true,
    message: 'Statistics reset successfully',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/security/prompt-injection/patterns:
 *   get:
 *     summary: Get list of detection pattern categories
 *     description: Returns the categories and descriptions of patterns used for prompt injection detection.
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: Pattern categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get('/api/security/prompt-injection/patterns', (req, res) => {
  const { ATTACK_PATTERNS } = require('./services/prompt-injection-service');

  // Return categories without exposing actual patterns (security through obscurity)
  const categories = Object.entries(ATTACK_PATTERNS).map(([category, config]) => ({
    category,
    severity: config.severity,
    description: config.description,
    patternCount: config.patterns.length,
  }));

  res.json({
    categories,
    totalPatterns: categories.reduce((sum, c) => sum + c.patternCount, 0),
    timestamp: new Date().toISOString(),
  });
});

// ==================== Suspicious Activity Detection (F5.1.6) ====================

const {
  getSuspiciousActivityService,
  ACTIVITY_TYPES,
  SEVERITY: SUSPICIOUS_SEVERITY,
} = require('./services/suspicious-activity-service');

/**
 * @swagger
 * /api/security/suspicious-activity/stats:
 *   get:
 *     summary: Get suspicious activity statistics
 *     description: Returns statistics about detected suspicious activities
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: Suspicious activity statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalAlerts:
 *                   type: integer
 *                 alertsByType:
 *                   type: object
 *                 alertsBySeverity:
 *                   type: object
 *                 trackedUsers:
 *                   type: integer
 *                 suspiciousUsers:
 *                   type: integer
 */
app.get('/api/security/suspicious-activity/stats', (req, res) => {
  const service = getSuspiciousActivityService();
  res.json({
    ...service.getStatistics(),
    activityTypes: ACTIVITY_TYPES,
    severityLevels: SUSPICIOUS_SEVERITY,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/security/suspicious-activity/users:
 *   get:
 *     summary: Get suspicious users
 *     description: Returns list of users with suspicious activity patterns
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: List of suspicious users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                       stats:
 *                         type: object
 */
app.get('/api/security/suspicious-activity/users', authenticateJwt, (req, res) => {
  // Require admin role for viewing suspicious users
  const userRoles = req.user?.roles || [];
  if (!userRoles.includes('admin') && !userRoles.includes('security')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const service = getSuspiciousActivityService();
  const suspiciousUsers = service.getSuspiciousUsers();

  res.json({
    count: suspiciousUsers.length,
    users: suspiciousUsers,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/security/suspicious-activity/users/{userId}:
 *   get:
 *     summary: Get user activity statistics
 *     description: Returns activity statistics for a specific user
 *     tags: [Security]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to check
 *     responses:
 *       200:
 *         description: User activity statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                 stats:
 *                   type: object
 */
app.get('/api/security/suspicious-activity/users/:userId', authenticateJwt, (req, res) => {
  const { userId } = req.params;
  const requestingUser = req.user?.id || req.user?.oid || req.user?.sub;
  const userRoles = req.user?.roles || [];

  // Users can view their own stats, admins can view anyone's
  if (userId !== requestingUser && !userRoles.includes('admin') && !userRoles.includes('security')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const service = getSuspiciousActivityService();
  const stats = service.getUserStats(userId);

  res.json({
    userId,
    stats,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/security/suspicious-activity/analyze:
 *   post:
 *     summary: Analyze historical audit logs
 *     description: Analyze audit logs for suspicious patterns over a time period
 *     tags: [Security]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hours:
 *                 type: integer
 *                 description: Hours of history to analyze
 *                 default: 24
 *     responses:
 *       200:
 *         description: Analysis results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 periodHours:
 *                   type: integer
 *                 totalDenials:
 *                   type: integer
 *                 uniqueUsers:
 *                   type: integer
 *                 suspiciousUsers:
 *                   type: array
 */
app.post('/api/security/suspicious-activity/analyze', authenticateJwt, async (req, res) => {
  const userRoles = req.user?.roles || [];
  if (!userRoles.includes('admin') && !userRoles.includes('security')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  try {
    const { hours = 24 } = req.body || {};
    const service = getSuspiciousActivityService();
    const analysis = await service.analyzeHistoricalLogs({ hours });

    res.json(analysis);
  } catch (error) {
    log.error('Failed to analyze suspicious activity', { error: error.message });
    res.status(500).json({ error: 'Failed to analyze suspicious activity' });
  }
});

/**
 * @swagger
 * /api/security/suspicious-activity/azure-monitor-config:
 *   get:
 *     summary: Get Azure Monitor alert configuration
 *     description: Returns recommended Azure Monitor alert configuration for suspicious activity detection
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: Azure Monitor configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 description:
 *                   type: string
 *                 metrics:
 *                   type: array
 *                 events:
 *                   type: array
 *                 recommendedActions:
 *                   type: array
 */
app.get('/api/security/suspicious-activity/azure-monitor-config', authenticateJwt, (req, res) => {
  const userRoles = req.user?.roles || [];
  if (!userRoles.includes('admin') && !userRoles.includes('security')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const service = getSuspiciousActivityService();
  res.json(service.getAzureMonitorAlertConfig());
});

/**
 * @swagger
 * /api/security/suspicious-activity/reset:
 *   post:
 *     summary: Reset suspicious activity tracking
 *     description: Clear all tracked suspicious activity data (admin only)
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: Tracking data reset
 */
app.post('/api/security/suspicious-activity/reset', authenticateJwt, (req, res) => {
  const userRoles = req.user?.roles || [];
  if (!userRoles.includes('admin')) {
    return res.status(403).json({ error: 'Admin role required' });
  }

  const service = getSuspiciousActivityService();
  service.reset();

  log.info('Suspicious activity tracking reset by admin', {
    userId: req.user?.id || req.user?.oid,
  });

  res.json({
    success: true,
    message: 'Suspicious activity tracking has been reset',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/telemetry:
 *   post:
 *     summary: Receive frontend telemetry
 *     description: Relay frontend telemetry events to Application Insights
 *     tags: [Telemetry]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               events:
 *                 type: array
 *               exceptions:
 *                 type: array
 *     responses:
 *       200:
 *         description: Telemetry received
 */
app.post('/api/telemetry', express.json(), (req, res) => {
  const { events = [], exceptions = [] } = req.body;
  const { trackEvent, trackException: backendTrackException } = require('./utils/telemetry');

  // Relay events to Application Insights
  for (const event of events) {
    trackEvent(`frontend.${event.name}`, {
      ...event.properties,
      source: 'frontend',
      timestamp: event.timestamp,
    }, event.measurements || {});
  }

  // Relay exceptions to Application Insights
  for (const exception of exceptions) {
    const error = new Error(exception.message);
    error.stack = exception.stack;
    backendTrackException(error, {
      ...exception.properties,
      source: 'frontend',
      timestamp: exception.timestamp,
    });
  }

  res.json({ received: events.length + exceptions.length });
});

/**
 * @swagger
 * /api/auth/verify:
 *   post:
 *     summary: Verify authentication token
 *     description: Verify a bearer token and return user information
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: true
 *                 userId:
 *                   type: string
 *                   example: 00000000-0000-0000-0000-000000000000
 *                 message:
 *                   type: string
 *                   example: Token verified successfully
 *       401:
 *         description: Invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/auth/verify', (req, res) => {
  const user = req.user || {};
  const userId = user.oid || user.sub || user.preferred_username || user.upn || 'unknown';

  res.json({
    valid: true,
    userId,
    message: 'Token verified successfully',
  });
});

/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: Get user profile
 *     description: Get the authenticated user's profile information
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: admin@contoso.com
 *                 name:
 *                   type: string
 *                   example: Test User
 *                 email:
 *                   type: string
 *                   example: test@contoso.com
 *                 roles:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: [Contributor]
 *       401:
 *         description: Unauthorized - missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/user/profile', (req, res) => {
  const user = req.user || {};
  const email = user.preferred_username || user.upn || '';
  const name = user.name || email;
  const roles = user.roles || [];

  res.json({
    id: user.oid || user.sub || email,
    name,
    email,
    roles,
  });
});

// Helper to build audit log entry
function buildAuditLogEntry(action, entityType, entityId, user, details = {}) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    entityType,
    entityId,
    userId: user.oid || user.sub || user.preferred_username || 'unknown',
    userEmail: user.preferred_username || user.upn || '',
    userName: user.name || user.preferred_username || 'Unknown User',
    details,
    immutable: true,
  };
}

/**
 * @swagger
 * /api/documents/upload:
 *   post:
 *     summary: Upload a document
 *     description: Upload a document file (PDF, Word, PowerPoint, Excel, Visio). Processing starts automatically after upload.
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Document file to upload
 *               title:
 *                 type: string
 *                 description: Document title (optional, defaults to filename)
 *                 example: Quarterly Report
 *               description:
 *                 type: string
 *                 description: Document description (optional)
 *                 example: Q4 2024 financial report
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags (optional)
 *                 example: finance,quarterly
 *     responses:
 *       201:
 *         description: Document uploaded and processing started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Document uploaded and processing started
 *                 document:
 *                   $ref: '#/components/schemas/Document'
 *       400:
 *         description: Bad request - no file uploaded or invalid file type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error during upload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/documents/upload', userUploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Extract metadata from request body
    const { title, description, tags } = req.body;
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const blobName = `${uniqueSuffix}-${req.file.originalname}`;
    const blobResult = await uploadBuffer(
      req.file.buffer,
      blobName,
      req.file.mimetype
    );

    // Create document record
    const document = {
      id: crypto.randomUUID(),
      documentType: 'document',
      filename: blobName,
      originalName: req.file.originalname,
      title: title || req.file.originalname,
      description: description || '',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      status: 'pending', // pending, processing, completed, failed
      blobUrl: blobResult.url,
    };

    const saved = await createDocument(document);

    // Automatically start processing
    const processingStartedAt = new Date().toISOString();
    await updateDocument(saved.id, {
      status: 'processing',
      processingStartedAt,
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded and processing started',
      document: {
        id: saved.id,
        filename: saved.filename,
        originalName: saved.originalName,
        title: saved.title,
        description: saved.description,
        tags: saved.tags,
        size: saved.size,
        uploadedAt: saved.uploadedAt,
        status: 'processing',
      },
    });

    // Process document asynchronously (after response is sent)
    const cosmosService = {
      updateDocument,
      getDocument: getDocumentById,
    };

    const processor = new DocumentProcessor(cosmosService);
    processor
      .processDocument(saved.id, saved.blobUrl, {
        mimeType: saved.mimeType,
        filename: saved.filename,
        title: saved.title,
      })
      .then((result) => {
        log.documentProcessing(saved.id, 'completed', { stats: result?.stats });
      })
      .catch((err) => {
        log.errorWithStack(`Document ${saved.id} processing failed`, err, { documentId: saved.id });
      });
  } catch (error) {
    log.errorWithStack('Upload error', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/documents:
 *   get:
 *     summary: Get all documents
 *     description: Retrieve a list of all uploaded documents
 *     tags: [Documents]
 *     responses:
 *       200:
 *         description: List of documents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 documents:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Document'
 *                 total:
 *                   type: integer
 *                   description: Total number of documents
 *                   example: 42
 */
app.get('/api/documents', async (req, res) => {
  const { status } = req.query;
  let docs = await listDocuments();

  // Filter by status if provided
  if (status) {
    // Map frontend status names to backend status values
    const statusMap = {
      'pending_review': ['completed'], // Documents that finished processing need review
      'pending': ['pending', 'processing'],
      'completed': ['completed'],
      'failed': ['failed'],
    };
    const allowedStatuses = statusMap[status] || [status];
    docs = docs.filter(doc => allowedStatuses.includes(doc.status));
  }

  res.json({
    documents: docs.map(doc => ({
      id: doc.id,
      filename: doc.filename,
      originalName: doc.originalName,
      title: doc.title,
      description: doc.description,
      tags: doc.tags,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
      status: doc.status,
      entityCount: doc.entities?.length || 0,
      relationshipCount: doc.relationships?.length || 0,
    })),
    total: docs.length,
  });
});

/**
 * @swagger
 * /api/documents/paginated:
 *   get:
 *     summary: List documents with cursor-based pagination (F5.2.4)
 *     description: Retrieve documents with cursor-based pagination for efficient navigation through large datasets
 *     tags: [Documents]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, pending_review, completed, failed]
 *         description: Filter documents by status
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor from previous response
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Paginated list of documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DocumentSummary'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *                     hasMore:
 *                       type: boolean
 *                     pageSize:
 *                       type: integer
 *                     itemCount:
 *                       type: integer
 */
app.get('/api/documents/paginated', async (req, res) => {
  const { status, cursor, pageSize } = req.query;

  try {
    const result = await listDocumentsPaginated({
      status,
      cursor,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });

    // Transform items to match existing response format
    const transformedItems = result.items.map(doc => ({
      id: doc.id,
      filename: doc.filename,
      originalName: doc.originalName,
      title: doc.title,
      description: doc.description,
      tags: doc.tags,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
      status: doc.status,
      entityCount: doc.entities?.length || 0,
      relationshipCount: doc.relationships?.length || 0,
    }));

    res.json({
      items: transformedItems,
      pagination: result.pagination,
    });
  } catch (error) {
    log.errorWithStack('Failed to list documents with pagination', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * @swagger
 * /api/stats/dashboard:
 *   get:
 *     summary: Get dashboard statistics
 *     description: Retrieve key metrics and recent activity for the dashboard
 *     tags: [Statistics]
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardStats'
 */
app.get('/api/stats/dashboard', async (req, res) => {
  const docs = await listDocuments();
  const totalDocuments = docs.length;
  const pendingReviews = docs.filter(doc => doc.status === 'pending').length;
  const completedDocuments = docs.filter(doc => doc.status === 'completed').length;
  const failedDocuments = docs.filter(doc => doc.status === 'failed').length;

  // Try to get real graph stats, fall back to estimates if unavailable
  let graphStats = { vertexCount: 0, edgeCount: 0 };
  try {
    const graphService = getGraphService();
    graphStats = await graphService.getStats();
  } catch {
    // Graph service may not be configured yet, use estimates
    graphStats = {
      vertexCount: totalDocuments * 15,
      edgeCount: totalDocuments * 12,
    };
  }

  const stats = {
    totalDocuments,
    totalEntities: graphStats.vertexCount,
    pendingReviews,
    completedDocuments,
    failedDocuments,
    graphSize: {
      nodes: graphStats.vertexCount,
      edges: graphStats.edgeCount,
    },
    recentActivity: docs
      .slice(-5)
      .reverse()
      .map(doc => ({
        id: doc.id,
        type: 'document_upload',
        title: doc.title,
        timestamp: doc.uploadedAt,
        status: doc.status,
      })),
  };

  res.json(stats);
});

/**
 * @swagger
 * /api/documents/{id}:
 *   get:
 *     summary: Get document by ID
 *     description: Retrieve a specific document by its ID
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *         example: 1
 *     responses:
 *       200:
 *         description: Document retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Document'
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/documents/:id', validateDocumentId, async (req, res) => {
  const id = req.params.id;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Get extractedText from direct field or from processingResults
  const extractedText = document.extractedText ||
    document.processingResults?.extractedText ||
    '';

  res.json({
    id: document.id,
    filename: document.filename,
    originalName: document.originalName,
    title: document.title,
    description: document.description,
    tags: document.tags,
    size: document.size,
    mimeType: document.mimeType,
    blobUrl: document.blobUrl,
    uploadedAt: document.uploadedAt,
    status: document.status,
    extractedText,
    entities: document.entities || [],
    relationships: document.relationships || [],
    processingResults: document.processingResults || null,
  });
});

/**
 * @swagger
 * /api/documents/{id}:
 *   delete:
 *     summary: Delete a document
 *     description: Delete a document and all associated data (blob storage, search index, graph)
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 deletedResources:
 *                   type: object
 *                   properties:
 *                     document:
 *                       type: boolean
 *                     blob:
 *                       type: boolean
 *                     searchIndex:
 *                       type: boolean
 *                     graph:
 *                       type: boolean
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.delete('/api/documents/:id', validateDocumentId, async (req, res) => {
  const id = req.params.id;
  const deletedResources = {
    document: false,
    blob: false,
    searchIndex: false,
    graph: false,
  };

  try {
    // Get document to find blob URL
    const document = await getDocumentById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from search index
    try {
      const searchService = getSearchService();
      await searchService.deleteDocumentsByDocumentId(id);
      deletedResources.searchIndex = true;
    } catch (error) {
      log.warn({ documentId: id, error: error.message }, 'Failed to delete from search index');
    }

    // Delete from graph
    try {
      const graphService = getGraphService();
      await graphService.deleteEdgesByDocumentId(id);
      await graphService.deleteVertexByDocumentId(id);
      deletedResources.graph = true;
    } catch (error) {
      log.warn({ documentId: id, error: error.message }, 'Failed to delete from graph');
    }

    // Delete blob from storage
    if (document.blobUrl) {
      try {
        const blobName = getBlobNameFromUrl(document.blobUrl);
        await deleteBlob(blobName);
        deletedResources.blob = true;
      } catch (error) {
        log.warn({ documentId: id, error: error.message }, 'Failed to delete blob');
      }
    }

    // Delete document from Cosmos DB
    try {
      const deleted = await deleteDocument(id);
      deletedResources.document = deleted;
    } catch (error) {
      log.error({ documentId: id, error: error.message }, 'Failed to delete from Cosmos DB');
      // If we can't delete from Cosmos, return an error
      return res.status(500).json({ error: `Failed to delete document from database: ${error.message}` });
    }

    // Create audit log (don't fail if this fails)
    try {
      await getAuditPersistenceService().createLog({
        entityType: 'document',
        entityId: id,
        action: 'delete',
        timestamp: new Date().toISOString(),
        details: { deletedResources },
      });
    } catch (error) {
      log.warn({ documentId: id, error: error.message }, 'Failed to create audit log for deletion');
    }

    res.json({
      message: 'Document deleted successfully',
      deletedResources,
    });
  } catch (error) {
    log.error({ documentId: id, error: error.message, stack: error.stack }, 'Error deleting document');
    res.status(500).json({ error: `Failed to delete document: ${error.message}` });
  }
});

/**
 * @swagger
 * /api/documents/{id}/entities/approve-all:
 *   post:
 *     summary: Approve all entities for a document
 *     description: Batch approve all extracted entities from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     responses:
 *       200:
 *         description: All entities approved successfully
 *       404:
 *         description: Document not found
 */
app.post('/api/documents/:id/entities/approve-all', validateDocumentId, async (req, res) => {
  const id = req.params.id;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const user = req.user || {};
  const entities = document.entities || [];
  const auditEntries = [];

  // Create audit log entries for all entities
  for (const entity of entities) {
    const auditEntry = buildAuditLogEntry('approve', 'entity', entity.id, user, {
      entityName: entity.name,
      entityCategory: entity.type,
      confidenceScore: entity.confidence,
      documentId: id,
      batchOperation: true,
    });
    auditEntries.push(auditEntry);
  }

  // Save all audit entries
  for (const entry of auditEntries) {
    await getAuditPersistenceService().createLog(entry);
  }

  // Update document status to completed
  await updateDocument(id, {
    status: 'completed',
    reviewedAt: new Date().toISOString(),
    reviewedBy: user.oid || user.sub || user.preferred_username || 'unknown',
  });

  res.json({
    success: true,
    message: `All ${entities.length} entities approved successfully`,
    approvedCount: entities.length,
    documentId: id,
  });
});

/**
 * @swagger
 * /api/documents/{id}/entities/reject-all:
 *   post:
 *     summary: Reject all entities for a document
 *     description: Batch reject all extracted entities from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for rejection
 *     responses:
 *       200:
 *         description: All entities rejected successfully
 *       404:
 *         description: Document not found
 */
app.post('/api/documents/:id/entities/reject-all', validateDocumentId, validateBatchRejection, async (req, res) => {
  const id = req.params.id;
  const { reason } = req.body;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const user = req.user || {};
  const entities = document.entities || [];
  const auditEntries = [];

  // Create audit log entries for all entities
  for (const entity of entities) {
    const auditEntry = buildAuditLogEntry('reject', 'entity', entity.id, user, {
      entityName: entity.name,
      entityCategory: entity.type,
      confidenceScore: entity.confidence,
      documentId: id,
      reason,
      batchOperation: true,
    });
    auditEntries.push(auditEntry);
  }

  // Save all audit entries
  for (const entry of auditEntries) {
    await getAuditPersistenceService().createLog(entry);
  }

  // Update document status to pending (can be reprocessed)
  await updateDocument(id, {
    status: 'pending',
    rejectedAt: new Date().toISOString(),
    rejectedBy: user.oid || user.sub || user.preferred_username || 'unknown',
    rejectionReason: reason,
  });

  res.json({
    success: true,
    message: `All ${entities.length} entities rejected successfully`,
    rejectedCount: entities.length,
    documentId: id,
    reason,
  });
});

/**
 * @swagger
 * /api/documents/{id}/entities/{entityId}/approve:
 *   post:
 *     summary: Approve a single entity
 *     description: Approve a specific extracted entity from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: Entity approved successfully
 *       404:
 *         description: Document or entity not found
 */
app.post('/api/documents/:id/entities/:entityId/approve', validateDocumentId, async (req, res) => {
  const { id, entityId } = req.params;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const entity = (document.entities || []).find(e => e.id === entityId);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  const user = req.user || {};
  const auditEntry = buildAuditLogEntry('approve', 'entity', entityId, user, {
    entityName: entity.name,
    entityCategory: entity.type,
    confidenceScore: entity.confidence,
    documentId: id,
  });

  await getAuditPersistenceService().createLog(auditEntry);

  res.json({
    success: true,
    message: 'Entity approved successfully',
    entityId,
    documentId: id,
  });
});

/**
 * @swagger
 * /api/documents/{id}/entities/{entityId}/reject:
 *   post:
 *     summary: Reject a single entity
 *     description: Reject a specific extracted entity from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for rejection
 *     responses:
 *       200:
 *         description: Entity rejected successfully
 *       404:
 *         description: Document or entity not found
 */
app.post('/api/documents/:id/entities/:entityId/reject', validateDocumentId, async (req, res) => {
  const { id, entityId } = req.params;
  const { reason } = req.body;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const entity = (document.entities || []).find(e => e.id === entityId);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  const user = req.user || {};
  const auditEntry = buildAuditLogEntry('reject', 'entity', entityId, user, {
    entityName: entity.name,
    entityCategory: entity.type,
    confidenceScore: entity.confidence,
    documentId: id,
    reason: reason || '',
  });

  await getAuditPersistenceService().createLog(auditEntry);

  res.json({
    success: true,
    message: 'Entity rejected successfully',
    entityId,
    documentId: id,
    reason: reason || '',
  });
});

/**
 * @swagger
 * /api/documents/{id}/process:
 *   post:
 *     summary: Process a document with Azure AI Document Intelligence
 *     description: Start OCR processing on an uploaded document to extract text, tables, and structure
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Processing started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 document:
 *                   $ref: '#/components/schemas/Document'
 *       404:
 *         description: Document not found
 *       500:
 *         description: Processing error
 */
app.post('/api/documents/:id/process', userProcessingLimiter, async (req, res) => {
  const id = req.params.id;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Check if already processing
  if (document.status === 'processing') {
    return res.status(409).json({
      error: 'Document is already being processed',
      status: document.status,
    });
  }

  const processingStartedAt = new Date().toISOString();

  // Update status to 'processing' BEFORE starting async work
  await updateDocument(id, {
    status: 'processing',
    processingStartedAt,
    // Clear old processing data when reprocessing
    entities: [],
    relationships: [],
    processingResults: null,
    processingError: null,
  });

  // Return immediately, process asynchronously
  res.json({
    success: true,
    message: 'Document processing started',
    document: {
      id: document.id,
      status: 'processing',
      processingStartedAt,
    },
  });

  // Create cosmos service wrapper for the processor
  const cosmosService = {
    updateDocument,
    getDocument: getDocumentById,
  };

  // Process document asynchronously
  const processor = new DocumentProcessor(cosmosService);

  processor
    .processDocument(id, document.blobUrl, {
      mimeType: document.mimeType,
      filename: document.filename,
      title: document.title,
    })
    .then((result) => {
      log.documentProcessing(id, 'completed', { stats: result.stats });
    })
    .catch((err) => {
      log.errorWithStack(`Document ${id} processing failed`, err, { documentId: id });
    });
});

/**
 * @swagger
 * /api/audit/logs:
 *   get:
 *     summary: Get audit logs
 *     description: Retrieve audit logs with optional filtering by entity ID, action type, or date range
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *         description: Filter by entity ID
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [approve, reject, create, update, delete]
 *         description: Filter by action type
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           enum: [entity, relationship, document]
 *         description: Filter by entity type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of logs to return
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AuditLog'
 *                 total:
 *                   type: integer
 */
app.get('/api/audit/logs', async (req, res) => {
  const { entityId, action, entityType, limit = 100 } = req.query;
  const logs = await getAuditPersistenceService().queryLogs({
    entityId,
    action,
    entityType,
    limit: Number(limit),
  });

  res.json({
    logs,
    total: logs.length,
  });
});

/**
 * @swagger
 * /api/audit/logs/paginated:
 *   get:
 *     summary: Query audit logs with cursor-based pagination (F5.2.4)
 *     description: Retrieve audit logs with cursor-based pagination for efficient navigation through large datasets
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *         description: Filter by entity ID
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *         description: Filter by entity type (document, user, system, security)
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action (create, update, delete, view, ACCESS_DENIED)
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs until this date
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor from previous response
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Paginated list of audit logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AuditLog'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *                     hasMore:
 *                       type: boolean
 *                     pageSize:
 *                       type: integer
 *                     itemCount:
 *                       type: integer
 */
app.get('/api/audit/logs/paginated', async (req, res) => {
  const { entityId, action, entityType, userId, startDate, endDate, cursor, pageSize } = req.query;

  try {
    const result = await getAuditPersistenceService().queryLogsPaginated({
      entityId,
      action,
      entityType,
      userId,
      startDate,
      endDate,
      cursor,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Failed to query audit logs with pagination', error);
    res.status(500).json({ error: 'Failed to query audit logs' });
  }
});

/**
 * @swagger
 * /api/review/stats:
 *   get:
 *     summary: Get review statistics
 *     description: Get statistics about document reviews for the current week
 *     tags: [Review]
 *     responses:
 *       200:
 *         description: Review statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 approvedThisWeek:
 *                   type: integer
 *                 rejectedThisWeek:
 *                   type: integer
 *                 avgReviewTimeMinutes:
 *                   type: number
 *                   nullable: true
 */
app.get('/api/review/stats', async (req, res) => {
  try {
    // Get the start of the current week (Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);

    // Query audit logs for this week
    const logs = await getAuditPersistenceService().queryLogs({ limit: 1000 });

    // Filter to this week's logs
    const thisWeekLogs = logs.filter((log) => {
      const logDate = new Date(log.timestamp);
      return logDate >= weekStart;
    });

    // Count approvals and rejections
    const approvedThisWeek = thisWeekLogs.filter(
      (log) => log.action === 'approve' && log.entityType === 'entity'
    ).length;

    const rejectedThisWeek = thisWeekLogs.filter(
      (log) => log.action === 'reject' && log.entityType === 'entity'
    ).length;

    // Calculate average review time (placeholder - would need document timestamps)
    const avgReviewTimeMinutes = null;

    res.json({
      approvedThisWeek,
      rejectedThisWeek,
      avgReviewTimeMinutes,
    });
  } catch (error) {
    log.errorWithStack('Review stats error', error);
    res.status(500).json({
      error: 'Failed to fetch review statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/log:
 *   post:
 *     summary: Create audit log entry
 *     description: Create a new audit log entry for entity approval, rejection, or other actions
 *     tags: [Audit]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - entityType
 *               - entityId
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, reject, create, update, delete]
 *                 example: approve
 *               entityType:
 *                 type: string
 *                 enum: [entity, relationship, document]
 *                 example: entity
 *               entityId:
 *                 type: string
 *                 example: entity-123
 *               details:
 *                 type: object
 *                 description: Additional context about the action
 *                 properties:
 *                   entityName:
 *                     type: string
 *                   entityCategory:
 *                     type: string
 *                   confidenceScore:
 *                     type: number
 *                   reason:
 *                     type: string
 *     responses:
 *       201:
 *         description: Audit log entry created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuditLog'
 *       400:
 *         description: Invalid request
 */
app.post('/api/audit/log', async (req, res) => {
  const { action, entityType, entityId, details = {} } = req.body;
  const user = req.user || {};

  if (!action || !entityType || !entityId) {
    return res.status(400).json({
      error: 'Missing required fields: action, entityType, entityId'
    });
  }

  const validActions = ['approve', 'reject', 'create', 'update', 'delete'];
  if (!validActions.includes(action)) {
    return res.status(400).json({
      error: `Invalid action. Must be one of: ${validActions.join(', ')}`
    });
  }

  const validEntityTypes = ['entity', 'relationship', 'document'];
  if (!validEntityTypes.includes(entityType)) {
    return res.status(400).json({
      error: `Invalid entityType. Must be one of: ${validEntityTypes.join(', ')}`
    });
  }

  const auditEntry = buildAuditLogEntry(action, entityType, entityId, user, details);
  const saved = await getAuditPersistenceService().createLog(auditEntry);

  res.status(201).json(saved);
});

// ============================================================================
// Audit Export Endpoints (F5.1.5)
// ============================================================================

/**
 * @swagger
 * /api/audit/export:
 *   get:
 *     summary: Export audit logs
 *     description: Export audit logs to CSV, JSON, or NDJSON format. Can return content directly or save to file.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, json, ndjson]
 *           default: json
 *         description: Export format
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs before this date
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *         description: Filter by entity type
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10000
 *         description: Maximum records to export
 *       - in: query
 *         name: download
 *         schema:
 *           type: boolean
 *           default: false
 *         description: If true, streams as downloadable file
 *     responses:
 *       200:
 *         description: Export successful
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Export failed
 */
app.get('/api/audit/export', authenticateJwt, async (req, res) => {
  try {
    // Check for admin or auditor role
    const userRoles = req.user?.roles || [];
    const hasAccess = userRoles.some(r =>
      r.toLowerCase().includes('admin') || r.toLowerCase().includes('auditor')
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied. Admin or Auditor role required for audit export.'
      });
    }

    const {
      format = 'json',
      startDate,
      endDate,
      action,
      entityType,
      userId,
      limit = 10000,
      download = 'false'
    } = req.query;

    const exportService = getAuditExportService();
    const options = {
      format,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      action,
      entityType,
      userId,
      limit: parseInt(limit, 10),
    };

    // Stream download
    if (download === 'true' || download === '1') {
      await exportService.streamExport(options, res);
      return;
    }

    // Return content in response
    const result = await exportService.exportLogs(options);

    res.json({
      success: true,
      format: result.format,
      recordCount: result.recordCount,
      exportedAt: result.exportedAt,
      filters: result.filters,
      content: result.content,
    });
  } catch (error) {
    log.errorWithStack('Audit export error', error);
    res.status(500).json({
      error: 'Failed to export audit logs',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/file:
 *   post:
 *     summary: Export audit logs to file
 *     description: Export audit logs to a file in the configured archive directory. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               format:
 *                 type: string
 *                 enum: [csv, json, ndjson]
 *                 default: json
 *               startDate:
 *                 type: string
 *                 format: date-time
 *               endDate:
 *                 type: string
 *                 format: date-time
 *               action:
 *                 type: string
 *               entityType:
 *                 type: string
 *               userId:
 *                 type: string
 *               limit:
 *                 type: integer
 *                 default: 10000
 *               filename:
 *                 type: string
 *                 description: Custom filename (auto-generated if not provided)
 *     responses:
 *       200:
 *         description: Export file created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Export failed
 */
app.post('/api/audit/export/file', authenticateJwt, async (req, res) => {
  try {
    // Admin only
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required for file exports.'
      });
    }

    const {
      format = 'json',
      startDate,
      endDate,
      action,
      entityType,
      userId,
      limit = 10000,
      filename,
    } = req.body;

    const exportService = getAuditExportService();
    const result = await exportService.exportLogs({
      format,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      action,
      entityType,
      userId,
      limit,
      saveToFile: true,
      filename,
    });

    res.json({
      success: true,
      jobId: result.jobId,
      format: result.format,
      recordCount: result.recordCount,
      filePath: result.filePath,
      filename: result.filename,
      fileSize: result.fileSize,
      exportedAt: result.exportedAt,
      filters: result.filters,
    });
  } catch (error) {
    log.errorWithStack('Audit file export error', error);
    res.status(500).json({
      error: 'Failed to export audit logs to file',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/files:
 *   get:
 *     summary: List exported audit files
 *     description: List all audit export files in the archive directory. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of export files
 *       403:
 *         description: Forbidden
 */
app.get('/api/audit/export/files', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const exportService = getAuditExportService();
    const files = await exportService.listExportFiles();

    res.json({
      success: true,
      files,
      directory: exportService.getExportDirectory(),
    });
  } catch (error) {
    log.errorWithStack('List export files error', error);
    res.status(500).json({
      error: 'Failed to list export files',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/files/{filename}:
 *   delete:
 *     summary: Delete an export file
 *     description: Delete an audit export file. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: File deleted
 *       403:
 *         description: Forbidden
 *       404:
 *         description: File not found
 */
app.delete('/api/audit/export/files/:filename', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const { filename } = req.params;
    const exportService = getAuditExportService();
    const deleted = await exportService.deleteExportFile(filename);

    if (!deleted) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({ success: true, deleted: filename });
  } catch (error) {
    log.errorWithStack('Delete export file error', error);
    res.status(500).json({
      error: 'Failed to delete export file',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/schedule:
 *   get:
 *     summary: Get scheduled export jobs
 *     description: List all scheduled audit export jobs. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of scheduled exports
 */
app.get('/api/audit/export/schedule', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const exportService = getAuditExportService();
    const schedules = exportService.getScheduledExports();

    res.json({
      success: true,
      schedules,
    });
  } catch (error) {
    log.errorWithStack('Get schedules error', error);
    res.status(500).json({
      error: 'Failed to get scheduled exports',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/schedule:
 *   post:
 *     summary: Create scheduled export
 *     description: Create a new scheduled audit export job. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique name for this schedule
 *               format:
 *                 type: string
 *                 enum: [csv, json, ndjson]
 *                 default: json
 *               intervalHours:
 *                 type: integer
 *                 default: 24
 *               filters:
 *                 type: object
 *                 properties:
 *                   action:
 *                     type: string
 *                   entityType:
 *                     type: string
 *                   userId:
 *                     type: string
 *     responses:
 *       201:
 *         description: Schedule created
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Forbidden
 */
app.post('/api/audit/export/schedule', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const { name, format, intervalHours, filters } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Schedule name is required' });
    }

    const exportService = getAuditExportService();
    const schedule = exportService.scheduleExport({
      name,
      format: format || 'json',
      intervalHours: intervalHours || 24,
      filters: filters || {},
    });

    res.status(201).json({
      success: true,
      schedule,
    });
  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.status(400).json({ error: error.message });
    }
    log.errorWithStack('Create schedule error', error);
    res.status(500).json({
      error: 'Failed to create scheduled export',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/schedule/{name}:
 *   delete:
 *     summary: Remove scheduled export
 *     description: Remove a scheduled audit export job. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Schedule removed
 *       404:
 *         description: Schedule not found
 */
app.delete('/api/audit/export/schedule/:name', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const { name } = req.params;
    const exportService = getAuditExportService();

    try {
      exportService.removeScheduledExport(name);
      res.json({ success: true, removed: name });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      throw err;
    }
  } catch (error) {
    log.errorWithStack('Remove schedule error', error);
    res.status(500).json({
      error: 'Failed to remove scheduled export',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/schedule/{name}/run:
 *   post:
 *     summary: Run scheduled export now
 *     description: Trigger a scheduled export to run immediately. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Export triggered
 *       404:
 *         description: Schedule not found
 */
app.post('/api/audit/export/schedule/:name/run', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const { name } = req.params;
    const exportService = getAuditExportService();

    try {
      const result = await exportService.runScheduledExportNow(name);
      res.json({
        success: true,
        result: {
          recordCount: result.recordCount,
          filePath: result.filePath,
          exportedAt: result.exportedAt,
        },
      });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      throw err;
    }
  } catch (error) {
    log.errorWithStack('Run schedule error', error);
    res.status(500).json({
      error: 'Failed to run scheduled export',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/stats:
 *   get:
 *     summary: Get export statistics
 *     description: Get statistics about audit exports. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Export statistics
 */
app.get('/api/audit/export/stats', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const exportService = getAuditExportService();
    const stats = exportService.getStatistics();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    log.errorWithStack('Get export stats error', error);
    res.status(500).json({
      error: 'Failed to get export statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/jobs:
 *   get:
 *     summary: Get recent export jobs
 *     description: Get status of recent export jobs. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Recent export jobs
 */
app.get('/api/audit/export/jobs', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const { limit = 20 } = req.query;
    const exportService = getAuditExportService();
    const jobs = exportService.getRecentJobs(parseInt(limit, 10));

    res.json({
      success: true,
      jobs,
    });
  } catch (error) {
    log.errorWithStack('Get export jobs error', error);
    res.status(500).json({
      error: 'Failed to get export jobs',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/export/jobs/{jobId}:
 *   get:
 *     summary: Get export job status
 *     description: Get the status of a specific export job. Admin only.
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Job status
 *       404:
 *         description: Job not found
 */
app.get('/api/audit/export/jobs/:jobId', authenticateJwt, async (req, res) => {
  try {
    const userRoles = req.user?.roles || [];
    const isAdmin = userRoles.some(r => r.toLowerCase().includes('admin'));

    if (!isAdmin) {
      return res.status(403).json({
        error: 'Access denied. Admin role required.'
      });
    }

    const { jobId } = req.params;
    const exportService = getAuditExportService();
    const job = exportService.getJobStatus(parseInt(jobId, 10));

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      job,
    });
  } catch (error) {
    log.errorWithStack('Get job status error', error);
    res.status(500).json({
      error: 'Failed to get job status',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/stats:
 *   get:
 *     summary: Get graph statistics
 *     description: Get counts of nodes and edges in the knowledge graph
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: Graph statistics retrieved successfully
 */
app.get('/api/graphrag/stats', async (req, res) => {
  try {
    const graphService = getGraphService();
    const stats = await graphService.getStats();
    res.json(stats);
  } catch (error) {
    log.errorWithStack('Graph stats error', error);
    res.status(500).json({
      error: 'Failed to fetch graph statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graph/entities:
 *   get:
 *     summary: Get graph entities and relationships
 *     description: Get all entities and their relationships for visualization
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Maximum number of entities to return
 *     responses:
 *       200:
 *         description: Graph data retrieved successfully
 */
app.get('/api/graph/entities', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const graphService = getGraphService();
    const data = await graphService.getAllEntities(limit);
    res.json(data);
  } catch (error) {
    log.errorWithStack('Graph entities error', error);
    res.status(500).json({
      error: 'Failed to fetch graph entities',
      message: error.message,
    });
  }
});

// ==================== Persona Endpoints (F6.3.4) ====================

/**
 * @swagger
 * /api/personas:
 *   get:
 *     summary: Get available personas
 *     description: Returns list of available personas for GraphRAG customization
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: List of personas
 */
app.get('/api/personas', (req, res) => {
  const personaService = getPersonaService();
  const personas = personaService.getAllPersonaSummaries();
  res.json({
    personas,
    count: personas.length,
    timestamp: new Date().toISOString(),
  });
});

// ==================== GraphRAG Endpoints ====================

/**
 * @swagger
 * /api/graphrag/query:
 *   post:
 *     summary: Submit a GraphRAG query
 *     description: Submit a natural language query to the GraphRAG system for processing
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Natural language query about business processes
 *                 example: What are the steps in the procurement process?
 *     responses:
 *       200:
 *         description: Query processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                   description: AI-generated answer to the query
 *                 citations:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Source documents used to generate the answer
 *                 responseTime:
 *                   type: number
 *                   description: Query processing time in milliseconds
 *       400:
 *         description: Invalid query
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/graphrag/query', userQueryLimiter, promptInjectionGuard({ fields: ['query'] }), async (req, res) => {
  const { query, options = {} } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query is required and must be a non-empty string' });
  }

  try {
    const pipeline = getGraphRAGQueryPipeline();

    // Pass user context for security trimming and audit
    const result = await pipeline.processQueryWithFallback(query, {
      topK: options.topK || 10,
      graphDepth: options.graphDepth || 2,
      includeGraphContext: options.includeGraphContext !== false,
      semantic: options.semantic !== false,
      user: req.user, // Pass authenticated user for security trimming
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('GraphRAG query error', error);
    res.status(500).json({
      error: 'Query processing failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/search:
 *   post:
 *     summary: Enhanced GraphRAG search
 *     description: Perform a graph-enhanced RAG search with entity resolution and multi-hop traversal
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Natural language query
 *               options:
 *                 type: object
 *                 properties:
 *                   persona:
 *                     type: string
 *                     description: Persona ID (ops, it, leadership, compliance)
 *                   maxHops:
 *                     type: integer
 *                     description: Maximum graph traversal depth
 *                   maxEntities:
 *                     type: integer
 *                     description: Maximum entities to retrieve
 *                   includeCommunities:
 *                     type: boolean
 *                     description: Include community summaries
 *     responses:
 *       200:
 *         description: GraphRAG search results
 */
app.post('/api/graphrag/search', userQueryLimiter, async (req, res) => {
  const { query, options = {} } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query is required and must be a non-empty string' });
  }

  try {
    const graphRAG = getGraphRAGService();
    const result = await graphRAG.query(query, {
      ...options, // Pass through persona
      maxHops: options.maxHops || 3,
      maxEntities: options.maxEntities || 10,
      includeCommunities: options.includeCommunities || false,
      user: req.user,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('GraphRAG search error', error);
    res.status(500).json({
      error: 'GraphRAG search failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/answer:
 *   post:
 *     summary: Generate answer using GraphRAG
 *     description: Generate a natural language answer using graph-enhanced retrieval
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *               options:
 *                 type: object
 *                 properties:
 *                   persona:
 *                     type: string
 *                     description: Persona ID (ops, it, leadership, compliance)
 *                   maxTokens:
 *                     type: integer
 *                   maxHops:
 *                     type: integer
 *     responses:
 *       200:
 *         description: Generated answer with sources
 */
app.post('/api/graphrag/answer', userQueryLimiter, async (req, res) => {
  const { query, options = {} } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const graphRAG = getGraphRAGService();
    const result = await graphRAG.generateAnswer(query, {
      ...options, // Pass through persona
      maxTokens: options.maxTokens || 1000,
      maxHops: options.maxHops || 3,
      user: req.user,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('GraphRAG answer generation error', error);
    res.status(500).json({
      error: 'Answer generation failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/entity/{name}:
 *   get:
 *     summary: Get entity view
 *     description: Get detailed information about an entity including related entities and document mentions
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity name
 *     responses:
 *       200:
 *         description: Entity details with relationships
 *       404:
 *         description: Entity not found
 */
app.get('/api/graphrag/entity/:name', async (req, res) => {
  const { name } = req.params;

  try {
    const graphRAG = getGraphRAGService();
    const result = await graphRAG.getEntityView(decodeURIComponent(name), {
      maxRelated: 20,
    });

    if (!result) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    res.json(result);
  } catch (error) {
    log.errorWithStack('Get entity view error', error);
    res.status(500).json({
      error: 'Failed to get entity view',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities:
 *   get:
 *     summary: Get community summaries
 *     description: Get all generated community summaries with their metadata (F3.1.3)
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Force regeneration of summaries
 *     responses:
 *       200:
 *         description: Community summaries retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summaries:
 *                   type: object
 *                 metadata:
 *                   type: object
 */
app.get('/api/graphrag/communities', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const communitySummary = getCommunitySummaryService();

    // Get cached summaries or generate new ones
    let result;
    if (forceRefresh) {
      result = await communitySummary.generateAllSummaries({ forceRefresh: true });
    } else {
      // Try to get cached summaries first
      const cached = communitySummary.getAllCachedSummaries();
      if (Object.keys(cached).length > 0) {
        result = {
          summaries: cached,
          metadata: {
            source: 'cache',
            ...communitySummary.getStatus(),
          },
        };
      } else {
        result = await communitySummary.generateAllSummaries();
      }
    }

    res.json(result);
  } catch (error) {
    log.errorWithStack('Get community summaries error', error);
    res.status(500).json({
      error: 'Failed to get community summaries',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities/generate:
 *   post:
 *     summary: Generate community summaries
 *     description: Generate or regenerate LLM summaries for all communities (F3.1.3)
 *     tags: [GraphRAG]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               forceRefresh:
 *                 type: boolean
 *                 description: Force regeneration even if cached
 *               minCommunitySize:
 *                 type: integer
 *                 description: Minimum community size to generate summary
 *               resolution:
 *                 type: number
 *                 description: Louvain resolution parameter
 *     responses:
 *       200:
 *         description: Community summaries generated successfully
 */
app.post('/api/graphrag/communities/generate', userProcessingLimiter, async (req, res) => {
  try {
    const { forceRefresh = true, minCommunitySize, resolution } = req.body;
    const communitySummary = getCommunitySummaryService();

    const result = await communitySummary.generateAllSummaries({
      forceRefresh,
      minCommunitySize,
      resolution,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Generate community summaries error', error);
    res.status(500).json({
      error: 'Failed to generate community summaries',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities/incremental:
 *   post:
 *     summary: Incrementally update community summaries
 *     description: Update community summaries using incremental detection (F3.1.4). Only regenerates summaries for communities affected by graph changes since the last detection. Significantly faster than full regeneration for small graph changes.
 *     tags: [GraphRAG]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sinceTimestamp:
 *                 type: string
 *                 format: date-time
 *                 description: Override timestamp for change detection (optional, defaults to last run)
 *               forceIncremental:
 *                 type: boolean
 *                 default: false
 *                 description: Force incremental even when not recommended
 *               minCommunitySize:
 *                 type: integer
 *                 default: 2
 *                 description: Minimum community size for summary generation
 *               resolution:
 *                 type: number
 *                 description: Louvain resolution parameter
 *     responses:
 *       200:
 *         description: Community summaries updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summaries:
 *                   type: object
 *                   description: Map of communityId to summary
 *                 changedCommunities:
 *                   type: array
 *                   items:
 *                     type: integer
 *                   description: IDs of communities that changed
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     incremental:
 *                       type: boolean
 *                       description: Whether incremental detection was used
 *                     regeneratedCount:
 *                       type: integer
 *                       description: Number of summaries regenerated
 *                     preservedCount:
 *                       type: integer
 *                       description: Number of summaries preserved from cache
 *                     executionTimeMs:
 *                       type: integer
 *                       description: Total execution time
 */
app.post('/api/graphrag/communities/incremental', userProcessingLimiter, async (req, res) => {
  try {
    const { sinceTimestamp, forceIncremental, minCommunitySize, resolution } = req.body;
    const communitySummary = getCommunitySummaryService();

    const result = await communitySummary.updateSummariesIncremental({
      sinceTimestamp,
      forceIncremental,
      minCommunitySize,
      resolution,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Incremental community update error', error);
    res.status(500).json({
      error: 'Failed to incrementally update community summaries',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities/{id}:
 *   get:
 *     summary: Get a specific community summary
 *     description: Get the summary for a specific community by ID (F3.1.3)
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Community ID
 *     responses:
 *       200:
 *         description: Community summary retrieved successfully
 *       404:
 *         description: Community not found
 */
app.get('/api/graphrag/communities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const communitySummary = getCommunitySummaryService();

    const summary = await communitySummary.getCommunitySummary(id);

    if (!summary) {
      return res.status(404).json({ error: 'Community not found' });
    }

    res.json(summary);
  } catch (error) {
    log.errorWithStack('Get community summary error', error);
    res.status(500).json({
      error: 'Failed to get community summary',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/global-query:
 *   post:
 *     summary: Global query using community summaries
 *     description: Answer questions using map-reduce over community summaries (F3.1.3 + F6.1.2)
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Natural language query requiring global knowledge
 *               options:
 *                 type: object
 *                 properties:
 *                   maxCommunities:
 *                     type: integer
 *                     description: Maximum communities to analyze
 *                   maxPartials:
 *                     type: integer
 *                     description: Maximum partial answers to synthesize
 *     responses:
 *       200:
 *         description: Global query answered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                 sources:
 *                   type: array
 *                 confidence:
 *                   type: number
 *                 metadata:
 *                   type: object
 */
app.post('/api/graphrag/global-query', userQueryLimiter, async (req, res) => {
  const { query, options = {} } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query is required and must be a non-empty string' });
  }

  try {
    const graphRAG = getGraphRAGService();
    const result = await graphRAG.globalQuery(query, {
      maxCommunities: options.maxCommunities || 10,
      maxPartials: options.maxPartials || 5,
      user: req.user,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Global query error', error);
    res.status(500).json({
      error: 'Global query failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities/status:
 *   get:
 *     summary: Get community summary service status
 *     description: Get status information about the community summary service
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: Service status retrieved successfully
 */
app.get('/api/graphrag/communities/status', async (req, res) => {
  try {
    const communitySummary = getCommunitySummaryService();

    // Use enhanced status that includes storage stats (F3.1.2)
    const includeStorage = req.query.includeStorage !== 'false';
    let status;

    if (includeStorage) {
      status = await communitySummary.getStatusWithStorage();
    } else {
      status = communitySummary.getStatus();
    }

    res.json(status);
  } catch (error) {
    log.errorWithStack('Get community summary status error', error);
    res.status(500).json({
      error: 'Failed to get service status',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities/storage:
 *   get:
 *     summary: Get community storage statistics
 *     description: Get persistent storage statistics for communities (F3.1.2)
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: Storage statistics retrieved successfully
 */
app.get('/api/graphrag/communities/storage', async (req, res) => {
  try {
    const { getCommunityStorageService } = require('./services/community-storage-service');
    const storage = getCommunityStorageService();
    const stats = await storage.getStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    log.errorWithStack('Get community storage stats error', error);
    res.status(500).json({
      error: 'Failed to get storage statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities/storage/health:
 *   get:
 *     summary: Check community storage health
 *     description: Check if community storage is healthy and accessible (F3.1.2)
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: Storage health check completed
 */
app.get('/api/graphrag/communities/storage/health', async (req, res) => {
  try {
    const { getCommunityStorageService } = require('./services/community-storage-service');
    const storage = getCommunityStorageService();
    const health = await storage.healthCheck();

    res.status(health.healthy ? 200 : 503).json(health);
  } catch (error) {
    log.errorWithStack('Community storage health check error', error);
    res.status(503).json({
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /api/graphrag/communities/storage/snapshots:
 *   get:
 *     summary: Get community snapshots for trend analysis
 *     description: Get historical snapshots of community detection results (F3.1.2)
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of snapshots to return
 *     responses:
 *       200:
 *         description: Snapshots retrieved successfully
 */
app.get('/api/graphrag/communities/storage/snapshots', async (req, res) => {
  try {
    const { getCommunityStorageService } = require('./services/community-storage-service');
    const storage = getCommunityStorageService();
    const limit = parseInt(req.query.limit) || 10;

    const snapshots = await storage.getSnapshots({ limit });

    res.json({
      success: true,
      count: snapshots.length,
      snapshots,
    });
  } catch (error) {
    log.errorWithStack('Get community snapshots error', error);
    res.status(500).json({
      error: 'Failed to get snapshots',
      message: error.message,
    });
  }
});

// ============================================
// Impact Analysis API Routes (F3.3.1 - F3.3.4)
// ============================================

/**
 * @swagger
 * /api/graphrag/impact:
 *   post:
 *     summary: Analyze entity impact
 *     description: Perform dependency and impact analysis for an entity (F3.3.4)
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - entityName
 *             properties:
 *               entityName:
 *                 type: string
 *                 description: Name of the entity to analyze
 *               direction:
 *                 type: string
 *                 enum: [upstream, downstream, both]
 *                 default: both
 *                 description: Direction of analysis
 *               maxDepth:
 *                 type: integer
 *                 default: 5
 *                 description: Maximum traversal depth
 *               maxEntities:
 *                 type: integer
 *                 default: 100
 *                 description: Maximum entities to return
 *     responses:
 *       200:
 *         description: Impact analysis completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sourceEntity:
 *                   type: string
 *                 upstream:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                     entities:
 *                       type: array
 *                 downstream:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                     entities:
 *                       type: array
 *                 summary:
 *                   type: object
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Analysis failed
 */
app.post('/api/graphrag/impact', userQueryLimiter, async (req, res) => {
  const { entityName, direction = 'both', maxDepth, maxEntities, forceRefresh } = req.body;

  if (!entityName || typeof entityName !== 'string' || entityName.trim().length === 0) {
    return res.status(400).json({ error: 'entityName is required and must be a non-empty string' });
  }

  const validDirections = ['upstream', 'downstream', 'both'];
  if (!validDirections.includes(direction)) {
    return res.status(400).json({ error: `direction must be one of: ${validDirections.join(', ')}` });
  }

  try {
    const options = {
      maxDepth: maxDepth || 5,
      maxEntities: maxEntities || 100,
      forceRefresh: forceRefresh || false,
    };

    const result = await getImpactAnalysisWithCache(entityName.trim(), direction, options);
    res.json(result);
  } catch (error) {
    log.errorWithStack('Impact analysis error', error, { entityName, direction });
    res.status(500).json({
      error: 'Impact analysis failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/impact/upstream:
 *   get:
 *     summary: Get upstream dependencies
 *     description: Find what an entity depends on (F3.3.1)
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: entityName
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity name to analyze
 *       - in: query
 *         name: maxDepth
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Maximum traversal depth
 *       - in: query
 *         name: maxEntities
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum entities to return
 *     responses:
 *       200:
 *         description: Upstream dependencies found
 *       400:
 *         description: Missing entity name
 */
app.get('/api/graphrag/impact/upstream', async (req, res) => {
  const { entityName, maxDepth, maxEntities } = req.query;

  if (!entityName) {
    return res.status(400).json({ error: 'entityName query parameter is required' });
  }

  try {
    const result = await getUpstreamDependencies(decodeURIComponent(entityName), {
      maxDepth: parseInt(maxDepth) || 5,
      maxEntities: parseInt(maxEntities) || 100,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Upstream dependencies error', error, { entityName });
    res.status(500).json({
      error: 'Failed to get upstream dependencies',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/impact/downstream:
 *   get:
 *     summary: Get downstream impact
 *     description: Find what depends on an entity (F3.3.2)
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: entityName
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity name to analyze
 *       - in: query
 *         name: maxDepth
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Maximum traversal depth
 *       - in: query
 *         name: maxEntities
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum entities to return
 *     responses:
 *       200:
 *         description: Downstream impact found
 *       400:
 *         description: Missing entity name
 */
app.get('/api/graphrag/impact/downstream', async (req, res) => {
  const { entityName, maxDepth, maxEntities } = req.query;

  if (!entityName) {
    return res.status(400).json({ error: 'entityName query parameter is required' });
  }

  try {
    const result = await getDownstreamImpact(decodeURIComponent(entityName), {
      maxDepth: parseInt(maxDepth) || 5,
      maxEntities: parseInt(maxEntities) || 100,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Downstream impact error', error, { entityName });
    res.status(500).json({
      error: 'Failed to get downstream impact',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/impact/simulate:
 *   post:
 *     summary: Simulate entity removal
 *     description: Simulate the impact of removing or changing an entity (F3.3.6)
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - entityName
 *             properties:
 *               entityName:
 *                 type: string
 *                 description: Name of the entity to simulate removal
 *               maxDepth:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum traversal depth for simulation
 *     responses:
 *       200:
 *         description: Simulation completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 simulatedEntity:
 *                   type: string
 *                 action:
 *                   type: string
 *                 impact:
 *                   type: object
 *                 brokenRelationships:
 *                   type: object
 *                 recommendation:
 *                   type: string
 *                 riskLevel:
 *                   type: string
 *                   enum: [low, medium, high, critical]
 *       400:
 *         description: Missing entity name
 */
app.post('/api/graphrag/impact/simulate', userQueryLimiter, async (req, res) => {
  const { entityName, maxDepth } = req.body;

  if (!entityName || typeof entityName !== 'string' || entityName.trim().length === 0) {
    return res.status(400).json({ error: 'entityName is required and must be a non-empty string' });
  }

  try {
    const result = await simulateRemoval(entityName.trim(), {
      maxDepth: maxDepth || 10,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Simulate removal error', error, { entityName });
    res.status(500).json({
      error: 'Simulation failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/similar:
 *   post:
 *     summary: Find similar entities
 *     description: Find entities similar to the provided entity using embedding similarity
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *               description:
 *                 type: string
 *               maxResults:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Similar entities found
 */
app.post('/api/entities/similar', async (req, res) => {
  const { name, type, description, maxResults = 10 } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Entity name is required' });
  }

  try {
    const entityResolution = getEntityResolutionService();
    const similar = await entityResolution.findSimilarEntities(
      { name, type, description },
      { maxCandidates: maxResults }
    );

    res.json({ similar });
  } catch (error) {
    log.errorWithStack('Find similar entities error', error);
    res.status(500).json({
      error: 'Failed to find similar entities',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/canonical/{name}:
 *   get:
 *     summary: Get canonical entity
 *     description: Get the canonical (authoritative) version of an entity
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity name
 *     responses:
 *       200:
 *         description: Canonical entity found
 *       404:
 *         description: Entity not found
 */
app.get('/api/entities/canonical/:name', async (req, res) => {
  const { name } = req.params;

  try {
    const entityResolution = getEntityResolutionService();
    const canonical = await entityResolution.getCanonicalEntity(decodeURIComponent(name));

    if (!canonical) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    res.json(canonical);
  } catch (error) {
    log.errorWithStack('Get canonical entity error', error);
    res.status(500).json({
      error: 'Failed to get canonical entity',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/reindex:
 *   post:
 *     summary: Reindex entities from graph
 *     description: Rebuild the entity search index from the graph database (admin only)
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: Reindex completed
 */
app.post('/api/entities/reindex', async (req, res) => {
  try {
    const entityResolution = getEntityResolutionService();
    const result = await entityResolution.reindexEntitiesFromGraph();

    res.json({
      success: true,
      message: 'Entity reindex completed',
      stats: result,
    });
  } catch (error) {
    log.errorWithStack('Entity reindex error', error);
    res.status(500).json({
      error: 'Failed to reindex entities',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/cache/stats:
 *   get:
 *     summary: Get entity resolution cache statistics
 *     description: Returns detailed cache statistics including hit rates, sizes, and evictions for performance monitoring
 *     tags: [EntityResolution, Cache]
 *     responses:
 *       200:
 *         description: Cache statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 caches:
 *                   type: object
 *                 totals:
 *                   type: object
 *                 config:
 *                   type: object
 */
app.get('/api/entities/cache/stats', async (req, res) => {
  try {
    const entityResolution = getEntityResolutionService();
    const stats = entityResolution.getCacheStats();

    res.json(stats);
  } catch (error) {
    log.errorWithStack('Cache stats error', error);
    res.status(500).json({
      error: 'Failed to get cache statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/cache/health:
 *   get:
 *     summary: Get entity resolution cache health summary
 *     description: Returns a health summary suitable for monitoring and alerting
 *     tags: [EntityResolution, Cache]
 *     responses:
 *       200:
 *         description: Cache health retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [enabled, disabled]
 *                 overallHitRate:
 *                   type: string
 *                 utilization:
 *                   type: string
 *                 totalCachedItems:
 *                   type: integer
 *                 health:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 */
app.get('/api/entities/cache/health', async (req, res) => {
  try {
    const entityResolution = getEntityResolutionService();
    const health = entityResolution.getCacheHealth();

    res.json(health);
  } catch (error) {
    log.errorWithStack('Cache health error', error);
    res.status(500).json({
      error: 'Failed to get cache health',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/cache/clear:
 *   post:
 *     summary: Clear all entity resolution caches
 *     description: Clears all cached data. Use with caution as this may temporarily impact performance.
 *     tags: [EntityResolution, Cache]
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 */
app.post('/api/entities/cache/clear', async (req, res) => {
  try {
    const entityResolution = getEntityResolutionService();
    entityResolution.clearCache();

    res.json({
      success: true,
      message: 'Entity resolution cache cleared',
    });
  } catch (error) {
    log.errorWithStack('Cache clear error', error);
    res.status(500).json({
      error: 'Failed to clear cache',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/cache/invalidate/{name}:
 *   post:
 *     summary: Invalidate cache for a specific entity
 *     description: Invalidates all cached data related to a specific entity by name
 *     tags: [EntityResolution, Cache]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The entity name to invalidate
 *     responses:
 *       200:
 *         description: Cache invalidated successfully
 */
app.post('/api/entities/cache/invalidate/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const entityResolution = getEntityResolutionService();
    const invalidated = entityResolution.invalidateEntityCache(name);

    res.json({
      success: true,
      message: `Cache invalidated for entity: ${name}`,
      invalidatedEntries: invalidated,
    });
  } catch (error) {
    log.errorWithStack('Cache invalidate error', error);
    res.status(500).json({
      error: 'Failed to invalidate cache',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/cache/invalidate-document/{documentId}:
 *   post:
 *     summary: Invalidate cache for a specific document
 *     description: Invalidates all cached data related to entities from a specific document
 *     tags: [EntityResolution, Cache]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: The document ID to invalidate
 *     responses:
 *       200:
 *         description: Cache invalidated successfully
 */
app.post('/api/entities/cache/invalidate-document/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const entityResolution = getEntityResolutionService();
    const invalidated = entityResolution.invalidateDocumentCache(documentId);

    res.json({
      success: true,
      message: `Cache invalidated for document: ${documentId}`,
      invalidatedEntries: invalidated,
    });
  } catch (error) {
    log.errorWithStack('Cache invalidate document error', error);
    res.status(500).json({
      error: 'Failed to invalidate document cache',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/cache/reset-stats:
 *   post:
 *     summary: Reset cache statistics
 *     description: Resets all cache statistics counters while keeping the cached data
 *     tags: [EntityResolution, Cache]
 *     responses:
 *       200:
 *         description: Statistics reset successfully
 */
app.post('/api/entities/cache/reset-stats', async (req, res) => {
  try {
    const entityResolution = getEntityResolutionService();
    entityResolution.resetCacheStats();

    res.json({
      success: true,
      message: 'Cache statistics reset',
    });
  } catch (error) {
    log.errorWithStack('Cache reset stats error', error);
    res.status(500).json({
      error: 'Failed to reset cache statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/cache/toggle:
 *   post:
 *     summary: Enable or disable entity resolution caching
 *     description: Allows runtime toggling of the caching feature without restart
 *     tags: [EntityResolution, Cache]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Whether to enable or disable caching
 *     responses:
 *       200:
 *         description: Cache state toggled successfully
 */
app.post('/api/entities/cache/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'Bad request',
        message: 'enabled must be a boolean',
      });
    }

    const entityResolution = getEntityResolutionService();
    entityResolution.setCacheEnabled(enabled);

    res.json({
      success: true,
      message: `Entity resolution cache ${enabled ? 'enabled' : 'disabled'}`,
      enabled,
    });
  } catch (error) {
    log.errorWithStack('Cache toggle error', error);
    res.status(500).json({
      error: 'Failed to toggle cache',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/important:
 *   get:
 *     summary: Get important entities by graph centrality
 *     description: Return top entities ranked by importance using PageRank, Betweenness Centrality, or combined scores
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: algorithm
 *         schema:
 *           type: string
 *           enum: [pagerank, betweenness, combined]
 *           default: pagerank
 *         description: Algorithm to use for importance calculation
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of entities to return
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *         description: Optional entity ID to get importance score for a specific entity
 *     responses:
 *       200:
 *         description: Important entities retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 algorithm:
 *                   type: string
 *                 entities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       importance:
 *                         type: number
 *                       rank:
 *                         type: integer
 *                       percentile:
 *                         type: number
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalEntities:
 *                       type: integer
 *                     computedAt:
 *                       type: string
 *                     executionTimeMs:
 *                       type: integer
 *       500:
 *         description: Server error during importance calculation
 */
app.get('/api/entities/important', async (req, res) => {
  const algorithm = req.query.algorithm || 'pagerank';
  const limit = parseInt(req.query.limit) || 100;
  const entityId = req.query.entityId;

  try {
    const startTime = Date.now();
    let result;
    let entities = [];

    if (algorithm === 'pagerank') {
      result = await calculatePageRank();
      entities = result.rankedEntities.map((entity, index) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        importance: entity.pageRank,
        rank: index + 1,
        percentile: ((result.rankedEntities.length - index - 1) / result.rankedEntities.length) * 100,
      }));
    } else if (algorithm === 'betweenness') {
      result = await calculateBetweenness();
      entities = result.rankedEntities.map((entity, index) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        importance: entity.betweenness,
        rank: index + 1,
        percentile: ((result.rankedEntities.length - index - 1) / result.rankedEntities.length) * 100,
      }));
    } else if (algorithm === 'combined') {
      // Calculate both and combine scores
      const [pageRankResult, betweennessResult] = await Promise.all([
        calculatePageRank(),
        calculateBetweenness(),
      ]);

      // Create a map for quick lookup of betweenness scores
      const betweennessMap = new Map(
        betweennessResult.rankedEntities.map((e) => [e.id, e.betweenness])
      );

      // Combine scores: average of normalized PageRank and Betweenness
      const maxPageRank = Math.max(...pageRankResult.rankedEntities.map((e) => e.pageRank), 0.001);
      const maxBetweenness = Math.max(...betweennessResult.rankedEntities.map((e) => e.betweenness), 0.001);

      entities = pageRankResult.rankedEntities.map((entity) => {
        const normalizedPR = entity.pageRank / maxPageRank;
        const normalizedBW = (betweennessMap.get(entity.id) || 0) / maxBetweenness;
        const combinedScore = (normalizedPR + normalizedBW) / 2;

        return {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          description: entity.description,
          importance: combinedScore,
          pageRank: entity.pageRank,
          betweenness: betweennessMap.get(entity.id) || 0,
        };
      });

      // Sort by combined score
      entities.sort((a, b) => b.importance - a.importance);

      // Add rank and percentile after sorting
      entities = entities.map((entity, index) => ({
        ...entity,
        rank: index + 1,
        percentile: ((entities.length - index - 1) / entities.length) * 100,
      }));

      result = {
        metadata: {
          nodeCount: pageRankResult.metadata.nodeCount,
          edgeCount: pageRankResult.metadata.edgeCount,
          executionTimeMs: Date.now() - startTime,
        },
      };
    } else {
      return res.status(400).json({
        error: `Invalid algorithm: ${algorithm}. Must be one of: pagerank, betweenness, combined`,
      });
    }

    // If entityId is specified, return only that entity
    if (entityId) {
      const entity = entities.find((e) => e.id === entityId);
      if (!entity) {
        return res.status(404).json({ error: 'Entity not found' });
      }
      return res.json({
        algorithm,
        entity,
        metadata: {
          totalEntities: entities.length,
          computedAt: new Date().toISOString(),
          executionTimeMs: result.metadata?.executionTimeMs || (Date.now() - startTime),
        },
      });
    }

    // Return top N entities
    res.json({
      algorithm,
      entities: entities.slice(0, limit),
      metadata: {
        totalEntities: entities.length,
        returnedEntities: Math.min(limit, entities.length),
        computedAt: new Date().toISOString(),
        executionTimeMs: result.metadata?.executionTimeMs || (Date.now() - startTime),
      },
    });
  } catch (error) {
    log.errorWithStack('Entity importance calculation error', error);
    res.status(500).json({
      error: 'Failed to calculate entity importance',
      message: error.message,
    });
  }
});

// ============================================
// Entity Mention Tracking API Routes (F3.2.3)
// ============================================

/**
 * @swagger
 * /api/entities/{id}/history:
 *   get:
 *     summary: Get entity version history
 *     description: Returns the temporal version history for a specific entity (F2.3.5)
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: Entity version history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entityId:
 *                   type: string
 *                 name:
 *                   type: string
 *                 type:
 *                   type: string
 *                 versions:
 *                   type: array
 *                   items:
 *                     type: object
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalVersions:
 *                       type: integer
 *                     currentVersionId:
 *                       type: string
 *                     oldestVersionId:
 *                       type: string
 *                     newestVersionId:
 *                       type: string
 *                     retrievedAt:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: Entity not found
 */
app.get('/api/entities/:id/history', async (req, res) => {
  const entityId = req.params.id;

  try {
    const graphService = getGraphService();
    const entity = await graphService.findVertexById(entityId);

    if (!entity) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    const versions = await graphService.getEntityVersionHistoryById(entityId);
    const currentVersion = versions.find((version) => version.temporalStatus === 'current') ||
      versions[versions.length - 1] ||
      null;

    res.json({
      entityId,
      name: entity.name || null,
      type: entity.type || null,
      versions,
      metadata: {
        totalVersions: versions.length,
        currentVersionId: currentVersion?.id || null,
        oldestVersionId: versions[0]?.id || null,
        newestVersionId: versions[versions.length - 1]?.id || null,
        retrievedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.errorWithStack('Failed to get entity version history', error);
    res.status(500).json({
      error: 'Failed to get entity version history',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/{id}/mention-stats:
 *   get:
 *     summary: Get mention statistics for an entity
 *     description: Returns how many times an entity is mentioned across documents and which documents mention it
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID or name
 *     responses:
 *       200:
 *         description: Mention statistics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 type:
 *                   type: string
 *                 mentionCount:
 *                   type: integer
 *                   description: Total number of times entity is mentioned
 *                 documentCount:
 *                   type: integer
 *                   description: Number of unique documents mentioning this entity
 *                 sourceDocumentIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                 lastMentionedAt:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Entity not found
 */
app.get('/api/entities/:id/mention-stats', async (req, res) => {
  const entityId = req.params.id;

  try {
    const { getEntityMentionStats } = require('./services/importance-service');
    const stats = await getEntityMentionStats(decodeURIComponent(entityId));

    if (!stats) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    res.json(stats);
  } catch (error) {
    log.errorWithStack('Failed to get entity mention stats', error);
    res.status(500).json({
      error: 'Failed to get entity mention statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/top-mentioned:
 *   get:
 *     summary: Get top entities by mention count
 *     description: Returns entities ranked by how often they are mentioned across documents
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of entities to return
 *     responses:
 *       200:
 *         description: Top mentioned entities retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       mentionCount:
 *                         type: integer
 *                       documentCount:
 *                         type: integer
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalReturned:
 *                       type: integer
 *                     retrievedAt:
 *                       type: string
 *                       format: date-time
 */
app.get('/api/entities/top-mentioned', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;

  try {
    const { getTopEntitiesByMentionCount } = require('./services/importance-service');
    const entities = await getTopEntitiesByMentionCount(limit);

    res.json({
      entities,
      metadata: {
        totalReturned: entities.length,
        retrievedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.errorWithStack('Failed to get top mentioned entities', error);
    res.status(500).json({
      error: 'Failed to get top mentioned entities',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/entities/mention-analysis:
 *   get:
 *     summary: Get mention frequency analysis
 *     description: Returns analysis of entity mention patterns including distribution and statistics
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: Mention analysis retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalEntities:
 *                   type: integer
 *                 totalMentions:
 *                   type: integer
 *                 averageMentionCount:
 *                   type: number
 *                 maxMentionCount:
 *                   type: integer
 *                 minMentionCount:
 *                   type: integer
 *                 distribution:
 *                   type: object
 *                   description: Distribution of mention counts in buckets
 *                 topEntities:
 *                   type: array
 *                   items:
 *                     type: object
 */
app.get('/api/entities/mention-analysis', async (req, res) => {
  try {
    const { getMentionFrequencyAnalysis } = require('./services/importance-service');
    const analysis = await getMentionFrequencyAnalysis();

    res.json({
      ...analysis,
      metadata: {
        analyzedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.errorWithStack('Failed to get mention analysis', error);
    res.status(500).json({
      error: 'Failed to get mention frequency analysis',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/leaderboard:
 *   get:
 *     summary: Get user leaderboard
 *     description: Retrieve the gamification leaderboard
 *     tags: [Gamification]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of top users to return
 *     responses:
 *       200:
 *         description: Leaderboard retrieved successfully
 */
app.get('/api/leaderboard', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const scores = await LeaderboardService.getLeaderboard(limit);
  res.json(scores);
});

// ============================================
// Staging API Routes
// ============================================

/**
 * @swagger
 * /api/staging/sessions:
 *   post:
 *     summary: Create a staging session
 *     description: Create a new staging session for reviewing and editing document entities
 *     tags: [Staging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *             properties:
 *               documentId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Staging session created successfully
 *       404:
 *         description: Document not found
 */
app.post('/api/staging/sessions', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required' });
    }

    const user = req.user || {};
    const stagingService = getStagingService();
    const session = await stagingService.createSession(
      documentId,
      user.oid || user.sub || 'unknown',
      user.preferred_username || user.upn || '',
      user.name || 'Unknown User'
    );

    res.status(201).json(session);
  } catch (error) {
    log.errorWithStack('Create staging session error', error);
    if (error.message === 'Document not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create staging session', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}:
 *   get:
 *     summary: Get a staging session
 *     description: Retrieve a staging session by ID with all staged entities and changes
 *     tags: [Staging]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staging session retrieved successfully
 *       404:
 *         description: Staging session not found
 */
app.get('/api/staging/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();
    const session = await stagingService.getSession(id, documentId);

    if (!session) {
      return res.status(404).json({ error: 'Staging session not found' });
    }

    res.json(session);
  } catch (error) {
    log.errorWithStack('Get staging session error', error);
    res.status(500).json({ error: 'Failed to get staging session', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}:
 *   delete:
 *     summary: Discard a staging session
 *     description: Discard all changes and delete the staging session
 *     tags: [Staging]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staging session discarded successfully
 *       404:
 *         description: Staging session not found
 */
app.delete('/api/staging/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const user = req.user || {};
    const stagingService = getStagingService();

    await stagingService.discardSession(id, documentId, user);
    res.json({ success: true, message: 'Staging session discarded' });
  } catch (error) {
    log.errorWithStack('Discard staging session error', error);
    if (error.message === 'Staging session not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to discard staging session', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities:
 *   post:
 *     summary: Add a new entity to staging
 *     description: Add a new entity to the staging session
 *     tags: [Staging]
 */
app.post('/api/staging/sessions/:id/entities', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const entityData = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.addEntity(id, documentId, entityData);
    res.status(201).json(session);
  } catch (error) {
    log.errorWithStack('Add entity to staging error', error);
    res.status(500).json({ error: 'Failed to add entity', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities/{entityId}:
 *   patch:
 *     summary: Modify an entity in staging
 *     description: Update an entity's properties in the staging session
 *     tags: [Staging]
 */
app.patch('/api/staging/sessions/:id/entities/:entityId', async (req, res) => {
  try {
    const { id, entityId } = req.params;
    const { documentId } = req.query;
    const updates = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.modifyEntity(id, documentId, entityId, updates);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Modify entity in staging error', error);
    res.status(500).json({ error: 'Failed to modify entity', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities/{entityId}:
 *   delete:
 *     summary: Delete an entity from staging
 *     description: Mark an entity as deleted in the staging session
 *     tags: [Staging]
 */
app.delete('/api/staging/sessions/:id/entities/:entityId', async (req, res) => {
  try {
    const { id, entityId } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();

    const session = await stagingService.deleteEntity(id, documentId, entityId);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Delete entity from staging error', error);
    res.status(500).json({ error: 'Failed to delete entity', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities/{entityId}/position:
 *   patch:
 *     summary: Update entity position
 *     description: Update an entity's position in the graph layout
 *     tags: [Staging]
 */
app.patch('/api/staging/sessions/:id/entities/:entityId/position', async (req, res) => {
  try {
    const { id, entityId } = req.params;
    const { documentId } = req.query;
    const { position } = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.updateEntityPosition(id, documentId, entityId, position);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Update entity position error', error);
    res.status(500).json({ error: 'Failed to update entity position', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/relationships:
 *   post:
 *     summary: Add a new relationship to staging
 *     description: Add a new relationship between entities in the staging session
 *     tags: [Staging]
 */
app.post('/api/staging/sessions/:id/relationships', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const relationshipData = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.addRelationship(id, documentId, relationshipData);
    res.status(201).json(session);
  } catch (error) {
    log.errorWithStack('Add relationship to staging error', error);
    res.status(500).json({ error: 'Failed to add relationship', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/relationships/{relId}:
 *   patch:
 *     summary: Modify a relationship in staging
 *     description: Update a relationship's properties in the staging session
 *     tags: [Staging]
 */
app.patch('/api/staging/sessions/:id/relationships/:relId', async (req, res) => {
  try {
    const { id, relId } = req.params;
    const { documentId } = req.query;
    const updates = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.modifyRelationship(id, documentId, relId, updates);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Modify relationship in staging error', error);
    res.status(500).json({ error: 'Failed to modify relationship', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/relationships/{relId}:
 *   delete:
 *     summary: Delete a relationship from staging
 *     description: Mark a relationship as deleted in the staging session
 *     tags: [Staging]
 */
app.delete('/api/staging/sessions/:id/relationships/:relId', async (req, res) => {
  try {
    const { id, relId } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();

    const session = await stagingService.deleteRelationship(id, documentId, relId);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Delete relationship from staging error', error);
    res.status(500).json({ error: 'Failed to delete relationship', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/preview:
 *   get:
 *     summary: Preview staging changes
 *     description: Get a preview of all changes that will be applied when committing
 *     tags: [Staging]
 */
app.get('/api/staging/sessions/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();

    const preview = await stagingService.getPreview(id, documentId);
    res.json(preview);
  } catch (error) {
    log.errorWithStack('Get staging preview error', error);
    res.status(500).json({ error: 'Failed to get preview', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/commit:
 *   post:
 *     summary: Commit staging changes
 *     description: Commit all staged changes to the production knowledge graph
 *     tags: [Staging]
 */
app.post('/api/staging/sessions/:id/commit', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const user = req.user || {};
    const stagingService = getStagingService();

    const result = await stagingService.commitSession(id, documentId, user);
    res.json(result);
  } catch (error) {
    log.errorWithStack('Commit staging session error', error);
    res.status(500).json({ error: 'Failed to commit changes', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/document/{documentId}:
 *   get:
 *     summary: Get staging session by document ID
 *     description: Retrieve the active staging session for a document
 *     tags: [Staging]
 */
app.get('/api/staging/sessions/document/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const stagingService = getStagingService();

    const session = await stagingService.getSessionByDocument(documentId);
    if (!session) {
      return res.status(404).json({ error: 'No staging session found for this document' });
    }

    res.json(session);
  } catch (error) {
    log.errorWithStack('Get staging session by document error', error);
    res.status(500).json({ error: 'Failed to get staging session', message: error.message });
  }
});

// ============================================
// Evaluation Results Storage API Routes (F1.3.2)
// ============================================

// Lazy load evaluation results storage service
let resultsStorageService = null;
function getEvaluationResultsService() {
  if (!resultsStorageService) {
    const { getResultsStorageService } = require('./evaluation/results-storage-service');
    resultsStorageService = getResultsStorageService();
  }
  return resultsStorageService;
}

/**
 * @swagger
 * /api/evaluation/runs:
 *   get:
 *     summary: Get recent evaluation runs
 *     description: Retrieve recent benchmark evaluation runs with optional filtering
 *     tags: [Evaluation]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of runs to return
 *       - in: query
 *         name: gitBranch
 *         schema:
 *           type: string
 *         description: Filter by git branch
 *     responses:
 *       200:
 *         description: List of evaluation runs
 */
app.get('/api/evaluation/runs', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const limit = parseInt(req.query.limit) || 10;
    const gitBranch = req.query.gitBranch || null;

    const runs = await service.getRecentRuns({ limit, gitBranch });
    res.json({ runs, count: runs.length });
  } catch (error) {
    log.errorWithStack('Get evaluation runs error', error);
    res.status(500).json({ error: 'Failed to get evaluation runs', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/runs/{runId}:
 *   get:
 *     summary: Get a specific evaluation run
 *     description: Retrieve a benchmark evaluation run by ID
 *     tags: [Evaluation]
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Evaluation run details
 *       404:
 *         description: Run not found
 */
app.get('/api/evaluation/runs/:runId', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const run = await service.getRun(req.params.runId);

    if (!run) {
      return res.status(404).json({ error: 'Evaluation run not found' });
    }

    res.json(run);
  } catch (error) {
    log.errorWithStack('Get evaluation run error', error);
    res.status(500).json({ error: 'Failed to get evaluation run', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/runs:
 *   post:
 *     summary: Store a new evaluation run
 *     description: Store benchmark evaluation results for trend analysis
 *     tags: [Evaluation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - results
 *             properties:
 *               results:
 *                 type: object
 *                 description: Benchmark results from run-benchmark.js
 *               runName:
 *                 type: string
 *               gitCommit:
 *                 type: string
 *               gitBranch:
 *                 type: string
 *               tags:
 *                 type: object
 *     responses:
 *       201:
 *         description: Run stored successfully
 */
app.post('/api/evaluation/runs', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const { results, runName, gitCommit, gitBranch, tags } = req.body;

    if (!results) {
      return res.status(400).json({ error: 'results object is required' });
    }

    const storedRun = await service.storeRun(results, {
      runName,
      gitCommit,
      gitBranch,
      tags,
    });

    res.status(201).json(storedRun);
  } catch (error) {
    log.errorWithStack('Store evaluation run error', error);
    res.status(500).json({ error: 'Failed to store evaluation run', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/runs/{runId}:
 *   delete:
 *     summary: Delete an evaluation run
 *     description: Delete a benchmark evaluation run by ID
 *     tags: [Evaluation]
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Run deleted successfully
 *       404:
 *         description: Run not found
 */
app.delete('/api/evaluation/runs/:runId', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const deleted = await service.deleteRun(req.params.runId);

    if (!deleted) {
      return res.status(404).json({ error: 'Evaluation run not found' });
    }

    res.json({ success: true, message: 'Evaluation run deleted' });
  } catch (error) {
    log.errorWithStack('Delete evaluation run error', error);
    res.status(500).json({ error: 'Failed to delete evaluation run', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/baseline:
 *   get:
 *     summary: Get the current baseline
 *     description: Retrieve the baseline for comparison
 *     tags: [Evaluation]
 *     parameters:
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *           default: default
 *         description: Baseline name
 *     responses:
 *       200:
 *         description: Baseline details
 *       404:
 *         description: Baseline not found
 */
app.get('/api/evaluation/baseline', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const baselineName = req.query.name || 'default';
    const baseline = await service.getBaseline(baselineName);

    if (!baseline) {
      return res.status(404).json({ error: 'Baseline not found' });
    }

    res.json(baseline);
  } catch (error) {
    log.errorWithStack('Get baseline error', error);
    res.status(500).json({ error: 'Failed to get baseline', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/baseline:
 *   post:
 *     summary: Set a new baseline
 *     description: Set an evaluation run as the baseline for future comparisons
 *     tags: [Evaluation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - runId
 *             properties:
 *               runId:
 *                 type: string
 *               name:
 *                 type: string
 *                 default: default
 *     responses:
 *       200:
 *         description: Baseline set successfully
 */
app.post('/api/evaluation/baseline', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const { runId, name } = req.body;

    if (!runId) {
      return res.status(400).json({ error: 'runId is required' });
    }

    const baseline = await service.setBaseline(runId, name || 'default');
    res.json(baseline);
  } catch (error) {
    log.errorWithStack('Set baseline error', error);
    res.status(500).json({ error: 'Failed to set baseline', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/trends/{metricName}:
 *   get:
 *     summary: Get metric trend over time
 *     description: Retrieve historical trend data for a specific metric
 *     tags: [Evaluation]
 *     parameters:
 *       - in: path
 *         name: metricName
 *         required: true
 *         schema:
 *           type: string
 *           enum: [mrr, map, answerQuality, groundingScore, citationAccuracy, entityF1, entityPrecision, entityRecall, relationshipF1, directionAccuracy]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: gitBranch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Trend data with statistics
 */
app.get('/api/evaluation/trends/:metricName', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const limit = parseInt(req.query.limit) || 20;
    const gitBranch = req.query.gitBranch || null;

    const trend = await service.getMetricTrend(req.params.metricName, { limit, gitBranch });
    res.json(trend);
  } catch (error) {
    log.errorWithStack('Get metric trend error', error);
    res.status(500).json({ error: 'Failed to get metric trend', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/trends:
 *   get:
 *     summary: Get all metric trends
 *     description: Retrieve historical trend data for all metrics
 *     tags: [Evaluation]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: gitBranch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All metric trends with statistics
 */
app.get('/api/evaluation/trends', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const limit = parseInt(req.query.limit) || 20;
    const gitBranch = req.query.gitBranch || null;

    const trends = await service.getAllMetricTrends({ limit, gitBranch });
    res.json(trends);
  } catch (error) {
    log.errorWithStack('Get all metric trends error', error);
    res.status(500).json({ error: 'Failed to get metric trends', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/compare:
 *   post:
 *     summary: Compare two evaluation runs
 *     description: Compare metrics between two runs to identify regressions and improvements
 *     tags: [Evaluation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - runId1
 *               - runId2
 *             properties:
 *               runId1:
 *                 type: string
 *                 description: Baseline run ID
 *               runId2:
 *                 type: string
 *                 description: Current run ID
 *               regressionThreshold:
 *                 type: number
 *                 default: 0.05
 *     responses:
 *       200:
 *         description: Comparison results with regressions and improvements
 */
app.post('/api/evaluation/compare', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const { runId1, runId2, regressionThreshold } = req.body;

    if (!runId1 || !runId2) {
      return res.status(400).json({ error: 'runId1 and runId2 are required' });
    }

    const comparison = await service.compareRuns(runId1, runId2, { regressionThreshold });
    res.json(comparison);
  } catch (error) {
    log.errorWithStack('Compare runs error', error);
    res.status(500).json({ error: 'Failed to compare runs', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/compare-baseline:
 *   post:
 *     summary: Compare a run against the baseline
 *     description: Compare an evaluation run against the established baseline
 *     tags: [Evaluation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - runId
 *             properties:
 *               runId:
 *                 type: string
 *               baselineName:
 *                 type: string
 *                 default: default
 *     responses:
 *       200:
 *         description: Comparison results against baseline
 */
app.post('/api/evaluation/compare-baseline', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const { runId, baselineName } = req.body;

    if (!runId) {
      return res.status(400).json({ error: 'runId is required' });
    }

    const comparison = await service.compareToBaseline(runId, baselineName || 'default');
    res.json(comparison);
  } catch (error) {
    log.errorWithStack('Compare to baseline error', error);
    res.status(500).json({ error: 'Failed to compare to baseline', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/stats:
 *   get:
 *     summary: Get evaluation storage statistics
 *     description: Get statistics about stored evaluation results
 *     tags: [Evaluation]
 *     responses:
 *       200:
 *         description: Storage statistics
 */
app.get('/api/evaluation/stats', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const stats = await service.getStats();
    res.json(stats);
  } catch (error) {
    log.errorWithStack('Get evaluation stats error', error);
    res.status(500).json({ error: 'Failed to get evaluation stats', message: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/health:
 *   get:
 *     summary: Check evaluation storage health
 *     description: Check if the evaluation results storage is healthy
 *     tags: [Evaluation]
 *     responses:
 *       200:
 *         description: Storage health status
 */
app.get('/api/evaluation/health', async (req, res) => {
  try {
    const service = getEvaluationResultsService();
    const health = await service.healthCheck();
    res.json(health);
  } catch (error) {
    log.errorWithStack('Evaluation health check error', error);
    res.status(500).json({ healthy: false, error: error.message });
  }
});

// ============================================
// Evaluation Dashboard API Routes (F1.3.5)
// ============================================

// Lazy-load dashboard service
function getEvaluationDashboardService() {
  const { getDashboardService } = require('./evaluation/dashboard-service');
  return getDashboardService();
}

/**
 * @swagger
 * /api/evaluation/dashboard:
 *   get:
 *     summary: Generate evaluation dashboard
 *     description: Generate a comprehensive dashboard showing metric trends and health status
 *     tags: [Evaluation]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of recent runs to analyze
 *       - in: query
 *         name: gitBranch
 *         schema:
 *           type: string
 *         description: Filter by git branch
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, markdown]
 *           default: json
 *         description: Output format
 *     responses:
 *       200:
 *         description: Dashboard data or markdown report
 */
app.get('/api/evaluation/dashboard', async (req, res) => {
  try {
    const service = getEvaluationDashboardService();
    const { limit = 20, gitBranch, format = 'json' } = req.query;

    const dashboard = await service.generateDashboard({
      limit: parseInt(limit, 10),
      gitBranch: gitBranch || null,
      format,
    });

    if (format === 'markdown') {
      res.type('text/markdown').send(dashboard);
    } else {
      res.json(dashboard);
    }
  } catch (error) {
    log.errorWithStack('Dashboard generation error', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/dashboard/comparison:
 *   get:
 *     summary: Generate baseline comparison report
 *     description: Generate a report comparing current metrics against baseline
 *     tags: [Evaluation]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, markdown]
 *           default: json
 *         description: Output format
 *     responses:
 *       200:
 *         description: Comparison report data or markdown
 */
app.get('/api/evaluation/dashboard/comparison', async (req, res) => {
  try {
    const service = getEvaluationDashboardService();
    const { format = 'json' } = req.query;

    const report = await service.generateComparisonReport({ format });

    if (format === 'markdown') {
      res.type('text/markdown').send(report);
    } else {
      res.json(report);
    }
  } catch (error) {
    log.errorWithStack('Comparison report generation error', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/dashboard/status:
 *   get:
 *     summary: Get quick evaluation status
 *     description: Get a quick overview of evaluation health and key metrics
 *     tags: [Evaluation]
 *     responses:
 *       200:
 *         description: Quick status data
 */
app.get('/api/evaluation/dashboard/status', async (req, res) => {
  try {
    const service = getEvaluationDashboardService();
    const status = await service.getQuickStatus();
    res.json(status);
  } catch (error) {
    log.errorWithStack('Status check error', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// A/B Chunking Comparison API Routes (F4.1.4)
// ============================================

/**
 * @swagger
 * /api/evaluation/chunking/compare:
 *   post:
 *     summary: Compare semantic vs fixed-size chunking strategies
 *     description: Analyzes the same document using both chunking strategies and compares retrieval quality metrics.
 *     tags: [Evaluation, Chunking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentText
 *               - testQueries
 *             properties:
 *               documentText:
 *                 type: string
 *                 description: The document text to chunk and analyze
 *               testQueries:
 *                 type: array
 *                 description: Test queries with relevance keywords
 *                 items:
 *                   type: object
 *                   properties:
 *                     question:
 *                       type: string
 *                     relevantChunkKeywords:
 *                       type: array
 *                       items:
 *                         type: string
 *               options:
 *                 type: object
 *                 properties:
 *                   fixed:
 *                     type: object
 *                     properties:
 *                       chunkSize:
 *                         type: integer
 *                         default: 500
 *                       overlap:
 *                         type: integer
 *                         default: 50
 *                   semantic:
 *                     type: object
 *                     properties:
 *                       breakpointPercentileThreshold:
 *                         type: integer
 *                         default: 95
 *                       bufferSize:
 *                         type: integer
 *                         default: 1
 *                   kValues:
 *                     type: array
 *                     items:
 *                       type: integer
 *                     default: [1, 3, 5, 10]
 *     responses:
 *       200:
 *         description: Comparison results with metrics for both strategies
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Server error
 */
app.post('/api/evaluation/chunking/compare', async (req, res) => {
  try {
    const { documentText, testQueries, options } = req.body;

    if (!documentText || typeof documentText !== 'string') {
      return res.status(400).json({ error: 'documentText is required and must be a string' });
    }

    if (!testQueries || !Array.isArray(testQueries) || testQueries.length === 0) {
      return res.status(400).json({ error: 'testQueries is required and must be a non-empty array' });
    }

    // Validate queries
    for (const query of testQueries) {
      if (!query.question || typeof query.question !== 'string') {
        return res.status(400).json({ error: 'Each query must have a question string' });
      }
    }

    const { compareChunkingStrategies } = require('./evaluation');
    const results = await compareChunkingStrategies(documentText, testQueries, options || {});

    res.json(results);
  } catch (error) {
    log.errorWithStack('Chunking comparison error', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/chunking/compare/report:
 *   post:
 *     summary: Compare chunking strategies and return formatted report
 *     description: Same as /compare but returns a human-readable text report
 *     tags: [Evaluation, Chunking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChunkingComparisonRequest'
 *     responses:
 *       200:
 *         description: Formatted text report
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
app.post('/api/evaluation/chunking/compare/report', async (req, res) => {
  try {
    const { documentText, testQueries, options } = req.body;

    if (!documentText || typeof documentText !== 'string') {
      return res.status(400).json({ error: 'documentText is required and must be a string' });
    }

    if (!testQueries || !Array.isArray(testQueries) || testQueries.length === 0) {
      return res.status(400).json({ error: 'testQueries is required and must be a non-empty array' });
    }

    const { compareChunkingStrategies, formatComparisonReport } = require('./evaluation');
    const results = await compareChunkingStrategies(documentText, testQueries, options || {});
    const report = formatComparisonReport(results);

    res.type('text/plain').send(report);
  } catch (error) {
    log.errorWithStack('Chunking comparison report error', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/evaluation/chunking/benchmark:
 *   post:
 *     summary: Run chunking comparison against a benchmark dataset
 *     description: Runs A/B comparison across multiple test cases and aggregates results
 *     tags: [Evaluation, Chunking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dataset
 *             properties:
 *               dataset:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   testCases:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         documentText:
 *                           type: string
 *                         queries:
 *                           type: array
 *               options:
 *                 type: object
 *     responses:
 *       200:
 *         description: Aggregated benchmark results
 */
app.post('/api/evaluation/chunking/benchmark', async (req, res) => {
  try {
    const { dataset, options } = req.body;

    if (!dataset || !dataset.testCases || !Array.isArray(dataset.testCases)) {
      return res.status(400).json({ error: 'dataset with testCases array is required' });
    }

    const { runComparisonBenchmark } = require('./evaluation');
    const results = await runComparisonBenchmark(dataset, options || {});

    res.json(results);
  } catch (error) {
    log.errorWithStack('Chunking benchmark error', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Ontology API Routes (F2.1.5)
// ============================================

// Lazy load ontology service
let ontologyService = null;
async function getInitializedOntologyService() {
  if (!ontologyService) {
    const { initializeOntologyService } = require('./services/ontology-service');
    ontologyService = await initializeOntologyService();
  }
  return ontologyService;
}

/**
 * @swagger
 * /api/ontology/types:
 *   get:
 *     summary: Get ontology types and schema
 *     description: Returns the current ontology including entity types, relationship types, and type hierarchy. Enables dynamic UI generation for entity/relationship selection.
 *     tags: [Ontology]
 *     parameters:
 *       - in: query
 *         name: view
 *         schema:
 *           type: string
 *           enum: [full, entity-types, relationship-types, hierarchy, metadata]
 *           default: full
 *         description: Which part of the ontology to return
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Get details for a specific entity type (used with view=hierarchy)
 *     responses:
 *       200:
 *         description: Ontology schema data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     label:
 *                       type: string
 *                     version:
 *                       type: string
 *                     entityTypeCount:
 *                       type: integer
 *                     relationshipTypeCount:
 *                       type: integer
 *                 entityTypes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       label:
 *                         type: string
 *                       comment:
 *                         type: string
 *                       parent:
 *                         type: string
 *                 relationshipTypes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       label:
 *                         type: string
 *                       comment:
 *                         type: string
 *                       domain:
 *                         type: string
 *                       range:
 *                         type: string
 *                       inverse:
 *                         type: string
 *                 hierarchy:
 *                   type: object
 *                   description: Type hierarchy with ancestors and subtypes
 *       500:
 *         description: Server error loading ontology
 */
app.get('/api/ontology/types', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const view = req.query.view || 'full';
    const typeName = req.query.type;

    let response = {};

    switch (view) {
      case 'entity-types':
        response = {
          entityTypes: service.getValidEntityTypes(),
          count: service.getValidEntityTypes().length
        };
        break;

      case 'relationship-types':
        response = {
          relationshipTypes: service.getValidRelationshipTypes(),
          count: service.getValidRelationshipTypes().length
        };
        break;

      case 'hierarchy':
        if (typeName) {
          // Get hierarchy for a specific type
          const ancestors = service.getTypeAncestors(typeName);
          const subtypes = service.getSubtypes(typeName);
          response = {
            type: typeName,
            ancestors,
            subtypes,
            isValid: service.validateEntityType(typeName).valid
          };
        } else {
          // Get full hierarchy tree
          const entityTypes = service.getValidEntityTypes();
          const hierarchy = {};
          for (const et of entityTypes) {
            hierarchy[et.name] = {
              parent: et.parent,
              ancestors: service.getTypeAncestors(et.name),
              subtypes: service.getSubtypes(et.name)
            };
          }
          response = { hierarchy };
        }
        break;

      case 'metadata':
        response = service.getOntologyMetadata();
        break;

      case 'full':
      default:
        response = {
          metadata: service.getOntologyMetadata(),
          entityTypes: service.getValidEntityTypes(),
          relationshipTypes: service.getValidRelationshipTypes()
        };
        break;
    }

    res.json(response);
  } catch (error) {
    log.errorWithStack('Get ontology types error', error);
    res.status(500).json({ error: 'Failed to load ontology', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-types:
 *   post:
 *     summary: Add a custom entity type
 *     description: Define a new custom entity type at runtime. This type persists across restarts.
 *     tags: [Ontology]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique name of the entity type (e.g., "Vendor")
 *               label:
 *                 type: string
 *                 description: Display label
 *               description:
 *                 type: string
 *                 description: Description of the entity type
 *               parentType:
 *                 type: string
 *                 description: Parent type to inherit from (default "Entity")
 *     responses:
 *       201:
 *         description: Custom type created successfully
 *       400:
 *         description: Invalid input or type already exists
 *       500:
 *         description: Server error
 */
app.post('/api/ontology/custom-types', authenticateJwt, async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const result = await service.addCustomEntityType(req.body);
    
    log.info('Custom entity type added', { 
      name: result.name, 
      user: req.user?.id 
    });

    res.status(201).json({
      success: true,
      message: `Custom type "${result.name}" created successfully`,
      type: result
    });
  } catch (error) {
    log.errorWithStack('Add custom type error', error);
    res.status(400).json({ error: 'Failed to add custom type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-types/{name}:
 *   delete:
 *     summary: Delete a custom entity type
 *     description: Delete a custom entity type. Only custom types can be deleted.
 *     tags: [Ontology]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the custom entity type to delete
 *     responses:
 *       200:
 *         description: Custom type deleted successfully
 *       404:
 *         description: Type not found
 *       400:
 *         description: Cannot delete core types
 */
app.delete('/api/ontology/custom-types/:name', authenticateJwt, async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { name } = req.params;
    
    await service.deleteCustomEntityType(name);
    
    log.info('Custom entity type deleted', { 
      name, 
      user: req.user?.id 
    });

    res.json({
      success: true,
      message: `Custom type "${name}" deleted successfully`
    });
  } catch (error) {
    log.errorWithStack('Delete custom type error', error);
    res.status(400).json({ error: 'Failed to delete custom type', message: error.message });
  }
});

// ==================== Custom Relationship Type Endpoints ====================
// Feature: F4.3.5 - Custom Relationship Definitions

/**
 * @swagger
 * /api/ontology/custom-relationship-types:
 *   get:
 *     summary: Get all custom relationship types
 *     description: Returns all custom relationship types defined at runtime
 *     tags: [Ontology]
 *     responses:
 *       200:
 *         description: List of custom relationship types
 */
app.get('/api/ontology/custom-relationship-types', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const relationships = service.getCustomRelationshipTypes();

    res.json({
      success: true,
      relationships,
      count: relationships.length
    });
  } catch (error) {
    log.errorWithStack('Get custom relationship types error', error);
    res.status(500).json({ error: 'Failed to get custom relationship types', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-relationship-types:
 *   post:
 *     summary: Add a custom relationship type
 *     description: Define a new custom relationship type with domain/range constraints. This type persists across restarts.
 *     tags: [Ontology]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - domain
 *               - range
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique name of the relationship type in UPPER_SNAKE_CASE (e.g., "COLLABORATES_WITH")
 *               label:
 *                 type: string
 *               description:
 *                 type: string
 *               domain:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *                 description: Source entity type(s) allowed
 *               range:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *                 description: Target entity type(s) allowed
 *               inverse:
 *                 type: string
 *               category:
 *                 type: string
 *               bidirectional:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Custom relationship type created successfully
 *       400:
 *         description: Invalid input or relationship type already exists
 *       500:
 *         description: Server error
 */
app.post('/api/ontology/custom-relationship-types', authenticateJwt, async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const result = await service.addCustomRelationshipType(req.body);

    log.info('Custom relationship type added', {
      name: result.name,
      domain: result.domain,
      range: result.range,
      user: req.user?.id
    });

    res.status(201).json({
      success: true,
      message: `Custom relationship type "${result.name}" created successfully`,
      relationship: result
    });
  } catch (error) {
    log.errorWithStack('Add custom relationship type error', error);
    res.status(400).json({ error: 'Failed to add custom relationship type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-relationship-types/{name}:
 *   delete:
 *     summary: Delete a custom relationship type
 *     description: Delete a custom relationship type. Only custom types can be deleted.
 *     tags: [Ontology]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the custom relationship type to delete
 *     responses:
 *       200:
 *         description: Custom relationship type deleted successfully
 *       404:
 *         description: Relationship type not found
 *       400:
 *         description: Cannot delete core types
 */
app.delete('/api/ontology/custom-relationship-types/:name', authenticateJwt, async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { name } = req.params;
    
    await service.deleteCustomRelationshipType(name);
    
    log.info('Custom relationship type deleted', { 
      name, 
      user: req.user?.id 
    });

    res.json({
      success: true,
      message: `Custom relationship type "${name}" deleted successfully`
    });
  } catch (error) {
    log.errorWithStack('Delete custom relationship type error', error);
    res.status(400).json({ error: 'Failed to delete custom relationship type', message: error.message });
  }
});

// ==================== Custom Relationship Type Endpoints ====================
// Feature: F4.3.5 - Custom Relationship Definitions

/**
 * @swagger
 * /api/ontology/custom-relationships:
 *   get:
 *     summary: Get all custom relationship types
 *     description: Returns all custom relationship types defined at runtime
 *     tags: [Ontology]
 *     responses:
 *       200:
 *         description: List of custom relationship types
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 relationships:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       label:
 *                         type: string
 *                       domain:
 *                         type: array
 *                         items:
 *                           type: string
 *                       range:
 *                         type: array
 *                         items:
 *                           type: string
 */
app.get('/api/ontology/custom-relationships', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const relationships = service.getCustomRelationshipTypes();

    res.json({
      success: true,
      relationships,
      count: relationships.length
    });
  } catch (error) {
    log.errorWithStack('Get custom relationship types error', error);
    res.status(500).json({ error: 'Failed to get custom relationship types', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-relationships:
 *   post:
 *     summary: Add a custom relationship type
 *     description: Define a new custom relationship type with domain/range constraints. This type persists across restarts.
 *     tags: [Ontology]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - domain
 *               - range
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique name of the relationship type in UPPER_SNAKE_CASE (e.g., "COLLABORATES_WITH")
 *               label:
 *                 type: string
 *                 description: Display label
 *               description:
 *                 type: string
 *                 description: Description of the relationship
 *               domain:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *                 description: Source entity type(s) allowed (e.g., "Person" or ["Person", "Team"])
 *               range:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *                 description: Target entity type(s) allowed
 *               inverse:
 *                 type: string
 *                 description: Name of the inverse relationship (optional)
 *               category:
 *                 type: string
 *                 description: Category for grouping (default "Custom")
 *               bidirectional:
 *                 type: boolean
 *                 description: Whether the relationship is bidirectional
 *     responses:
 *       201:
 *         description: Custom relationship type created successfully
 *       400:
 *         description: Invalid input or relationship type already exists
 *       500:
 *         description: Server error
 */
app.post('/api/ontology/custom-relationships', authenticateJwt, async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const result = await service.addCustomRelationshipType(req.body);

    log.info('Custom relationship type added', {
      name: result.name,
      domain: result.domain,
      range: result.range,
      user: req.user?.id
    });

    res.status(201).json({
      success: true,
      message: `Custom relationship type "${result.name}" created successfully`,
      relationship: result
    });
  } catch (error) {
    log.errorWithStack('Add custom relationship type error', error);
    res.status(400).json({ error: 'Failed to add custom relationship type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-relationships/{name}:
 *   get:
 *     summary: Get a custom relationship type by name
 *     description: Returns the details of a specific custom relationship type
 *     tags: [Ontology]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the relationship type
 *     responses:
 *       200:
 *         description: Relationship type details
 *       404:
 *         description: Relationship type not found
 */
app.get('/api/ontology/custom-relationships/:name', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { name } = req.params;

    const relationships = service.getCustomRelationshipTypes();
    const relationship = relationships.find(r => r.name === name);

    if (!relationship) {
      return res.status(404).json({
        success: false,
        error: 'Relationship type not found',
        message: `Custom relationship type "${name}" does not exist`
      });
    }

    res.json({
      success: true,
      relationship
    });
  } catch (error) {
    log.errorWithStack('Get custom relationship type error', error);
    res.status(500).json({ error: 'Failed to get custom relationship type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-relationships/{name}:
 *   put:
 *     summary: Update a custom relationship type
 *     description: Update an existing custom relationship type. Cannot change the name.
 *     tags: [Ontology]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the relationship type to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *               description:
 *                 type: string
 *               domain:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               range:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               inverse:
 *                 type: string
 *               category:
 *                 type: string
 *               bidirectional:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Relationship type updated successfully
 *       400:
 *         description: Invalid input or cannot modify core types
 *       404:
 *         description: Relationship type not found
 */
app.put('/api/ontology/custom-relationships/:name', authenticateJwt, async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { name } = req.params;

    const result = await service.updateCustomRelationshipType(name, req.body);

    log.info('Custom relationship type updated', {
      name,
      user: req.user?.id
    });

    res.json({
      success: true,
      message: `Custom relationship type "${name}" updated successfully`,
      relationship: result
    });
  } catch (error) {
    log.errorWithStack('Update custom relationship type error', error);
    res.status(400).json({ error: 'Failed to update custom relationship type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-relationships/{name}:
 *   delete:
 *     summary: Delete a custom relationship type
 *     description: Delete a custom relationship type. Only custom types can be deleted.
 *     tags: [Ontology]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the custom relationship type to delete
 *     responses:
 *       200:
 *         description: Custom relationship type deleted successfully
 *       404:
 *         description: Relationship type not found
 *       400:
 *         description: Cannot delete core types
 */
app.delete('/api/ontology/custom-relationships/:name', authenticateJwt, async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { name } = req.params;

    await service.deleteCustomRelationshipType(name);

    log.info('Custom relationship type deleted', {
      name,
      user: req.user?.id
    });

    res.json({
      success: true,
      message: `Custom relationship type "${name}" deleted successfully`
    });
  } catch (error) {
    log.errorWithStack('Delete custom relationship type error', error);
    res.status(400).json({ error: 'Failed to delete custom relationship type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/custom-relationships/validate:
 *   post:
 *     summary: Validate a relationship against custom type constraints
 *     description: Check if a relationship is valid according to domain/range constraints
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - relationshipType
 *               - sourceType
 *               - targetType
 *             properties:
 *               relationshipType:
 *                 type: string
 *                 description: The relationship type name
 *               sourceType:
 *                 type: string
 *                 description: The source entity type
 *               targetType:
 *                 type: string
 *                 description: The target entity type
 *     responses:
 *       200:
 *         description: Validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 */
app.post('/api/ontology/custom-relationships/validate', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { relationshipType, sourceType, targetType } = req.body;

    if (!relationshipType || !sourceType || !targetType) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'relationshipType, sourceType, and targetType are all required'
      });
    }

    const result = service.validateRelationshipConstraints(relationshipType, sourceType, targetType);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    log.errorWithStack('Validate relationship constraints error', error);
    res.status(500).json({ error: 'Failed to validate relationship constraints', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/validate:
 *   post:
 *     summary: Validate entities and relationships against ontology
 *     description: Validates a batch of entities and relationships against the ontology schema, checking type validity and domain/range constraints
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               entities:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     type:
 *                       type: string
 *               relationships:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     from:
 *                       type: string
 *                     to:
 *                       type: string
 *                     type:
 *                       type: string
 *     responses:
 *       200:
 *         description: Validation report
 *       400:
 *         description: Invalid request body
 */
app.post('/api/ontology/validate', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { entities = [], relationships = [] } = req.body;

    const report = service.generateValidationReport(entities, relationships);
    res.json(report);
  } catch (error) {
    log.errorWithStack('Ontology validation error', error);
    res.status(500).json({ error: 'Failed to validate against ontology', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/normalize:
 *   post:
 *     summary: Normalize relationship types
 *     description: Normalize relationship type names using synonym mappings (e.g., "manages" -> "MANAGES")
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - types
 *             properties:
 *               types:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Relationship types to normalize
 *     responses:
 *       200:
 *         description: Normalized relationship types
 */
app.post('/api/ontology/normalize', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { types = [] } = req.body;

    const normalized = types.map(type => ({
      original: type,
      normalized: service.normalizeRelationshipType(type)
    }));

    res.json({ normalizedTypes: normalized });
  } catch (error) {
    log.errorWithStack('Relationship normalization error', error);
    res.status(500).json({ error: 'Failed to normalize relationship types', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/types/{type}/subtree:
 *   get:
 *     summary: Get type hierarchy subtree (F2.1.2 - Polymorphic Queries)
 *     description: Returns the specified type and all its subtypes for polymorphic queries. This enables querying by parent type (e.g., BusinessFlowEntity) to match all subtypes (Process, Task, Activity, Decision).
 *     tags: [Ontology]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *         description: The parent type to expand (e.g., BusinessFlowEntity, OrganizationalEntity)
 *       - in: query
 *         name: includeParent
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include the parent type itself in the results
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [list, tree, hierarchy]
 *           default: list
 *         description: Response format (list=flat array, tree=nested structure, hierarchy=with depth info)
 *     responses:
 *       200:
 *         description: Type subtree information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rootType:
 *                   type: string
 *                   description: The requested root type
 *                 types:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: All types in the subtree (for polymorphic query filters)
 *                 tree:
 *                   type: object
 *                   description: Nested tree structure (when format=tree)
 *                 hierarchy:
 *                   type: object
 *                   description: Type info with depth levels (when format=hierarchy)
 */
app.get('/api/ontology/types/:type/subtree', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { type } = req.params;
    const { includeParent = 'true', format = 'list' } = req.query;

    const expansion = service.expandTypeWithSubtypes(type, {
      includeParent: includeParent === 'true'
    });

    const response = {
      rootType: type,
      types: expansion.types,
      typeCount: expansion.types.length
    };

    // Add warning if type not found
    if (expansion.warning) {
      response.warning = expansion.warning;
    }

    // Add format-specific data
    if (format === 'tree' || format === 'hierarchy') {
      const tree = service.getTypeTree(type);
      if (tree) {
        response.tree = tree;
      }
    }

    if (format === 'hierarchy') {
      response.hierarchy = expansion.hierarchy;
    }

    res.json(response);
  } catch (error) {
    log.errorWithStack('Type subtree error', error);
    res.status(500).json({ error: 'Failed to get type subtree', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/version:
 *   get:
 *     summary: Get ontology version information (F2.2.1)
 *     description: Returns comprehensive version information including semantic version, version IRI, dates, and metadata
 *     tags: [Ontology]
 *     responses:
 *       200:
 *         description: Version information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 versionIRI:
 *                   type: string
 *                   example: "https://business-knowledge-engine.io/ontology/business-process/1.0.0"
 *                 priorVersion:
 *                   type: string
 *                   nullable: true
 *                 parsed:
 *                   type: object
 *                   properties:
 *                     major:
 *                       type: integer
 *                     minor:
 *                       type: integer
 *                     patch:
 *                       type: integer
 *                 metadata:
 *                   type: object
 *                 dates:
 *                   type: object
 */
app.get('/api/ontology/version', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const versionInfo = service.getVersionInfo();
    res.json(versionInfo);
  } catch (error) {
    log.errorWithStack('Version info error', error);
    res.status(500).json({ error: 'Failed to get version info', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/version/history:
 *   get:
 *     summary: Get ontology version history (F2.2.1)
 *     description: Returns the complete version history with changes for each release
 *     tags: [Ontology]
 *     responses:
 *       200:
 *         description: Version history array
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   version:
 *                     type: string
 *                   releaseDate:
 *                     type: string
 *                   changes:
 *                     type: array
 *                     items:
 *                       type: string
 */
app.get('/api/ontology/version/history', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const history = service.getVersionHistory();
    res.json({
      currentVersion: service.getVersionInfo().version,
      history
    });
  } catch (error) {
    log.errorWithStack('Version history error', error);
    res.status(500).json({ error: 'Failed to get version history', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/version/compare:
 *   post:
 *     summary: Compare two ontology versions (F2.2.1)
 *     description: Compare two version strings and get change type information
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - versionA
 *               - versionB
 *             properties:
 *               versionA:
 *                 type: string
 *                 example: "1.0.0"
 *               versionB:
 *                 type: string
 *                 example: "2.0.0"
 *     responses:
 *       200:
 *         description: Comparison result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comparison:
 *                   type: integer
 *                   description: -1 if A < B, 0 if equal, 1 if A > B
 *                 changeType:
 *                   type: object
 *                 compatible:
 *                   type: object
 */
app.post('/api/ontology/version/compare', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { versionA, versionB } = req.body;

    if (!versionA || !versionB) {
      return res.status(400).json({ error: 'Both versionA and versionB are required' });
    }

    const comparison = service.compareVersions(versionA, versionB);
    const changeType = service.getVersionChangeType(versionA, versionB);
    const compatible = service.isVersionCompatible(versionA, versionB);

    res.json({
      versionA: {
        raw: versionA,
        parsed: service.parseVersion(versionA)
      },
      versionB: {
        raw: versionB,
        parsed: service.parseVersion(versionB)
      },
      comparison,
      comparisonDescription: comparison === 0 ? 'equal' : comparison > 0 ? 'A > B' : 'A < B',
      changeType,
      compatible
    });
  } catch (error) {
    log.errorWithStack('Version compare error', error);
    res.status(500).json({ error: 'Failed to compare versions', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/version/validate:
 *   post:
 *     summary: Validate a version string (F2.2.1)
 *     description: Validate that a version string follows semantic versioning format
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - version
 *             properties:
 *               version:
 *                 type: string
 *                 example: "1.2.3-beta.1"
 *     responses:
 *       200:
 *         description: Validation result
 */
app.post('/api/ontology/version/validate', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { version } = req.body;

    if (!version) {
      return res.status(400).json({ error: 'Version is required' });
    }

    const validation = service.validateVersion(version);
    const parsed = service.parseVersion(version);

    res.json({
      version,
      ...validation,
      parsed,
      formats: validation.valid ? {
        short: service.formatVersion(version, 'short'),
        full: service.formatVersion(version, 'full'),
        semantic: service.formatVersion(version, 'semantic'),
        iri: service.formatVersion(version, 'iri')
      } : null
    });
  } catch (error) {
    log.errorWithStack('Version validate error', error);
    res.status(500).json({ error: 'Failed to validate version', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/version/next:
 *   get:
 *     summary: Get next version number (F2.2.1)
 *     description: Calculate the next version number based on change type
 *     tags: [Ontology]
 *     parameters:
 *       - in: query
 *         name: changeType
 *         schema:
 *           type: string
 *           enum: [major, minor, patch]
 *           default: patch
 *         description: Type of version bump
 *       - in: query
 *         name: preRelease
 *         schema:
 *           type: string
 *         description: Optional pre-release identifier (e.g., beta.1, alpha)
 *     responses:
 *       200:
 *         description: Next version information
 */
app.get('/api/ontology/version/next', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { changeType = 'patch', preRelease } = req.query;

    if (!['major', 'minor', 'patch'].includes(changeType)) {
      return res.status(400).json({ error: 'changeType must be major, minor, or patch' });
    }

    const currentVersion = service.getVersionInfo().version;
    const nextVersion = service.getNextVersion(changeType, preRelease || null);

    res.json({
      currentVersion,
      nextVersion,
      changeType,
      preRelease: preRelease || null,
      changeDescription: service.getVersionChangeType(currentVersion, nextVersion)
    });
  } catch (error) {
    log.errorWithStack('Next version error', error);
    res.status(500).json({ error: 'Failed to calculate next version', message: error.message });
  }
});

// ============================================
// Type Deprecation API Routes (F2.2.3)
// ============================================

/**
 * @swagger
 * /api/ontology/deprecated:
 *   get:
 *     summary: Get all deprecated types (F2.2.3)
 *     description: Returns all deprecated entity and relationship types with their replacement mappings
 *     tags: [Ontology]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [entity, relationship]
 *         description: Filter by type category
 *       - in: query
 *         name: withReplacement
 *         schema:
 *           type: boolean
 *         description: Only show types that have a replacement defined
 *     responses:
 *       200:
 *         description: List of deprecated types
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 types:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       category:
 *                         type: string
 *                       replacement:
 *                         type: string
 *                       reason:
 *                         type: string
 *                       removalVersion:
 *                         type: string
 */
app.get('/api/ontology/deprecated', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { category, withReplacement } = req.query;

    const types = service.getDeprecatedTypes({
      category,
      withReplacement: withReplacement === 'true'
    });

    res.json({
      count: types.length,
      types,
      validation: service.validateDeprecations()
    });
  } catch (error) {
    log.errorWithStack('Get deprecated types error', error);
    res.status(500).json({ error: 'Failed to get deprecated types', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/deprecated/{type}:
 *   get:
 *     summary: Get deprecation info for a specific type (F2.2.3)
 *     description: Returns deprecation details for a specific type including replacement mapping and migration path
 *     tags: [Ontology]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *         description: The type name to check
 *     responses:
 *       200:
 *         description: Deprecation information
 *       404:
 *         description: Type not deprecated or not found
 */
app.get('/api/ontology/deprecated/:type', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { type } = req.params;

    if (!service.isTypeDeprecated(type)) {
      // Check if type exists at all
      const entityValid = service.validateEntityType(type, { warnOnDeprecated: false });
      const relValid = service.relationshipTypes.has(service.normalizeRelationshipType(type));

      if (entityValid.valid || relValid) {
        return res.json({
          type,
          deprecated: false,
          message: `Type "${type}" exists but is not deprecated`
        });
      }

      return res.status(404).json({
        error: `Type "${type}" is not found in the ontology`
      });
    }

    const info = service.getDeprecationInfo(type);
    const migrationPath = service.getMigrationPath(type);
    const warning = service.getDeprecationWarning(type);

    res.json({
      type,
      deprecated: true,
      ...info,
      replacement: info?.replacedBy ? service._extractLocalName(info.replacedBy) : null,
      warning,
      migrationPath
    });
  } catch (error) {
    log.errorWithStack('Get deprecation info error', error);
    res.status(500).json({ error: 'Failed to get deprecation info', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/deprecated/{type}/migration-path:
 *   get:
 *     summary: Get migration path from deprecated type (F2.2.3)
 *     description: Returns the full migration path from a deprecated type to its final non-deprecated replacement
 *     tags: [Ontology]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *         description: The deprecated type to get migration path for
 *     responses:
 *       200:
 *         description: Migration path information
 */
app.get('/api/ontology/deprecated/:type/migration-path', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { type } = req.params;

    const migrationPath = service.getMigrationPath(type);

    res.json({
      type,
      isDeprecated: service.isTypeDeprecated(type),
      ...migrationPath
    });
  } catch (error) {
    log.errorWithStack('Get migration path error', error);
    res.status(500).json({ error: 'Failed to get migration path', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/deprecate:
 *   post:
 *     summary: Deprecate a type (runtime only) (F2.2.3)
 *     description: Mark a type as deprecated at runtime. This does NOT persist to the ontology file - use migrations for permanent changes.
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 description: The type to deprecate
 *               replacedBy:
 *                 type: string
 *                 description: The replacement type
 *               reason:
 *                 type: string
 *                 description: Reason for deprecation
 *               removalVersion:
 *                 type: string
 *                 description: Planned removal version
 *               migrationGuide:
 *                 type: string
 *                 description: Migration instructions or URL
 *     responses:
 *       200:
 *         description: Type deprecated successfully
 *       400:
 *         description: Invalid type or parameters
 */
app.post('/api/ontology/deprecate', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { type, replacedBy, reason, removalVersion, migrationGuide } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Type name is required' });
    }

    const result = service.deprecateType(type, {
      replacedBy,
      reason,
      removalVersion,
      migrationGuide
    });

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json({
      ...result,
      note: 'This deprecation is runtime-only. Use ontology migrations for permanent changes.'
    });
  } catch (error) {
    log.errorWithStack('Deprecate type error', error);
    res.status(500).json({ error: 'Failed to deprecate type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/undeprecate:
 *   post:
 *     summary: Remove deprecation from a type (runtime only) (F2.2.3)
 *     description: Remove deprecation status from a type at runtime. This does NOT persist - use migrations for permanent changes.
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 description: The type to undeprecate
 *     responses:
 *       200:
 *         description: Deprecation removed successfully
 *       400:
 *         description: Type not deprecated
 */
app.post('/api/ontology/undeprecate', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const { type } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Type name is required' });
    }

    const result = service.undeprecateType(type);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json({
      ...result,
      note: 'This change is runtime-only. Use ontology migrations for permanent changes.'
    });
  } catch (error) {
    log.errorWithStack('Undeprecate type error', error);
    res.status(500).json({ error: 'Failed to undeprecate type', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/deprecated/validate:
 *   get:
 *     summary: Validate all deprecations (F2.2.3)
 *     description: Check all deprecated types for issues like circular references, missing replacements, etc.
 *     tags: [Ontology]
 *     responses:
 *       200:
 *         description: Validation results
 */
app.get('/api/ontology/deprecated/validate', async (req, res) => {
  try {
    const service = await getInitializedOntologyService();
    const validation = service.validateDeprecations();

    res.json(validation);
  } catch (error) {
    log.errorWithStack('Validate deprecations error', error);
    res.status(500).json({ error: 'Failed to validate deprecations', message: error.message });
  }
});

/**
 * @swagger
 * /api/graphrag/query-by-type:
 *   get:
 *     summary: Query entities by type with polymorphic expansion (F2.1.2)
 *     description: Query entities by type, automatically including all subtypes. For example, querying BusinessFlowEntity returns Process, Task, Activity, and Decision entities.
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *         description: The type to query (e.g., BusinessFlowEntity, Process, Role)
 *       - in: query
 *         name: includeSubtypes
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include subtypes in query (polymorphic query)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of results
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *         description: Field to order by (e.g., name, createdAt)
 *       - in: query
 *         name: descending
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Order results descending
 *     responses:
 *       200:
 *         description: Entities matching the type query
 */
app.get('/api/graphrag/query-by-type', async (req, res) => {
  try {
    const { type, includeSubtypes = 'true', limit = '100', orderBy, descending = 'false' } = req.query;

    if (!type) {
      return res.status(400).json({ error: 'Type parameter is required' });
    }

    const graphRAG = getGraphRAGService();
    const result = await graphRAG.queryByType(type, {
      includeSubtypes: includeSubtypes === 'true',
      limit: parseInt(limit, 10),
      orderBy,
      descending: descending === 'true'
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Query by type error', error);
    res.status(500).json({ error: 'Failed to query by type', message: error.message });
  }
});

/**
 * @swagger
 * /api/graphrag/query-with-type-filter:
 *   post:
 *     summary: GraphRAG query with polymorphic type filtering (F2.1.2)
 *     description: Performs a GraphRAG query and filters results to include only entities of the specified type (and optionally its subtypes).
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: The query text
 *               typeFilter:
 *                 type: string
 *                 description: Filter results to this type (and subtypes)
 *               includeSubtypes:
 *                 type: boolean
 *                 default: true
 *                 description: Include subtypes in the type filter
 *     responses:
 *       200:
 *         description: Filtered GraphRAG query results
 */
app.post('/api/graphrag/query-with-type-filter', async (req, res) => {
  try {
    const { query, typeFilter, includeSubtypes = true, ...options } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query text is required' });
    }

    const graphRAG = getGraphRAGService();
    const result = await graphRAG.queryWithTypeFilter(query, {
      typeFilter,
      includeSubtypes,
      ...options
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Query with type filter error', error);
    res.status(500).json({ error: 'Failed to execute query with type filter', message: error.message });
  }
});

// ============================================
// Time-Aware Graph Query API Routes (F2.3.4)
// ============================================

/**
 * @swagger
 * /api/graphrag/temporal/query:
 *   post:
 *     summary: Time-aware GraphRAG query (F2.3.4)
 *     description: Query the knowledge graph at a specific point in time. Returns entities and relationships that were valid at the specified timestamp.
 *     tags: [GraphRAG, Temporal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *               - pointInTime
 *             properties:
 *               query:
 *                 type: string
 *                 description: The query text
 *               pointInTime:
 *                 type: string
 *                 format: date-time
 *                 description: ISO timestamp for the temporal context (e.g., "2024-01-01T00:00:00Z")
 *               maxEntities:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of entities to return
 *               maxHops:
 *                 type: integer
 *                 default: 3
 *                 description: Maximum traversal depth
 *               includeChunks:
 *                 type: boolean
 *                 default: true
 *                 description: Include document chunks in results
 *     responses:
 *       200:
 *         description: Time-aware query results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 context:
 *                   type: string
 *                   description: Assembled context for LLM
 *                 pointInTime:
 *                   type: string
 *                   format: date-time
 *                 entities:
 *                   type: array
 *                   items:
 *                     type: object
 *                 relationships:
 *                   type: array
 *                   items:
 *                     type: object
 *                 metadata:
 *                   type: object
 *       400:
 *         description: Missing required parameters
 */
app.post('/api/graphrag/temporal/query', userQueryLimiter, async (req, res) => {
  try {
    const { query, pointInTime, ...options } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query text is required' });
    }

    if (!pointInTime) {
      return res.status(400).json({
        error: 'pointInTime is required',
        example: '2024-01-01T00:00:00Z',
      });
    }

    // Validate timestamp
    const timestamp = new Date(pointInTime);
    if (isNaN(timestamp.getTime())) {
      return res.status(400).json({
        error: 'Invalid pointInTime format',
        message: 'Must be a valid ISO 8601 timestamp',
        example: '2024-01-01T00:00:00Z',
      });
    }

    const graphRAG = getGraphRAGService();
    const result = await graphRAG.queryAtTime(query, pointInTime, options);

    res.json(result);
  } catch (error) {
    log.errorWithStack('Time-aware query error', error);
    res.status(500).json({
      error: 'Failed to execute time-aware query',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/temporal/answer:
 *   post:
 *     summary: Generate answer for time-aware query (F2.3.4)
 *     description: Generate an LLM answer based on the graph state at a specific point in time.
 *     tags: [GraphRAG, Temporal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *               - pointInTime
 *             properties:
 *               query:
 *                 type: string
 *                 description: The question to answer
 *               pointInTime:
 *                 type: string
 *                 format: date-time
 *                 description: ISO timestamp for the temporal context
 *               maxTokens:
 *                 type: integer
 *                 default: 1000
 *                 description: Maximum tokens in the answer
 *     responses:
 *       200:
 *         description: Time-aware answer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                 pointInTime:
 *                   type: string
 *                   format: date-time
 *                 sources:
 *                   type: object
 *                 metadata:
 *                   type: object
 */
app.post('/api/graphrag/temporal/answer', userQueryLimiter, async (req, res) => {
  try {
    const { query, pointInTime, ...options } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query text is required' });
    }

    if (!pointInTime) {
      return res.status(400).json({
        error: 'pointInTime is required',
        example: '2024-01-01T00:00:00Z',
      });
    }

    const timestamp = new Date(pointInTime);
    if (isNaN(timestamp.getTime())) {
      return res.status(400).json({
        error: 'Invalid pointInTime format',
        message: 'Must be a valid ISO 8601 timestamp',
      });
    }

    const graphRAG = getGraphRAGService();
    const result = await graphRAG.generateAnswerAtTime(query, pointInTime, options);

    res.json(result);
  } catch (error) {
    log.errorWithStack('Time-aware answer generation error', error);
    res.status(500).json({
      error: 'Failed to generate time-aware answer',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/temporal/snapshot:
 *   get:
 *     summary: Get graph snapshot at point in time (F2.3.4)
 *     description: Returns a snapshot of the knowledge graph as it existed at a specific point in time.
 *     tags: [GraphRAG, Temporal]
 *     parameters:
 *       - in: query
 *         name: pointInTime
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO timestamp for the snapshot
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by entity type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Maximum number of entities
 *       - in: query
 *         name: includeRelationships
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include relationships in snapshot
 *     responses:
 *       200:
 *         description: Graph snapshot
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pointInTime:
 *                   type: string
 *                   format: date-time
 *                 entities:
 *                   type: array
 *                 relationships:
 *                   type: array
 *                 metadata:
 *                   type: object
 */
app.get('/api/graphrag/temporal/snapshot', async (req, res) => {
  try {
    const { pointInTime, type, limit = 500, includeRelationships = 'true' } = req.query;

    if (!pointInTime) {
      return res.status(400).json({
        error: 'pointInTime query parameter is required',
        example: '?pointInTime=2024-01-01T00:00:00Z',
      });
    }

    const timestamp = new Date(pointInTime);
    if (isNaN(timestamp.getTime())) {
      return res.status(400).json({
        error: 'Invalid pointInTime format',
        message: 'Must be a valid ISO 8601 timestamp',
      });
    }

    const graphRAG = getGraphRAGService();
    const snapshot = await graphRAG.getGraphSnapshot(pointInTime, {
      type: type || null,
      limit: parseInt(limit, 10),
      includeRelationships: includeRelationships === 'true',
    });

    res.json(snapshot);
  } catch (error) {
    log.errorWithStack('Graph snapshot error', error);
    res.status(500).json({
      error: 'Failed to get graph snapshot',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/temporal/compare:
 *   get:
 *     summary: Compare graph state between two points in time (F2.3.4)
 *     description: Shows entities that were added, removed, or persisted between two timestamps.
 *     tags: [GraphRAG, Temporal]
 *     parameters:
 *       - in: query
 *         name: time1
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: First point in time (earlier)
 *       - in: query
 *         name: time2
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Second point in time (later)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by entity type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum entities per snapshot
 *     responses:
 *       200:
 *         description: Comparison results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 time1:
 *                   type: string
 *                   format: date-time
 *                 time2:
 *                   type: string
 *                   format: date-time
 *                 comparison:
 *                   type: object
 *                   properties:
 *                     added:
 *                       type: integer
 *                     removed:
 *                       type: integer
 *                     persisted:
 *                       type: integer
 *                 addedEntities:
 *                   type: array
 *                 removedEntities:
 *                   type: array
 *                 persistedEntities:
 *                   type: array
 */
app.get('/api/graphrag/temporal/compare', async (req, res) => {
  try {
    const { time1, time2, type, limit = 100 } = req.query;

    if (!time1 || !time2) {
      return res.status(400).json({
        error: 'Both time1 and time2 query parameters are required',
        example: '?time1=2024-01-01T00:00:00Z&time2=2024-06-01T00:00:00Z',
      });
    }

    const timestamp1 = new Date(time1);
    const timestamp2 = new Date(time2);

    if (isNaN(timestamp1.getTime()) || isNaN(timestamp2.getTime())) {
      return res.status(400).json({
        error: 'Invalid timestamp format',
        message: 'Both time1 and time2 must be valid ISO 8601 timestamps',
      });
    }

    const graphRAG = getGraphRAGService();
    const comparison = await graphRAG.compareGraphStates(time1, time2, {
      type: type || null,
      limit: parseInt(limit, 10),
    });

    res.json(comparison);
  } catch (error) {
    log.errorWithStack('Graph comparison error', error);
    res.status(500).json({
      error: 'Failed to compare graph states',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/temporal/traverse:
 *   post:
 *     summary: Traverse graph from seed entities at a point in time (F2.3.4)
 *     description: Performs a BFS traversal from seed entities, only following paths that existed at the specified time.
 *     tags: [GraphRAG, Temporal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - seedEntities
 *               - pointInTime
 *             properties:
 *               seedEntities:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Names of seed entities to start traversal from
 *               pointInTime:
 *                 type: string
 *                 format: date-time
 *                 description: ISO timestamp for the traversal context
 *               maxDepth:
 *                 type: integer
 *                 default: 2
 *                 description: Maximum traversal depth
 *               maxEntities:
 *                 type: integer
 *                 default: 50
 *                 description: Maximum entities to return
 *     responses:
 *       200:
 *         description: Traversal results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pointInTime:
 *                   type: string
 *                   format: date-time
 *                 entities:
 *                   type: array
 *                 relationships:
 *                   type: array
 *                 metadata:
 *                   type: object
 */
app.post('/api/graphrag/temporal/traverse', userQueryLimiter, async (req, res) => {
  try {
    const { seedEntities, pointInTime, maxDepth = 2, maxEntities = 50 } = req.body;

    if (!seedEntities || !Array.isArray(seedEntities) || seedEntities.length === 0) {
      return res.status(400).json({
        error: 'seedEntities array is required and must not be empty',
      });
    }

    if (!pointInTime) {
      return res.status(400).json({
        error: 'pointInTime is required',
        example: '2024-01-01T00:00:00Z',
      });
    }

    const timestamp = new Date(pointInTime);
    if (isNaN(timestamp.getTime())) {
      return res.status(400).json({
        error: 'Invalid pointInTime format',
        message: 'Must be a valid ISO 8601 timestamp',
      });
    }

    const graphService = getGraphService();
    const result = await graphService.traverseGraphAt(seedEntities, pointInTime, {
      maxDepth,
      maxEntities,
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Time-aware traversal error', error);
    res.status(500).json({
      error: 'Failed to traverse graph at time',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/temporal/neighbors:
 *   get:
 *     summary: Get entity neighbors at a point in time (F2.3.4)
 *     description: Returns neighbors of an entity that were valid at the specified time.
 *     tags: [GraphRAG, Temporal]
 *     parameters:
 *       - in: query
 *         name: entity
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the entity
 *       - in: query
 *         name: pointInTime
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO timestamp for the temporal context
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [outgoing, incoming, both]
 *           default: both
 *         description: Direction of relationships to follow
 *       - in: query
 *         name: maxNeighbors
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum neighbors to return
 *     responses:
 *       200:
 *         description: Neighbors valid at the specified time
 */
app.get('/api/graphrag/temporal/neighbors', async (req, res) => {
  try {
    const { entity, pointInTime, direction = 'both', maxNeighbors = 20 } = req.query;

    if (!entity) {
      return res.status(400).json({ error: 'entity query parameter is required' });
    }

    if (!pointInTime) {
      return res.status(400).json({
        error: 'pointInTime query parameter is required',
        example: '?entity=MyEntity&pointInTime=2024-01-01T00:00:00Z',
      });
    }

    const timestamp = new Date(pointInTime);
    if (isNaN(timestamp.getTime())) {
      return res.status(400).json({
        error: 'Invalid pointInTime format',
        message: 'Must be a valid ISO 8601 timestamp',
      });
    }

    const graphService = getGraphService();
    const result = await graphService.findNeighborsValidAt(entity, pointInTime, {
      direction,
      maxNeighbors: parseInt(maxNeighbors, 10),
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Time-aware neighbors error', error);
    res.status(500).json({
      error: 'Failed to get neighbors at time',
      message: error.message,
    });
  }
});

// ============================================
// Chunking API Routes (F4.1.3)
// ============================================

const { getChunkCoherenceScorer, formatCoherenceScore, formatBatchCoherence } = require('./chunking/chunk-coherence-score');
const { getSemanticChunker } = require('./chunking/semantic-chunker');

/**
 * @swagger
 * /api/chunking/coherence:
 *   post:
 *     summary: Calculate chunk coherence score
 *     description: Calculate semantic coherence score for a single chunk (F4.1.3). Higher scores indicate more semantically unified content.
 *     tags: [Chunking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: The text content to analyze for coherence
 *               quick:
 *                 type: boolean
 *                 default: false
 *                 description: Use quick sampling-based estimate (faster but less precise)
 *     responses:
 *       200:
 *         description: Coherence score result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 overallScore:
 *                   type: number
 *                   description: Combined coherence score (0-1, higher = more coherent)
 *                 centroidCoherence:
 *                   type: number
 *                 pairwiseCoherence:
 *                   type: number
 *                 varianceScore:
 *                   type: number
 *                 details:
 *                   type: object
 *                 method:
 *                   type: string
 *       400:
 *         description: Missing content parameter
 */
app.post('/api/chunking/coherence', userQueryLimiter, async (req, res) => {
  try {
    const { content, quick = false } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required and must be a string' });
    }

    const scorer = getChunkCoherenceScorer();
    const result = quick
      ? await scorer.quickCoherenceCheck(content)
      : await scorer.calculateCoherence(content);

    res.json(result);
  } catch (error) {
    log.errorWithStack('Chunk coherence calculation error', error);
    res.status(500).json({ error: 'Failed to calculate chunk coherence', message: error.message });
  }
});

/**
 * @swagger
 * /api/chunking/coherence/batch:
 *   post:
 *     summary: Calculate coherence scores for multiple chunks
 *     description: Calculate semantic coherence scores for a batch of chunks (F4.1.3). Returns individual and aggregate statistics.
 *     tags: [Chunking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - chunks
 *             properties:
 *               chunks:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of text chunks to analyze
 *     responses:
 *       200:
 *         description: Batch coherence results with aggregate statistics
 */
app.post('/api/chunking/coherence/batch', userQueryLimiter, async (req, res) => {
  try {
    const { chunks } = req.body;

    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      return res.status(400).json({ error: 'Chunks array is required and must not be empty' });
    }

    const scorer = getChunkCoherenceScorer();
    const result = await scorer.calculateBatchCoherence(chunks);

    res.json(result);
  } catch (error) {
    log.errorWithStack('Batch chunk coherence calculation error', error);
    res.status(500).json({ error: 'Failed to calculate batch chunk coherence', message: error.message });
  }
});

/**
 * @swagger
 * /api/chunking/semantic:
 *   post:
 *     summary: Semantically chunk text with coherence scoring
 *     description: Split text into semantically coherent chunks using topic detection, optionally including coherence scores (F4.1.1, F4.1.2, F4.1.3).
 *     tags: [Chunking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 description: The text to chunk
 *               includeCoherence:
 *                 type: boolean
 *                 default: false
 *                 description: Include coherence scores for each chunk
 *               breakpointPercentileThreshold:
 *                 type: number
 *                 default: 95
 *                 description: Percentile threshold for topic breakpoints (higher = fewer chunks)
 *     responses:
 *       200:
 *         description: Chunked text with metadata
 */
app.post('/api/chunking/semantic', userProcessingLimiter, async (req, res) => {
  try {
    const { text, includeCoherence = false, ...options } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required and must be a string' });
    }

    const chunker = getSemanticChunker();
    const result = includeCoherence
      ? await chunker.chunkTextWithCoherence(text, options)
      : await chunker.chunkText(text, options);

    res.json(result);
  } catch (error) {
    log.errorWithStack('Semantic chunking error', error);
    res.status(500).json({ error: 'Failed to chunk text', message: error.message });
  }
});

// ============================================
// Ontology Migration API Routes (F2.2.2)
// ============================================

const {
  getOntologyMigrationService,
  initializeOntologyMigrationService,
} = require('./services/ontology-migration-service');
const { createMigrationStorageAdapter } = require('./services/migration-storage-adapter');

// Lazy initialization of migration service
let migrationServicePromise = null;
async function getInitializedMigrationService() {
  if (!migrationServicePromise) {
    migrationServicePromise = (async () => {
      const storage = createMigrationStorageAdapter({
        type: process.env.MIGRATION_STORAGE_TYPE || 'file',
      });
      return initializeOntologyMigrationService({ storage });
    })();
  }
  return migrationServicePromise;
}

/**
 * @swagger
 * /api/ontology/migrations:
 *   get:
 *     summary: Get all migrations and their status (F2.2.2)
 *     description: Returns a list of all registered migrations with their status (pending, applied, failed)
 *     tags: [Ontology]
 *     responses:
 *       200:
 *         description: Migration status list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalMigrations:
 *                   type: integer
 *                 pendingCount:
 *                   type: integer
 *                 appliedCount:
 *                   type: integer
 *                 hasPending:
 *                   type: boolean
 *                 migrations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       version:
 *                         type: string
 *                       name:
 *                         type: string
 *                       status:
 *                         type: string
 *                       appliedAt:
 *                         type: string
 */
app.get('/api/ontology/migrations', async (req, res) => {
  try {
    const service = await getInitializedMigrationService();
    const status = service.getStatus();
    res.json(status);
  } catch (error) {
    log.errorWithStack('Get migrations status error', error);
    res.status(500).json({ error: 'Failed to get migrations status', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/migrations/pending:
 *   get:
 *     summary: Get pending migrations (F2.2.2)
 *     description: Returns a list of migrations that have not been applied yet
 *     tags: [Ontology]
 *     responses:
 *       200:
 *         description: List of pending migrations
 */
app.get('/api/ontology/migrations/pending', async (req, res) => {
  try {
    const service = await getInitializedMigrationService();
    const pending = service.getPendingMigrations();
    res.json({ count: pending.length, migrations: pending });
  } catch (error) {
    log.errorWithStack('Get pending migrations error', error);
    res.status(500).json({ error: 'Failed to get pending migrations', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/migrations/run/{version}:
 *   post:
 *     summary: Run a specific migration (F2.2.2)
 *     description: Execute a single migration by version. Supports dry-run mode to preview changes.
 *     tags: [Ontology]
 *     parameters:
 *       - in: path
 *         name: version
 *         required: true
 *         schema:
 *           type: string
 *         description: Migration version to run (e.g., "1.1.0")
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dryRun:
 *                 type: boolean
 *                 default: false
 *                 description: If true, preview changes without applying
 *     responses:
 *       200:
 *         description: Migration result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                 name:
 *                   type: string
 *                 dryRun:
 *                   type: boolean
 *                 success:
 *                   type: boolean
 *                 changes:
 *                   type: object
 *       400:
 *         description: Migration already applied or validation failed
 *       404:
 *         description: Migration not found
 */
app.post('/api/ontology/migrations/run/:version', async (req, res) => {
  try {
    const { version } = req.params;
    const { dryRun = false } = req.body || {};

    const service = await getInitializedMigrationService();
    const result = await service.runMigration(version, { dryRun });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.includes('already been applied')) {
      return res.status(400).json({ error: error.message });
    }
    log.errorWithStack('Run migration error', error);
    res.status(500).json({ error: 'Failed to run migration', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/migrations/run-all:
 *   post:
 *     summary: Run all pending migrations (F2.2.2)
 *     description: Execute all pending migrations in version order. Supports dry-run mode and stop-on-error behavior.
 *     tags: [Ontology]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dryRun:
 *                 type: boolean
 *                 default: false
 *                 description: If true, preview changes without applying
 *               stopOnError:
 *                 type: boolean
 *                 default: true
 *                 description: If true, stop execution on first error
 *     responses:
 *       200:
 *         description: Results of running all pending migrations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 migrationsRun:
 *                   type: integer
 *                 success:
 *                   type: boolean
 *                 dryRun:
 *                   type: boolean
 *                 results:
 *                   type: array
 */
app.post('/api/ontology/migrations/run-all', async (req, res) => {
  try {
    const { dryRun = false, stopOnError = true } = req.body || {};

    const service = await getInitializedMigrationService();
    const result = await service.runAllPending({ dryRun, stopOnError });

    res.json(result);
  } catch (error) {
    log.errorWithStack('Run all migrations error', error);
    res.status(500).json({ error: 'Failed to run migrations', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/migrations/preview/{version}:
 *   get:
 *     summary: Preview a migration (dry-run) (F2.2.2)
 *     description: Preview the changes a migration would make without applying it
 *     tags: [Ontology]
 *     parameters:
 *       - in: path
 *         name: version
 *         required: true
 *         schema:
 *           type: string
 *         description: Migration version to preview
 *     responses:
 *       200:
 *         description: Migration preview showing expected changes
 */
app.get('/api/ontology/migrations/preview/:version', async (req, res) => {
  try {
    const { version } = req.params;

    const service = await getInitializedMigrationService();
    const result = await service.runMigration(version, { dryRun: true });

    res.json({
      ...result,
      note: 'This is a dry-run preview. No changes have been applied.',
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    log.errorWithStack('Preview migration error', error);
    res.status(500).json({ error: 'Failed to preview migration', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/migrations/rollback/{version}:
 *   post:
 *     summary: Rollback a migration (F2.2.2)
 *     description: Rollback (undo) a previously applied migration by running its down function
 *     tags: [Ontology]
 *     parameters:
 *       - in: path
 *         name: version
 *         required: true
 *         schema:
 *           type: string
 *         description: Migration version to rollback
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dryRun:
 *                 type: boolean
 *                 default: false
 *                 description: If true, preview rollback without applying
 *     responses:
 *       200:
 *         description: Rollback result
 *       400:
 *         description: Migration not applied or doesn't support rollback
 *       404:
 *         description: Migration not found
 */
app.post('/api/ontology/migrations/rollback/:version', async (req, res) => {
  try {
    const { version } = req.params;
    const { dryRun = false } = req.body || {};

    const service = await getInitializedMigrationService();
    const result = await service.rollbackMigration(version, { dryRun });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.includes('has not been applied') || error.message.includes('does not support rollback')) {
      return res.status(400).json({ error: error.message });
    }
    log.errorWithStack('Rollback migration error', error);
    res.status(500).json({ error: 'Failed to rollback migration', message: error.message });
  }
});

/**
 * @swagger
 * /api/ontology/migrations/create:
 *   post:
 *     summary: Create a new migration file (F2.2.2)
 *     description: Generate a new migration file with a template. The file is created in /ontology/migrations/
 *     tags: [Ontology]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Migration name (will be converted to slug format)
 *               description:
 *                 type: string
 *                 description: Migration description
 *               targetVersion:
 *                 type: string
 *                 description: Target ontology version after migration
 *               format:
 *                 type: string
 *                 enum: [js, json]
 *                 default: js
 *                 description: File format (js for JavaScript, json for declarative)
 *     responses:
 *       201:
 *         description: Migration file created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                 name:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 filepath:
 *                   type: string
 *       400:
 *         description: Invalid parameters or file already exists
 */
app.post('/api/ontology/migrations/create', async (req, res) => {
  try {
    const { name, description, targetVersion, format = 'js' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Migration name is required' });
    }

    const service = await getInitializedMigrationService();
    const result = service.createMigration({ name, description, targetVersion, format });

    res.status(201).json({
      ...result,
      message: `Migration file created at ${result.filepath}. Edit this file to implement the migration logic.`,
    });
  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.status(400).json({ error: error.message });
    }
    log.errorWithStack('Create migration error', error);
    res.status(500).json({ error: 'Failed to create migration', message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  const errorContext = {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id || req.user?.email,
  };

  log.errorWithStack('Unhandled error', err, errorContext);

  // Track exception in Application Insights
  trackException(err, errorContext);

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// Start server
const server = app.listen(PORT, async () => {
  // Log configuration summary
  const configSummary = getConfigurationSummary();
  log.info('Configuration status:', configSummary);

  logStartup(PORT, {
    healthCheck: `http://localhost:${PORT}/health`,
    healthDependencies: `http://localhost:${PORT}/health/dependencies`,
    healthReady: `http://localhost:${PORT}/health/ready`,
    healthLive: `http://localhost:${PORT}/health/live`,
    swagger: `http://localhost:${PORT}/api-docs`,
  });

  // Perform startup health validation (FC.7)
  const healthService = getHealthCheckService();
  const startupResult = await healthService.performStartupValidation();
  if (!startupResult.success) {
    log.warn(
      { errors: startupResult.errors },
      'Startup health validation failed - some dependencies may be unavailable'
    );
  }

  // Start audit log retention scheduler (F5.1.4)
  startAuditRetentionScheduler();

  // Start default audit export schedule if archiving is enabled (F5.1.5)
  const auditExportService = getAuditExportService();
  auditExportService.startDefaultSchedule();
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  log.info(`${signal} received, starting graceful shutdown`);

  // Stop scheduled audit exports (F5.1.5)
  try {
    const auditExportService = getAuditExportService();
    auditExportService.shutdown();
    log.info('Audit export service shut down');
  } catch (err) {
    log.error('Error shutting down audit export service:', err);
  }

  // Stop accepting new connections
  server.close(async () => {
    log.info('HTTP server closed');

    // Flush telemetry before exit
    await flushTelemetry();

    log.info('Graceful shutdown completed');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
