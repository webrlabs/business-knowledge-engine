/**
 * Prompt Injection Detection Middleware
 *
 * Provides Express middleware for detecting and blocking prompt injection attacks.
 * Can be applied to specific routes or globally.
 */

const { getPromptInjectionService, ACTION } = require('../services/prompt-injection-service');
const { log } = require('../utils/telemetry');

/**
 * Create middleware for detecting prompt injection in request body
 * @param {Object} options - Middleware options
 * @param {string[]} options.fields - Fields in request body to analyze (default: ['query', 'prompt', 'message', 'content', 'text'])
 * @param {boolean} options.blockOnDetection - Whether to block requests with high severity detections (default: true)
 * @param {boolean} options.sanitize - Whether to sanitize input instead of blocking (default: false)
 * @param {boolean} options.includeMessages - Whether to analyze 'messages' array field for chat format (default: true)
 * @returns {Function} Express middleware function
 */
function promptInjectionGuard(options = {}) {
  const {
    fields = ['query', 'prompt', 'message', 'content', 'text', 'question'],
    blockOnDetection = true,
    sanitize = false,
    includeMessages = true,
  } = options;

  return (req, res, next) => {
    const service = getPromptInjectionService();

    // Skip if service is disabled
    if (!service.config.enabled) {
      return next();
    }

    const analysisResults = [];
    let shouldBlock = false;
    let maxSeverity = 'none';

    // Analyze specified fields in request body
    if (req.body) {
      for (const field of fields) {
        if (req.body[field] && typeof req.body[field] === 'string') {
          const result = service.analyzeText(req.body[field]);
          analysisResults.push({ field, ...result });

          if (result.shouldBlock) {
            shouldBlock = true;
          }

          if (result.severity !== 'none') {
            maxSeverity = result.severity;
          }

          // Optionally sanitize the field
          if (sanitize && result.isRisky) {
            const { sanitized } = service.sanitizeText(req.body[field]);
            req.body[field] = sanitized;
          }
        }
      }

      // Analyze messages array if present (for chat completion format)
      if (includeMessages && Array.isArray(req.body.messages)) {
        const result = service.analyzeMessages(req.body.messages);
        analysisResults.push({ field: 'messages', ...result });

        if (result.shouldBlock) {
          shouldBlock = true;
        }

        if (result.severity !== 'none') {
          maxSeverity = result.severity;
        }
      }
    }

    // Attach analysis results to request for downstream use
    req.promptInjectionAnalysis = {
      analyzed: true,
      results: analysisResults,
      shouldBlock,
      maxSeverity,
      timestamp: new Date().toISOString(),
    };

    // Block if detection warrants it
    if (shouldBlock && blockOnDetection && !sanitize) {
      const detections = analysisResults.flatMap(r => r.detections || []);

      log.warn('Request blocked due to prompt injection detection', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        severity: maxSeverity,
        detectionCount: detections.length,
        categories: [...new Set(detections.map(d => d.category))],
      });

      return res.status(400).json({
        error: 'Request blocked',
        message: 'The request contains content that violates security policies.',
        code: 'PROMPT_INJECTION_DETECTED',
        severity: maxSeverity,
      });
    }

    next();
  };
}

/**
 * Middleware that warns but does not block on prompt injection detection
 * Attaches analysis results to request for logging/monitoring
 */
function promptInjectionMonitor(options = {}) {
  return promptInjectionGuard({
    ...options,
    blockOnDetection: false,
  });
}

/**
 * Middleware that sanitizes input instead of blocking
 * Modifies request body in place
 */
function promptInjectionSanitizer(options = {}) {
  return promptInjectionGuard({
    ...options,
    sanitize: true,
    blockOnDetection: false,
  });
}

/**
 * Create a route handler wrapper that includes prompt injection detection
 * @param {Function} handler - The route handler to wrap
 * @param {Object} options - Detection options
 * @returns {Function} Wrapped handler
 */
function withPromptInjectionDetection(handler, options = {}) {
  return async (req, res, next) => {
    const guard = promptInjectionGuard(options);

    guard(req, res, async (err) => {
      if (err) return next(err);

      // If blocked, response already sent
      if (res.headersSent) return;

      try {
        await handler(req, res, next);
      } catch (error) {
        next(error);
      }
    });
  };
}

module.exports = {
  promptInjectionGuard,
  promptInjectionMonitor,
  promptInjectionSanitizer,
  withPromptInjectionDetection,
};
