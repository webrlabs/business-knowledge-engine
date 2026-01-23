/**
 * Circuit Breaker Service
 *
 * Implements the circuit breaker pattern for external services to prevent cascade failures.
 * Uses opossum library for circuit breaker functionality.
 *
 * Features:
 * - Individual circuit breakers per external service (OpenAI, Search, Cosmos, Gremlin, DocIntelligence, Blob)
 * - Configurable thresholds via environment variables
 * - Event-based monitoring and logging
 * - Status API for health checks
 * - Fallback support
 * - Telemetry integration
 *
 * @see https://github.com/nodeshift/opossum
 */

const CircuitBreaker = require('opossum');
const { log } = require('../utils/logger');
const { trackEvent, trackException } = require('../utils/telemetry');

// Default circuit breaker configuration
const DEFAULT_OPTIONS = {
  timeout: 30000,                // 30 seconds - time before a call is considered failed
  errorThresholdPercentage: 50,  // Trip circuit when 50% of requests fail
  resetTimeout: 30000,           // 30 seconds - time to wait before trying again (half-open)
  volumeThreshold: 5,            // Minimum requests before error threshold applies
  rollingCountTimeout: 10000,    // 10 seconds - rolling window for stats
  rollingCountBuckets: 10,       // Number of buckets in the rolling window
};

// Service-specific configurations (can be overridden via env vars)
const SERVICE_CONFIGS = {
  openai: {
    timeout: parseInt(process.env.CB_OPENAI_TIMEOUT) || 60000,      // LLM calls can be slow
    errorThresholdPercentage: parseInt(process.env.CB_OPENAI_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CB_OPENAI_RESET_TIMEOUT) || 30000,
    volumeThreshold: parseInt(process.env.CB_OPENAI_VOLUME_THRESHOLD) || 3,
  },
  search: {
    timeout: parseInt(process.env.CB_SEARCH_TIMEOUT) || 15000,
    errorThresholdPercentage: parseInt(process.env.CB_SEARCH_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CB_SEARCH_RESET_TIMEOUT) || 20000,
    volumeThreshold: parseInt(process.env.CB_SEARCH_VOLUME_THRESHOLD) || 5,
  },
  cosmos: {
    timeout: parseInt(process.env.CB_COSMOS_TIMEOUT) || 20000,
    errorThresholdPercentage: parseInt(process.env.CB_COSMOS_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CB_COSMOS_RESET_TIMEOUT) || 20000,
    volumeThreshold: parseInt(process.env.CB_COSMOS_VOLUME_THRESHOLD) || 5,
  },
  gremlin: {
    timeout: parseInt(process.env.CB_GREMLIN_TIMEOUT) || 30000,     // Graph queries can be complex
    errorThresholdPercentage: parseInt(process.env.CB_GREMLIN_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CB_GREMLIN_RESET_TIMEOUT) || 30000,
    volumeThreshold: parseInt(process.env.CB_GREMLIN_VOLUME_THRESHOLD) || 5,
  },
  docIntelligence: {
    timeout: parseInt(process.env.CB_DOCINT_TIMEOUT) || 120000,     // Document analysis is slow
    errorThresholdPercentage: parseInt(process.env.CB_DOCINT_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CB_DOCINT_RESET_TIMEOUT) || 60000,
    volumeThreshold: parseInt(process.env.CB_DOCINT_VOLUME_THRESHOLD) || 3,
  },
  blob: {
    timeout: parseInt(process.env.CB_BLOB_TIMEOUT) || 30000,
    errorThresholdPercentage: parseInt(process.env.CB_BLOB_ERROR_THRESHOLD) || 50,
    resetTimeout: parseInt(process.env.CB_BLOB_RESET_TIMEOUT) || 20000,
    volumeThreshold: parseInt(process.env.CB_BLOB_VOLUME_THRESHOLD) || 5,
  },
};

// Circuit breaker state names
const CIRCUIT_STATES = {
  CLOSED: 'closed',     // Normal operation
  OPEN: 'open',         // Failing fast
  HALF_OPEN: 'half-open', // Testing if service recovered
};

class CircuitBreakerService {
  constructor() {
    this.breakers = new Map();
    this.enabled = process.env.CIRCUIT_BREAKER_ENABLED !== 'false';
  }

