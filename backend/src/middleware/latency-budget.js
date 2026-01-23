/**
 * Latency Budget Middleware (F5.2.5)
 *
 * Express middleware for automatic latency tracking and SLO enforcement.
 * Integrates with the LatencyBudgetService to track request latencies
 * and emit alerts when budgets are exceeded.
 *
 * Usage:
 *   const { latencyBudgetMiddleware, trackLatency } = require('./middleware/latency-budget');
 *
 *   // Track all requests with auto-detected operation type
 *   app.use(latencyBudgetMiddleware());
 *
 *   // Track specific routes with explicit operation type
 *   app.use('/api/graphrag', trackLatency('query'));
 *   app.use('/api/documents/process', trackLatency('processing'));
 *
 * @module middleware/latency-budget
 */

const { getLatencyBudgetService, OPERATION_TYPES } = require('../services/latency-budget-service');
const { log } = require('../utils/logger');

/**
 * Path patterns to operation type mapping
 */
const PATH_OPERATION_MAP = [
  { pattern: /^\/api\/graphrag\/query/i, operation: OPERATION_TYPES.QUERY },
  { pattern: /^\/api\/graphrag\/search/i, operation: OPERATION_TYPES.SEARCH },
  { pattern: /^\/api\/graphrag\/temporal/i, operation: OPERATION_TYPES.GRAPH_TRAVERSAL },
  { pattern: /^\/api\/graphrag\/impact/i, operation: OPERATION_TYPES.GRAPH_TRAVERSAL },
  { pattern: /^\/api\/graphrag\/communities/i, operation: OPERATION_TYPES.GRAPH_TRAVERSAL },
  { pattern: /^\/api\/graphrag/i, operation: OPERATION_TYPES.QUERY },
  { pattern: /^\/api\/documents\/process/i, operation: OPERATION_TYPES.PROCESSING },
  { pattern: /^\/api\/staging\/.*\/process/i, operation: OPERATION_TYPES.PROCESSING },
  { pattern: /^\/api\/entities\/resolve/i, operation: OPERATION_TYPES.ENTITY_RESOLUTION },
  { pattern: /^\/api\/entities\/merge/i, operation: OPERATION_TYPES.ENTITY_RESOLUTION },
  { pattern: /^\/api\/search/i, operation: OPERATION_TYPES.SEARCH },
  { pattern: /^\/api\/graph/i, operation: OPERATION_TYPES.GRAPH_TRAVERSAL },
];

/**
 * Paths to exclude from latency tracking
 */
const EXCLUDED_PATHS = [
  /^\/health/i,
  /^\/api\/health/i,
  /^\/api\/latency-budgets/i, // Don't track the monitoring endpoints themselves
  /^\/api\/circuit-breakers/i,
  /^\/api\/config/i,
  /^\/api\/feature-flags/i,
];

/**
 * Detect operation type from request path
 */
function detectOperationType(path, method) {
  // Check against path patterns
  for (const { pattern, operation } of PATH_OPERATION_MAP) {
    if (pattern.test(path)) {
      return operation;
    }
  }

  // Default based on method
  if (method === 'GET') {
    return OPERATION_TYPES.QUERY;
  }

  return null; // Unknown operation, will be tracked as 'unknown'
}

/**
 * Check if path should be excluded from tracking
 */
function shouldExcludePath(path) {
  return EXCLUDED_PATHS.some((pattern) => pattern.test(path));
}

/**
 * Create latency budget middleware with auto-detection
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.trackUnknown - Track requests with unknown operation type (default: true)
 * @param {boolean} options.includeRequestInfo - Include request info in context (default: true)
 * @returns {Function} Express middleware
 */
function latencyBudgetMiddleware(options = {}) {
  const { trackUnknown = true, includeRequestInfo = true } = options;

  return (req, res, next) => {
    // Skip excluded paths
    if (shouldExcludePath(req.path)) {
      return next();
    }

    const startTime = Date.now();
    const operation = detectOperationType(req.path, req.method);

    // Skip unknown operations if configured
    if (!operation && !trackUnknown) {
      return next();
    }

    // Track on response finish
    const onFinish = () => {
      const latencyMs = Date.now() - startTime;
      const budgetService = getLatencyBudgetService();

      if (!budgetService.isEnabled()) {
        return;
      }

      const context = includeRequestInfo
        ? {
            path: req.path,
            method: req.method,
            statusCode: res.statusCode,
            userId: req.user?.id,
            success: res.statusCode < 400,
          }
        : { success: res.statusCode < 400 };

      budgetService.recordLatency(operation || 'unknown', latencyMs, context);
    };

    // Listen for response finish
    res.on('finish', onFinish);
    res.on('close', onFinish);

    next();
  };
}

/**
 * Create middleware for tracking specific operation type
 *
 * @param {string} operation - Operation type to track
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware
 */
function trackLatency(operation, options = {}) {
  const { includeRequestInfo = true } = options;

  return (req, res, next) => {
    const startTime = Date.now();

    const onFinish = () => {
      const latencyMs = Date.now() - startTime;
      const budgetService = getLatencyBudgetService();

      if (!budgetService.isEnabled()) {
        return;
      }

      const context = includeRequestInfo
        ? {
            path: req.path,
            method: req.method,
            statusCode: res.statusCode,
            userId: req.user?.id,
            success: res.statusCode < 400,
          }
        : { success: res.statusCode < 400 };

      budgetService.recordLatency(operation, latencyMs, context);
    };

    res.on('finish', onFinish);
    res.on('close', onFinish);

    next();
  };
}

/**
 * Wrapper for tracking async route handlers
 *
 * @param {string} operation - Operation type
 * @param {Function} handler - Async route handler
 * @returns {Function} Wrapped handler
 */
function withLatencyTracking(operation, handler) {
  return async (req, res, next) => {
    const startTime = Date.now();
    const budgetService = getLatencyBudgetService();

    try {
      await handler(req, res, next);

      const latencyMs = Date.now() - startTime;
      if (budgetService.isEnabled()) {
        budgetService.recordLatency(operation, latencyMs, {
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          userId: req.user?.id,
          success: true,
        });
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      if (budgetService.isEnabled()) {
        budgetService.recordLatency(operation, latencyMs, {
          path: req.path,
          method: req.method,
          userId: req.user?.id,
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  };
}

/**
 * Utility to manually start timing
 * Returns a function to stop timing and record the measurement
 *
 * @param {string} operation - Operation type
 * @returns {Function} Stop function that records latency
 */
function startTiming(operation) {
  const startTime = Date.now();

  return (context = {}) => {
    const latencyMs = Date.now() - startTime;
    const budgetService = getLatencyBudgetService();

    if (budgetService.isEnabled()) {
      return budgetService.recordLatency(operation, latencyMs, context);
    }

    return { tracked: false, latencyMs };
  };
}

/**
 * Express error handler that tracks failed request latency
 *
 * @param {string} operation - Default operation type for errors
 * @returns {Function} Error handling middleware
 */
function latencyErrorHandler(operation = 'unknown') {
  return (err, req, res, next) => {
    // The latency should have been tracked by the response middleware
    // This is just for additional context logging
    log.debug('Request error in latency-tracked route', {
      operation,
      path: req.path,
      error: err.message,
    });

    next(err);
  };
}

module.exports = {
  latencyBudgetMiddleware,
  trackLatency,
  withLatencyTracking,
  startTiming,
  latencyErrorHandler,
  detectOperationType,
  OPERATION_TYPES,
};
