/**
 * Centralized Winston Logger Configuration
 *
 * Provides structured logging with:
 * - Console output with colors for development
 * - JSON format for production (easy parsing by log aggregators)
 * - Log levels: error, warn, info, http, debug
 * - Request context support
 * - Error serialization
 */

const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Determine log level based on environment
const getLogLevel = () => {
  const env = process.env.NODE_ENV || 'development';
  const configuredLevel = process.env.LOG_LEVEL;

  if (configuredLevel) {
    return configuredLevel;
  }

  return env === 'development' ? 'debug' : 'info';
};

// Custom format for error objects
const errorFormat = winston.format((info) => {
  if (info.error instanceof Error) {
    info.error = {
      message: info.error.message,
      stack: info.error.stack,
      name: info.error.name,
      ...(info.error.code && { code: info.error.code }),
    };
  }
  return info;
});

// Format for development (colorized, human-readable)
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errorFormat(),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      // Format metadata nicely
      metaStr = '\n' + JSON.stringify(meta, null, 2);
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Format for production (JSON for log aggregators)
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  errorFormat(),
  winston.format.json()
);

// Create the logger instance
const logger = winston.createLogger({
  level: getLogLevel(),
  levels,
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  defaultMeta: {
    service: 'knowledge-platform-backend',
    version: process.env.npm_package_version || '1.0.0',
  },
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Add file transport in production
if (process.env.NODE_ENV === 'production' && process.env.LOG_FILE_PATH) {
  logger.add(
    new winston.transports.File({
      filename: path.join(process.env.LOG_FILE_PATH, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: path.join(process.env.LOG_FILE_PATH, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );
}

/**
 * Create a child logger with additional context
 * @param {Object} context - Additional context to include in all logs
 * @returns {Logger} Child logger instance
 */
const createChildLogger = (context) => {
  return logger.child(context);
};

/**
 * Express middleware for request logging
 */
const httpLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    };

    // Add user info if available
    if (req.user) {
      logData.userId = req.user.id || req.user.email;
    }

    // Log level based on status code
    if (res.statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  });

  next();
};

/**
 * Log application startup information
 */
const logStartup = (port, additionalInfo = {}) => {
  logger.info('Server started', {
    port,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    ...additionalInfo,
  });
};

/**
 * Log application shutdown
 */
const logShutdown = (reason = 'unknown') => {
  logger.info('Server shutting down', { reason });
};

/**
 * Convenience methods that match common patterns
 */
const log = {
  // Standard logging
  error: (message, meta = {}) => logger.error(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
  http: (message, meta = {}) => logger.http(message, meta),
  debug: (message, meta = {}) => logger.debug(message, meta),

  // Error with Error object
  errorWithStack: (message, error, meta = {}) => {
    logger.error(message, { error, ...meta });
  },

  // Document processing
  documentProcessing: (documentId, stage, meta = {}) => {
    logger.info(`Document processing: ${stage}`, { documentId, stage, ...meta });
  },

  // Query processing
  queryProcessing: (query, meta = {}) => {
    logger.info('Query processing', {
      queryLength: query?.length,
      ...meta,
    });
  },

  // Authentication events
  authEvent: (event, userId, meta = {}) => {
    logger.info(`Auth: ${event}`, { event, userId, ...meta });
  },

  // Security events (for audit)
  securityEvent: (event, meta = {}) => {
    logger.warn(`Security: ${event}`, { event, security: true, ...meta });
  },
};

module.exports = {
  logger,
  log,
  createChildLogger,
  httpLogger,
  logStartup,
  logShutdown,
};
