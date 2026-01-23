/**
 * User-Based Rate Limiting Service
 *
 * Implements F5.3.5 - Per-user rate limits (not just global)
 *
 * Features:
 * - Per-user rate limiting using user ID from JWT
 * - Role-based tiered limits (admin, reviewer, contributor, reader)
 * - Fallback to IP for unauthenticated requests
 * - Combined user+IP key for sensitive endpoints
 * - Statistics tracking and monitoring
 * - Configurable via environment variables
 *
 * @see https://express-rate-limit.mintlify.app/reference/configuration
 */

const rateLimit = require('express-rate-limit');
const { log } = require('../utils/logger');

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Role-based rate limit multipliers
 * Higher roles get more generous limits
 */
const ROLE_MULTIPLIERS = {
  admin: parseFloat(process.env.RATE_LIMIT_ADMIN_MULTIPLIER || '3.0'),
  reviewer: parseFloat(process.env.RATE_LIMIT_REVIEWER_MULTIPLIER || '2.0'),
  contributor: parseFloat(process.env.RATE_LIMIT_CONTRIBUTOR_MULTIPLIER || '1.5'),
  reader: parseFloat(process.env.RATE_LIMIT_READER_MULTIPLIER || '1.0'),
  default: 1.0,
};

/**
 * Base rate limits (per window)
 * These are multiplied by role multipliers
 */
const BASE_LIMITS = {
  // General API: 15-minute window
  general: {
    windowMs: parseInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS || '900000', 10), // 15 min
    maxDev: parseInt(process.env.RATE_LIMIT_GENERAL_MAX_DEV || '1000', 10),
    maxProd: parseInt(process.env.RATE_LIMIT_GENERAL_MAX_PROD || '100', 10),
  },
  // Query endpoint: 1-minute window
  query: {
    windowMs: parseInt(process.env.RATE_LIMIT_QUERY_WINDOW_MS || '60000', 10), // 1 min
    maxDev: parseInt(process.env.RATE_LIMIT_QUERY_MAX_DEV || '100', 10),
    maxProd: parseInt(process.env.RATE_LIMIT_QUERY_MAX_PROD || '30', 10),
  },
  // Upload endpoint: 1-hour window
  upload: {
    windowMs: parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS || '3600000', 10), // 1 hour
    maxDev: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX_DEV || '50', 10),
    maxProd: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX_PROD || '20', 10),
  },
  // Processing endpoint: 1-minute window
  processing: {
    windowMs: parseInt(process.env.RATE_LIMIT_PROCESSING_WINDOW_MS || '60000', 10), // 1 min
    maxDev: parseInt(process.env.RATE_LIMIT_PROCESSING_MAX_DEV || '30', 10),
    maxProd: parseInt(process.env.RATE_LIMIT_PROCESSING_MAX_PROD || '10', 10),
  },
  // Auth/strict endpoint: 15-minute window
  strict: {
    windowMs: parseInt(process.env.RATE_LIMIT_STRICT_WINDOW_MS || '900000', 10), // 15 min
    maxDev: parseInt(process.env.RATE_LIMIT_STRICT_MAX_DEV || '20', 10),
    maxProd: parseInt(process.env.RATE_LIMIT_STRICT_MAX_PROD || '5', 10),
  },
};

/**
 * Statistics tracking for rate limiting
 */
