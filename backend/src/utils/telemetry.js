/**
 * Application Insights Telemetry Integration
 *
 * Provides centralized telemetry for:
 * - Request/response tracking
 * - Exception logging
 * - Custom events and metrics
 * - Dependency tracking (Azure services)
 *
 * Usage:
 *   const { telemetry, trackEvent, trackException } = require('./utils/telemetry');
 *
 * Environment Variables:
 *   APPINSIGHTS_INSTRUMENTATIONKEY - Required for telemetry to be enabled
 *   APPINSIGHTS_CLOUD_ROLE - Optional cloud role name (default: 'knowledge-platform-backend')
 */

const appInsights = require('applicationinsights');
const { log } = require('./logger');

// Configuration
const instrumentationKey = process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
const cloudRoleName = process.env.APPINSIGHTS_CLOUD_ROLE || 'knowledge-platform-backend';
const isEnabled = !!instrumentationKey && instrumentationKey !== 'your-instrumentation-key';

let client = null;

/**
 * Initialize Application Insights
 * Should be called early in application startup, before other modules are loaded
 */
function initializeTelemetry() {
  if (!isEnabled) {
    log.info('Application Insights disabled - no instrumentation key configured');
    return false;
  }

  try {
    appInsights
      .setup(instrumentationKey)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true, true)
      .setUseDiskRetryCaching(true)
      .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
      .setSendLiveMetrics(process.env.NODE_ENV === 'production');

    // Set cloud role for easy identification in Azure portal
    appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = cloudRoleName;

    // Add custom properties to all telemetry
    appInsights.defaultClient.addTelemetryProcessor((envelope) => {
      envelope.data.baseData.properties = envelope.data.baseData.properties || {};
      envelope.data.baseData.properties.environment = process.env.NODE_ENV || 'development';
      envelope.data.baseData.properties.version = process.env.npm_package_version || '1.0.0';
      return true;
    });

    appInsights.start();
    client = appInsights.defaultClient;

    log.info('Application Insights initialized', { cloudRole: cloudRoleName });
    return true;
  } catch (error) {
    log.error('Failed to initialize Application Insights', { error: error.message });
    return false;
  }
}

/**
 * Track a custom event
 * @param {string} name - Event name
 * @param {Object} properties - Custom properties
 * @param {Object} measurements - Custom measurements (numeric values)
 */
function trackEvent(name, properties = {}, measurements = {}) {
  if (!client || typeof client.trackEvent !== 'function') return;

  try {
    client.trackEvent({
      name,
      properties,
      measurements,
    });
  } catch (error) {
    log.warn('Telemetry disabled - trackEvent failed, disabling further tracking', { error: error.message });
    client = null;
  }
}

/**
 * Track an exception
 * @param {Error} error - The error object
 * @param {Object} properties - Additional properties
 */
function trackException(error, properties = {}) {
  if (!client || typeof client.trackException !== 'function') return;

  try {
    client.trackException({
      exception: error,
      properties,
    });
  } catch (err) {
    log.warn('Telemetry disabled - trackException failed', { error: err.message });
    client = null;
  }
}

/**
 * Track a custom metric
 * @param {string} name - Metric name
 * @param {number} value - Metric value
 * @param {Object} properties - Additional properties
 */
function trackMetric(name, value, properties = {}) {
  if (!client || typeof client.trackMetric !== 'function') return;

  try {
    client.trackMetric({
      name,
      value,
      properties,
    });
  } catch (error) {
    log.warn('Telemetry disabled - trackMetric failed', { error: error.message });
    client = null;
  }
}

/**
 * Track a dependency call (external service call)
 * @param {Object} options - Dependency options
 */
function trackDependency(options) {
  if (!client || typeof client.trackDependency !== 'function') return;

  try {
    client.trackDependency({
      dependencyTypeName: options.type || 'HTTP',
      name: options.name,
      data: options.data,
      duration: options.duration,
      resultCode: options.resultCode || 0,
      success: options.success !== false,
      target: options.target,
      properties: options.properties || {},
    });
  } catch (error) {
    log.warn('Telemetry disabled - trackDependency failed', { error: error.message });
    client = null;
  }
}