  /**
   * Get or create a circuit breaker for a specific service
   * @param {string} serviceName - Name of the external service
   * @param {Function} fn - The async function to wrap
   * @param {Object} options - Circuit breaker options
   * @returns {CircuitBreaker} The circuit breaker instance
   */
  getBreaker(serviceName, fn, options = {}) {
    if (!this.enabled) {
      // If circuit breakers are disabled, return a pass-through
      return {
        fire: (...args) => fn(...args),
        fallback: () => {},
        on: () => {},
        stats: { failures: 0, successes: 0, rejects: 0, fires: 0, timeouts: 0 },
        status: { state: CIRCUIT_STATES.CLOSED },
        opened: false,
        closed: true,
        halfOpen: false,
      };
    }

    const key = `${serviceName}:${fn.name || 'anonymous'}`;

    if (this.breakers.has(key)) {
      return this.breakers.get(key);
    }

    // Merge default, service-specific, and custom options
    const serviceConfig = SERVICE_CONFIGS[serviceName] || {};
    const breakerOptions = {
      ...DEFAULT_OPTIONS,
      ...serviceConfig,
      ...options,
      name: key,
    };

    const breaker = new CircuitBreaker(fn, breakerOptions);
    this._attachEventHandlers(breaker, serviceName);
    this.breakers.set(key, breaker);

    log.info('Circuit breaker created', {
      service: serviceName,
      key,
      options: {
        timeout: breakerOptions.timeout,
        errorThresholdPercentage: breakerOptions.errorThresholdPercentage,
        resetTimeout: breakerOptions.resetTimeout,
        volumeThreshold: breakerOptions.volumeThreshold,
      },
    });

    return breaker;
  }

  /**
   * Create a wrapped function that uses the circuit breaker
   * @param {string} serviceName - Name of the external service
   * @param {Function} fn - The async function to wrap
   * @param {Object} options - Circuit breaker options
   * @returns {Function} The wrapped function
   */
  wrap(serviceName, fn, options = {}) {
    const breaker = this.getBreaker(serviceName, fn, options);
    return (...args) => breaker.fire(...args);
  }

  /**
   * Execute a function through a circuit breaker
   * @param {string} serviceName - Name of the external service
   * @param {Function} fn - The async function to execute
   * @param {Array} args - Arguments to pass to the function
   * @param {Object} options - Circuit breaker options
   * @returns {Promise} Result of the function
   */
  async execute(serviceName, fn, args = [], options = {}) {
    const breaker = this.getBreaker(serviceName, fn, options);
    return breaker.fire(...args);
  }

  /**
   * Attach event handlers to a circuit breaker for monitoring
   * @private
   */
  _attachEventHandlers(breaker, serviceName) {
    // Success event
    breaker.on('success', (result, latencyMs) => {
      log.debug('Circuit breaker success', {
        service: serviceName,
        name: breaker.name,
        latencyMs,
      });

      trackEvent('CircuitBreakerSuccess', {
        service: serviceName,
        name: breaker.name,
        latencyMs,
      });
    });

    // Failure event
    breaker.on('failure', (error, latencyMs) => {
      log.warn('Circuit breaker failure', {
        service: serviceName,
        name: breaker.name,
        error: error.message,
        latencyMs,
      });

      trackEvent('CircuitBreakerFailure', {
        service: serviceName,
        name: breaker.name,
        error: error.message,
        latencyMs,
      });
    });

    // Timeout event
    breaker.on('timeout', (latencyMs) => {
      log.warn('Circuit breaker timeout', {
        service: serviceName,
        name: breaker.name,
        latencyMs,
        timeoutSetting: breaker.options.timeout,
      });

      trackEvent('CircuitBreakerTimeout', {
        service: serviceName,
        name: breaker.name,
        latencyMs,
      });
    });

    // Circuit opened (tripped)
    breaker.on('open', () => {
      log.error('Circuit breaker OPENED - service failing', {
        service: serviceName,
        name: breaker.name,
        stats: breaker.stats,
      });

      trackEvent('CircuitBreakerOpen', {
        service: serviceName,
        name: breaker.name,
        failures: breaker.stats.failures,
        successes: breaker.stats.successes,
      });
    });

    // Circuit closed (recovered)
    breaker.on('close', () => {
      log.info('Circuit breaker CLOSED - service recovered', {
        service: serviceName,
        name: breaker.name,
      });

      trackEvent('CircuitBreakerClose', {
        service: serviceName,
        name: breaker.name,
      });
    });

    // Circuit half-open (testing recovery)
    breaker.on('halfOpen', () => {
      log.info('Circuit breaker HALF-OPEN - testing service', {
        service: serviceName,
        name: breaker.name,
      });

      trackEvent('CircuitBreakerHalfOpen', {
        service: serviceName,
        name: breaker.name,
      });
    });

    // Reject event (circuit is open)
    breaker.on('reject', () => {
      log.warn('Circuit breaker REJECTED - request blocked', {
        service: serviceName,
        name: breaker.name,
      });

      trackEvent('CircuitBreakerReject', {
        service: serviceName,
        name: breaker.name,
      });
    });

    // Fallback event
    breaker.on('fallback', (result) => {
      log.info('Circuit breaker fallback executed', {
        service: serviceName,
        name: breaker.name,
        fallbackResult: typeof result,
      });

      trackEvent('CircuitBreakerFallback', {
        service: serviceName,
        name: breaker.name,
      });
    });
  }