class RateLimitStats {
  constructor() {
    this.stats = new Map(); // key -> { hits, blocked, lastAccess }
    this.globalStats = {
      totalHits: 0,
      totalBlocked: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Record a hit for a key
   * @param {string} key - The rate limit key (userId or IP)
   * @param {boolean} blocked - Whether the request was blocked
   */
  recordHit(key, blocked = false) {
    if (!this.stats.has(key)) {
      this.stats.set(key, {
        hits: 0,
        blocked: 0,
        firstAccess: Date.now(),
        lastAccess: Date.now(),
      });
    }

    const entry = this.stats.get(key);
    entry.hits++;
    entry.lastAccess = Date.now();

    if (blocked) {
      entry.blocked++;
      this.globalStats.totalBlocked++;
    }

    this.globalStats.totalHits++;
  }

  /**
   * Get statistics for a specific key
   * @param {string} key - The rate limit key
   * @returns {Object|null} Statistics for the key
   */
  getKeyStats(key) {
    return this.stats.get(key) || null;
  }

  /**
   * Get global statistics
   * @returns {Object} Global rate limit statistics
   */
  getGlobalStats() {
    const now = Date.now();
    const uptimeMs = now - this.globalStats.startTime;

    return {
      ...this.globalStats,
      uniqueKeys: this.stats.size,
      uptimeMs,
      uptimeHuman: this._formatUptime(uptimeMs),
      avgHitsPerMinute: (this.globalStats.totalHits / (uptimeMs / 60000)).toFixed(2),
      blockRate: this.globalStats.totalHits > 0
        ? ((this.globalStats.totalBlocked / this.globalStats.totalHits) * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Get top rate-limited users/IPs
   * @param {number} limit - Number of entries to return
   * @returns {Array} Top rate-limited entries
   */
  getTopBlocked(limit = 10) {
    return Array.from(this.stats.entries())
      .map(([key, stats]) => ({ key, ...stats }))
      .filter(entry => entry.blocked > 0)
      .sort((a, b) => b.blocked - a.blocked)
      .slice(0, limit);
  }

  /**
   * Get top users by request volume
   * @param {number} limit - Number of entries to return
   * @returns {Array} Top users by hits
   */
  getTopUsers(limit = 10) {
    return Array.from(this.stats.entries())
      .map(([key, stats]) => ({ key, ...stats }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
  }

  /**
   * Clear old entries (older than 24 hours)
   */
  cleanup() {
    const threshold = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    let cleaned = 0;

    for (const [key, entry] of this.stats.entries()) {
      if (entry.lastAccess < threshold) {
        this.stats.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug('Rate limit stats cleanup', { cleaned });
    }
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.stats.clear();
    this.globalStats = {
      totalHits: 0,
      totalBlocked: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Format uptime in human-readable format
   * @private
   */
  _formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

// Global stats instance
const rateLimitStats = new RateLimitStats();

// Cleanup interval (every hour)
setInterval(() => rateLimitStats.cleanup(), 60 * 60 * 1000);

/**
 * Get the highest role from a user's roles array
 * @param {string[]} roles - User's roles
 * @returns {string} Highest role
 */
function getHighestRole(roles = []) {
  const rolePriority = ['admin', 'reviewer', 'contributor', 'reader'];

  for (const role of rolePriority) {
    if (roles.some(r => r.toLowerCase().includes(role))) {
      return role;
    }
  }

  return 'default';
}

/**
 * Get rate limit multiplier for a user's roles
 * @param {string[]} roles - User's roles
 * @returns {number} Multiplier
 */
function getRoleMultiplier(roles = []) {
  const highestRole = getHighestRole(roles);
  return ROLE_MULTIPLIERS[highestRole] || ROLE_MULTIPLIERS.default;
}

/**
 * Calculate effective max requests based on role
 * @param {number} baseMax - Base max requests
 * @param {string[]} roles - User's roles
 * @returns {number} Effective max requests
 */
function calculateEffectiveMax(baseMax, roles = []) {
  const multiplier = getRoleMultiplier(roles);
  return Math.floor(baseMax * multiplier);
}

/**
 * Generate rate limit key from request
 * Priority: User ID > IP address
 * @param {Object} req - Express request
 * @param {boolean} includeIp - Whether to combine user ID with IP
 * @returns {string} Rate limit key
 */
function generateKey(req, includeIp = false) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

  // If user is authenticated, use their ID
  if (req.user && req.user.id) {
    const userId = req.user.id;
    if (includeIp) {
      return `user:${userId}:ip:${ip}`;
    }
    return `user:${userId}`;
  }

  // Fall back to IP for unauthenticated requests
  return `ip:${ip}`;
}

/**
 * Create a handler that runs when rate limit is hit
 * @param {string} limiterName - Name of the limiter for logging
 * @returns {Function} Handler function
 */
function createLimitHandler(limiterName) {
  return (req, res, next, options) => {
    const key = generateKey(req);
    const userId = req.user?.id || 'anonymous';
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

    rateLimitStats.recordHit(key, true);

    log.warn('Rate limit exceeded', {
      limiter: limiterName,
      userId,
      ip,
      key,
      path: req.path,
      method: req.method,
      roles: req.user?.roles,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: options.message?.message || 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil(options.windowMs / 1000),
      limiter: limiterName,
    });
  };
}

/**
 * Create a skip handler that also records stats
 * @param {Function} originalSkip - Original skip function
 * @returns {Function} Skip handler
 */
function createSkipHandler(originalSkip) {
  return (req) => {
    // Always skip health checks
    if (req.path === '/health' || req.path === '/health/detailed') {
      return true;
    }

    // Record the hit even if we're applying the limit
    if (!originalSkip || !originalSkip(req)) {
      const key = generateKey(req);
      rateLimitStats.recordHit(key, false);
      return false;
    }

    return true;
  };
}

/**
 * Create per-user rate limiter for general API endpoints
 * @returns {Function} Express middleware
 */
function createUserGeneralLimiter() {
  const baseMax = isDevelopment ? BASE_LIMITS.general.maxDev : BASE_LIMITS.general.maxProd;

  return rateLimit({
    windowMs: BASE_LIMITS.general.windowMs,
    limit: (req) => calculateEffectiveMax(baseMax, req.user?.roles),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => generateKey(req),
    skip: createSkipHandler(null),
    handler: createLimitHandler('general-user'),
    message: {
      error: 'Too many requests',
      message: 'You have exceeded the rate limit. Please try again later.',
    },
    validate: {
      ip: false, // We handle IP validation ourselves
    },
  });
}

/**
 * Create per-user rate limiter for query endpoints
 * @returns {Function} Express middleware
 */
function createUserQueryLimiter() {
  const baseMax = isDevelopment ? BASE_LIMITS.query.maxDev : BASE_LIMITS.query.maxProd;

  return rateLimit({
    windowMs: BASE_LIMITS.query.windowMs,
    limit: (req) => calculateEffectiveMax(baseMax, req.user?.roles),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => generateKey(req),
    skip: createSkipHandler(null),
    handler: createLimitHandler('query-user'),
    message: {
      error: 'Too many requests',
      message: 'Too many query requests. Please wait before querying again.',
    },
    validate: { ip: false },
  });
}

/**
 * Create per-user rate limiter for upload endpoints
 * @returns {Function} Express middleware
 */
function createUserUploadLimiter() {
  const baseMax = isDevelopment ? BASE_LIMITS.upload.maxDev : BASE_LIMITS.upload.maxProd;

  return rateLimit({
    windowMs: BASE_LIMITS.upload.windowMs,
    limit: (req) => calculateEffectiveMax(baseMax, req.user?.roles),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => generateKey(req),
    skip: createSkipHandler(null),
    handler: createLimitHandler('upload-user'),
    message: {
      error: 'Too many requests',
      message: 'Too many upload requests. Please try again later.',
    },
    validate: { ip: false },
  });
}

/**
 * Create per-user rate limiter for processing endpoints
 * @returns {Function} Express middleware
 */
function createUserProcessingLimiter() {
  const baseMax = isDevelopment ? BASE_LIMITS.processing.maxDev : BASE_LIMITS.processing.maxProd;

  return rateLimit({
    windowMs: BASE_LIMITS.processing.windowMs,
    limit: (req) => calculateEffectiveMax(baseMax, req.user?.roles),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => generateKey(req),
    skip: createSkipHandler(null),
    handler: createLimitHandler('processing-user'),
    message: {
      error: 'Too many requests',
      message: 'Too many document processing requests. Please wait.',
    },
    validate: { ip: false },
  });
}

/**
 * Create strict per-user+IP rate limiter for sensitive endpoints
 * Uses combined user ID + IP for extra security
 * @returns {Function} Express middleware
 */
function createUserStrictLimiter() {
  const baseMax = isDevelopment ? BASE_LIMITS.strict.maxDev : BASE_LIMITS.strict.maxProd;

  return rateLimit({
    windowMs: BASE_LIMITS.strict.windowMs,
    limit: (req) => calculateEffectiveMax(baseMax, req.user?.roles),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => generateKey(req, true), // Combined user+IP
    skip: createSkipHandler(null),
    handler: createLimitHandler('strict-user'),
    message: {
      error: 'Too many requests',
      message: 'Too many authentication attempts. Please try again later.',
    },
    validate: { ip: false },
  });
}

/**
 * Get rate limit statistics
 * @returns {Object} Statistics object
 */
function getRateLimitStats() {
  return {
    global: rateLimitStats.getGlobalStats(),
    topBlocked: rateLimitStats.getTopBlocked(),
    topUsers: rateLimitStats.getTopUsers(),
    roleMultipliers: ROLE_MULTIPLIERS,
    baseLimits: BASE_LIMITS,
    environment: isDevelopment ? 'development' : 'production',
  };
}

/**
 * Get rate limit stats for a specific user
 * @param {string} userId - User ID
 * @returns {Object|null} User statistics
 */
function getUserRateLimitStats(userId) {
  const userKey = `user:${userId}`;
  return rateLimitStats.getKeyStats(userKey);
}

/**
 * Reset rate limit statistics
 */
function resetRateLimitStats() {
  rateLimitStats.reset();
  log.info('Rate limit statistics reset');
}

/**
 * Get current configuration
 * @returns {Object} Configuration object
 */
function getRateLimitConfig() {
  return {
    roleMultipliers: ROLE_MULTIPLIERS,
    baseLimits: BASE_LIMITS,
    environment: isDevelopment ? 'development' : 'production',
    cleanupIntervalHours: 1,
  };
}

// Create singleton instances of the limiters
const userGeneralLimiter = createUserGeneralLimiter();
const userQueryLimiter = createUserQueryLimiter();
const userUploadLimiter = createUserUploadLimiter();
const userProcessingLimiter = createUserProcessingLimiter();
const userStrictLimiter = createUserStrictLimiter();

module.exports = {
  // Middleware exports
  userGeneralLimiter,
  userQueryLimiter,
  userUploadLimiter,
  userProcessingLimiter,
  userStrictLimiter,

  // Factory functions (for custom configuration)
  createUserGeneralLimiter,
  createUserQueryLimiter,
  createUserUploadLimiter,
  createUserProcessingLimiter,
  createUserStrictLimiter,

  // Stats and utilities
  getRateLimitStats,
  getUserRateLimitStats,
  resetRateLimitStats,
  getRateLimitConfig,
  getRoleMultiplier,
  calculateEffectiveMax,
  generateKey,
  getHighestRole,

  // Constants for testing
  ROLE_MULTIPLIERS,
  BASE_LIMITS,
};