/**
 * Track a request (for custom request tracking)
 * @param {Object} options - Request options
 */
function trackRequest(options) {
  if (!client || typeof client.trackRequest !== 'function') return;

  try {
    client.trackRequest({
      name: options.name,
      url: options.url,
      duration: options.duration,
      resultCode: options.resultCode || 200,
      success: options.success !== false,
      properties: options.properties || {},
    });
  } catch (error) {
    log.warn('Telemetry disabled - trackRequest failed', { error: error.message });
    client = null;
  }
}

/**
 * Track page view (for backend-rendered pages)
 * @param {string} name - Page name
 * @param {string} url - Page URL
 * @param {Object} properties - Additional properties
 */
function trackPageView(name, url, properties = {}) {
  if (!client || typeof client.trackPageView !== 'function') return;

  try {
    client.trackPageView({
      name,
      url,
      properties,
    });
  } catch (error) {
    log.warn('Telemetry disabled - trackPageView failed', { error: error.message });
    client = null;
  }
}

/**
 * Flush telemetry (useful before shutdown)
 * @returns {Promise<void>}
 */
async function flushTelemetry() {
  if (!client || typeof client.flush !== 'function') return;

  return new Promise((resolve) => {
    client.flush({
      callback: () => {
        log.info('Application Insights telemetry flushed');
        resolve();
      },
    });
  });
}

/**
 * Express middleware for tracking requests with custom properties
 */
function telemetryMiddleware(req, res, next) {
  if (!client) {
    return next();
  }

  const startTime = Date.now();

  // Add correlation context
  const operationId = req.headers['x-correlation-id'] ||
                      req.headers['x-request-id'] ||
                      require('crypto').randomUUID();

  req.telemetryContext = {
    operationId,
    startTime,
  };

  // Track response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const properties = {
      operationId,
      userId: req.user?.id || req.user?.email || 'anonymous',
      userRoles: req.user?.roles?.join(',') || '',
      httpMethod: req.method,
      path: req.path,
    };

    // Track custom metrics
    trackMetric('request.duration', duration, properties);

    if (res.statusCode >= 400) {
      trackEvent('request.error', {
        ...properties,
        statusCode: res.statusCode,
      });
    }
  });

  next();
}

// Domain-specific tracking helpers

/**
 * Track document processing events
 */
function trackDocumentProcessing(documentId, stage, duration, success, properties = {}) {
  trackEvent('document.processing', {
    documentId,
    stage,
    success,
    ...properties,
  }, {
    duration,
  });
}

/**
 * Track GraphRAG query events
 */
function trackGraphRAGQuery(queryLength, duration, resultCount, success, properties = {}) {
  trackEvent('graphrag.query', {
    success,
    ...properties,
  }, {
    queryLength,
    duration,
    resultCount,
  });
}

/**
 * Track entity extraction events
 */
function trackEntityExtraction(documentId, entityCount, relationshipCount, duration, properties = {}) {
  trackEvent('entity.extraction', {
    documentId,
    ...properties,
  }, {
    entityCount,
    relationshipCount,
    duration,
  });
}

/**
 * Track security events (access denied, PII redacted, etc.)
 */
function trackSecurityEvent(eventType, userId, properties = {}) {
  trackEvent('security.' + eventType, {
    userId,
    ...properties,
  });
}

/**
 * Track Azure service calls
 */
function trackAzureServiceCall(serviceName, operation, duration, success, properties = {}) {
  trackDependency({
    type: 'Azure',
    name: `${serviceName}.${operation}`,
    target: serviceName,
    duration,
    success,
    properties,
  });
}

module.exports = {
  initializeTelemetry,
  telemetryMiddleware,
  trackEvent,
  trackException,
  trackMetric,
  trackDependency,
  trackRequest,
  trackPageView,
  flushTelemetry,
  // Domain-specific helpers
  trackDocumentProcessing,
  trackGraphRAGQuery,
  trackEntityExtraction,
  trackSecurityEvent,
  trackAzureServiceCall,
  // Check if telemetry is enabled
  isEnabled: () => isEnabled && client !== null,
  // Re-export log from logger for convenience
  log,
};