  /**
   * Get status of all circuit breakers
   * @returns {Object} Status of all breakers
   */
  getStatus() {
    const status = {
      enabled: this.enabled,
      breakers: {},
      summary: {
        total: 0,
        open: 0,
        closed: 0,
        halfOpen: 0,
      },
    };

    for (const [key, breaker] of this.breakers) {
      const state = breaker.opened ? CIRCUIT_STATES.OPEN :
                    (breaker.halfOpen ? CIRCUIT_STATES.HALF_OPEN : CIRCUIT_STATES.CLOSED);

      status.breakers[key] = {
        state,
        stats: {
          fires: breaker.stats.fires,
          successes: breaker.stats.successes,
          failures: breaker.stats.failures,
          rejects: breaker.stats.rejects,
          timeouts: breaker.stats.timeouts,
          fallbacks: breaker.stats.fallbacks,
        },
        options: {
          timeout: breaker.options.timeout,
          errorThresholdPercentage: breaker.options.errorThresholdPercentage,
          resetTimeout: breaker.options.resetTimeout,
          volumeThreshold: breaker.options.volumeThreshold,
        },
      };

      status.summary.total++;
      if (state === CIRCUIT_STATES.OPEN) status.summary.open++;
      else if (state === CIRCUIT_STATES.CLOSED) status.summary.closed++;
      else if (state === CIRCUIT_STATES.HALF_OPEN) status.summary.halfOpen++;
    }

    return status;
  }

  /**
   * Get status of a specific circuit breaker
   * @param {string} serviceName - Service name to check
   * @returns {Object|null} Status of the breaker or null if not found
   */
  getServiceStatus(serviceName) {
    const status = {
      service: serviceName,
      breakers: [],
    };

    for (const [key, breaker] of this.breakers) {
      if (key.startsWith(serviceName + ':')) {
        const state = breaker.opened ? CIRCUIT_STATES.OPEN :
                      (breaker.halfOpen ? CIRCUIT_STATES.HALF_OPEN : CIRCUIT_STATES.CLOSED);

        status.breakers.push({
          name: key,
          state,
          stats: {
            fires: breaker.stats.fires,
            successes: breaker.stats.successes,
            failures: breaker.stats.failures,
            rejects: breaker.stats.rejects,
            timeouts: breaker.stats.timeouts,
          },
        });
      }
    }

    return status.breakers.length > 0 ? status : null;
  }

  /**
   * Check if any circuit breaker is open (failing)
   * @returns {boolean} True if any circuit is open
   */
  hasOpenCircuit() {
    for (const breaker of this.breakers.values()) {
      if (breaker.opened) return true;
    }
    return false;
  }

  /**
   * Get list of open (failing) circuits
   * @returns {Array} List of open circuit names
   */
  getOpenCircuits() {
    const open = [];
    for (const [key, breaker] of this.breakers) {
      if (breaker.opened) {
        open.push(key);
      }
    }
    return open;
  }

  /**
   * Manually reset a circuit breaker to closed state
   * @param {string} key - The circuit breaker key
   * @returns {boolean} True if reset was successful
   */
  reset(key) {
    const breaker = this.breakers.get(key);
    if (breaker) {
      breaker.close();
      log.info('Circuit breaker manually reset', { key });
      return true;
    }
    return false;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const [key, breaker] of this.breakers) {
      breaker.close();
    }
    log.info('All circuit breakers reset');
  }

  /**
   * Shutdown all circuit breakers
   */
  shutdown() {
    for (const [key, breaker] of this.breakers) {
      breaker.shutdown();
    }
    this.breakers.clear();
    log.info('Circuit breaker service shutdown');
  }
}

// Singleton instance
let instance = null;

/**
 * Get the circuit breaker service singleton
 * @returns {CircuitBreakerService}
 */
function getCircuitBreakerService() {
  if (!instance) {
    instance = new CircuitBreakerService();
  }
  return instance;
}

/**
 * Helper function to wrap a service method with circuit breaker
 * @param {string} serviceName - Name of the service
 * @param {Function} fn - Function to wrap
 * @param {Object} options - Circuit breaker options
 * @returns {Function} Wrapped function
 */
function withCircuitBreaker(serviceName, fn, options = {}) {
  const service = getCircuitBreakerService();
  return service.wrap(serviceName, fn, options);
}

/**
 * Decorator-style circuit breaker for class methods
 * Usage: method = circuitBreaker('openai', this.method.bind(this))
 * @param {string} serviceName - Name of the service
 * @param {Function} method - Method to wrap
 * @param {Object} options - Circuit breaker options
 * @returns {Function} Wrapped method
 */
function circuitBreaker(serviceName, method, options = {}) {
  const service = getCircuitBreakerService();
  const breaker = service.getBreaker(serviceName, method, options);

  const wrapped = async (...args) => {
    return breaker.fire(...args);
  };

  // Expose breaker for fallback registration
  wrapped.breaker = breaker;
  wrapped.fallback = (fallbackFn) => {
    breaker.fallback(fallbackFn);
    return wrapped;
  };

  return wrapped;
}

module.exports = {
  CircuitBreakerService,
  getCircuitBreakerService,
  withCircuitBreaker,
  circuitBreaker,
  CIRCUIT_STATES,
  DEFAULT_OPTIONS,
  SERVICE_CONFIGS,
};
