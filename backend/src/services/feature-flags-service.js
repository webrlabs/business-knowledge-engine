/**
 * Feature Flags Service
 *
 * Centralized feature flag management for the Business Knowledge Engine.
 * Enables/disables features without deployment via environment variables.
 *
 * Features:
 * - Centralized flag definitions with descriptions and defaults
 * - Environment variable overrides
 * - Flag categories for organization
 * - Runtime flag evaluation
 * - Flag change listeners for reactive updates
 * - API endpoints for flag state queries
 *
 * Usage:
 *   const { getFeatureFlags } = require('./services/feature-flags-service');
 *   const flags = getFeatureFlags();
 *   if (flags.isEnabled('SEMANTIC_CHUNKING')) { ... }
 *
 * Environment variable naming:
 *   FF_<FLAG_NAME>=true|false
 *   e.g., FF_SEMANTIC_CHUNKING=true
 *
 * @module services/feature-flags-service
 */

const { log } = require('../utils/logger');
const { trackEvent } = require('../utils/telemetry');

/**
 * Flag categories for organization
 */
const FLAG_CATEGORIES = {
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  INGESTION: 'ingestion',
  GRAPHRAG: 'graphrag',
  EVALUATION: 'evaluation',
  UI: 'ui',
  EXPERIMENTAL: 'experimental',
};

/**
 * Feature flag definitions
 *
 * Each flag has:
 * - key: Unique identifier (SCREAMING_SNAKE_CASE)
 * - description: What the flag controls
 * - category: Grouping for organization
 * - default: Default value when no override
 * - envVar: Environment variable name for override
 * - dependencies: Array of other flags this depends on
 * - deprecated: If true, flag is scheduled for removal
 */
const FLAG_DEFINITIONS = {
  // Security features
  CIRCUIT_BREAKER: {
    key: 'CIRCUIT_BREAKER',
    description: 'Enable circuit breaker pattern for external services',
    category: FLAG_CATEGORIES.SECURITY,
    default: true,
    envVar: 'CIRCUIT_BREAKER_ENABLED',
  },
  PROMPT_INJECTION_DETECTION: {
    key: 'PROMPT_INJECTION_DETECTION',
    description: 'Enable prompt injection detection and blocking',
    category: FLAG_CATEGORIES.SECURITY,
    default: true,
    envVar: 'PROMPT_INJECTION_ENABLED',
  },
  PROMPT_INJECTION_BLOCK_HIGH: {
    key: 'PROMPT_INJECTION_BLOCK_HIGH',
    description: 'Block requests with high severity prompt injection detection',
    category: FLAG_CATEGORIES.SECURITY,
    default: true,
    envVar: 'PROMPT_INJECTION_BLOCK_HIGH',
  },
  PII_REDACTION: {
    key: 'PII_REDACTION',
    description: 'Enable PII detection and redaction in documents',
    category: FLAG_CATEGORIES.SECURITY,
    default: true,
    envVar: 'ENABLE_PII_REDACTION',
  },
  SECURITY_TRIMMING: {
    key: 'SECURITY_TRIMMING',
    description: 'Enable document-level security trimming based on user permissions',
    category: FLAG_CATEGORIES.SECURITY,
    default: true,
    envVar: 'FF_SECURITY_TRIMMING',
  },

  // Performance features
  ENTITY_RESOLUTION_CACHE: {
    key: 'ENTITY_RESOLUTION_CACHE',
    description: 'Enable caching for entity resolution lookups',
    category: FLAG_CATEGORIES.PERFORMANCE,
    default: true,
    envVar: 'CACHE_ENTITY_RESOLUTION_ENABLED',
  },
  EMBEDDING_CACHE: {
    key: 'EMBEDDING_CACHE',
    description: 'Enable caching for embedding vectors',
    category: FLAG_CATEGORIES.PERFORMANCE,
    default: true,
    envVar: 'FF_EMBEDDING_CACHE',
  },
  COMMUNITY_SUMMARY_CACHE: {
    key: 'COMMUNITY_SUMMARY_CACHE',
    description: 'Enable caching for community summaries',
    category: FLAG_CATEGORIES.PERFORMANCE,
    default: true,
    envVar: 'FF_COMMUNITY_SUMMARY_CACHE',
  },

  // Ingestion features
  SEMANTIC_CHUNKING: {
    key: 'SEMANTIC_CHUNKING',
    description: 'Use semantic chunking instead of fixed-size chunking',
    category: FLAG_CATEGORIES.INGESTION,
    default: false,
    envVar: 'FF_SEMANTIC_CHUNKING',
  },
  AUTO_CHUNKING: {
    key: 'AUTO_CHUNKING',
    description: 'Automatically select chunking strategy based on document type',
    category: FLAG_CATEGORIES.INGESTION,
    default: false,
    envVar: 'FF_AUTO_CHUNKING',
  },
  ONTOLOGY_VALIDATION: {
    key: 'ONTOLOGY_VALIDATION',
    description: 'Validate extracted entities/relationships against ontology',
    category: FLAG_CATEGORIES.INGESTION,
    default: true,
    envVar: 'FF_ONTOLOGY_VALIDATION',
  },
  RELATIONSHIP_VALIDATION: {
    key: 'RELATIONSHIP_VALIDATION',
    description: 'Enforce domain/range constraints on relationships',
    category: FLAG_CATEGORIES.INGESTION,
    default: true,
    envVar: 'FF_RELATIONSHIP_VALIDATION',
  },
  CONFIDENCE_PENALTY: {
    key: 'CONFIDENCE_PENALTY',
    description: 'Apply confidence penalties for validation violations',
    category: FLAG_CATEGORIES.INGESTION,
    default: true,
    envVar: 'FF_CONFIDENCE_PENALTY',
  },

  // GraphRAG features
  COMMUNITY_CONTEXT: {
    key: 'COMMUNITY_CONTEXT',
    description: 'Include community summaries in GraphRAG query context',
    category: FLAG_CATEGORIES.GRAPHRAG,
    default: true,
    envVar: 'FF_COMMUNITY_CONTEXT',
  },
  IMPORTANCE_WEIGHTED_RETRIEVAL: {
    key: 'IMPORTANCE_WEIGHTED_RETRIEVAL',
    description: 'Use entity importance scores (PageRank) in retrieval ranking',
    category: FLAG_CATEGORIES.GRAPHRAG,
    default: true,
    envVar: 'FF_IMPORTANCE_WEIGHTED_RETRIEVAL',
  },
  INCREMENTAL_COMMUNITY_UPDATES: {
    key: 'INCREMENTAL_COMMUNITY_UPDATES',
    description: 'Enable incremental community detection updates',
    category: FLAG_CATEGORIES.GRAPHRAG,
    default: true,
    envVar: 'FF_INCREMENTAL_COMMUNITY_UPDATES',
  },
  POLYMORPHIC_TYPE_QUERIES: {
    key: 'POLYMORPHIC_TYPE_QUERIES',
    description: 'Enable type hierarchy aware queries',
    category: FLAG_CATEGORIES.GRAPHRAG,
    default: true,
    envVar: 'FF_POLYMORPHIC_TYPE_QUERIES',
  },

  // Evaluation features
  EVALUATION_METRICS: {
    key: 'EVALUATION_METRICS',
    description: 'Enable evaluation metrics collection',
    category: FLAG_CATEGORIES.EVALUATION,
    default: true,
    envVar: 'FF_EVALUATION_METRICS',
  },
  BENCHMARK_AUTO_SAVE: {
    key: 'BENCHMARK_AUTO_SAVE',
    description: 'Automatically save benchmark results to storage',
    category: FLAG_CATEGORIES.EVALUATION,
    default: false,
    envVar: 'FF_BENCHMARK_AUTO_SAVE',
  },
  ADVERSARIAL_TESTS: {
    key: 'ADVERSARIAL_TESTS',
    description: 'Include adversarial tests in evaluation suite',
    category: FLAG_CATEGORIES.EVALUATION,
    default: true,
    envVar: 'FF_ADVERSARIAL_TESTS',
  },

  // UI features
  EVALUATION_DASHBOARD: {
    key: 'EVALUATION_DASHBOARD',
    description: 'Enable the evaluation dashboard UI',
    category: FLAG_CATEGORIES.UI,
    default: true,
    envVar: 'FF_EVALUATION_DASHBOARD',
  },
  STAGING_VALIDATION_WARNINGS: {
    key: 'STAGING_VALIDATION_WARNINGS',
    description: 'Show validation warnings in document staging UI',
    category: FLAG_CATEGORIES.UI,
    default: true,
    envVar: 'FF_STAGING_VALIDATION_WARNINGS',
  },

  // Experimental features
  LAZY_GRAPHRAG: {
    key: 'LAZY_GRAPHRAG',
    description: 'Enable lazy (on-demand) GraphRAG community detection',
    category: FLAG_CATEGORIES.EXPERIMENTAL,
    default: false,
    envVar: 'FF_LAZY_GRAPHRAG',
  },
  PERSONA_VIEWS: {
    key: 'PERSONA_VIEWS',
    description: 'Enable persona-specific query views',
    category: FLAG_CATEGORIES.EXPERIMENTAL,
    default: false,
    envVar: 'FF_PERSONA_VIEWS',
  },
  TEMPORAL_QUERIES: {
    key: 'TEMPORAL_QUERIES',
    description: 'Enable time-aware graph queries',
    category: FLAG_CATEGORIES.EXPERIMENTAL,
    default: false,
    envVar: 'FF_TEMPORAL_QUERIES',
  },
};

/**
 * Parse boolean from environment variable value
 * @param {string} value - Environment variable value
 * @param {boolean} defaultValue - Default if parsing fails
 * @returns {boolean}
 */
function parseBooleanEnv(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

class FeatureFlagsService {
  constructor() {
    this._flags = new Map();
    this._listeners = new Map();
    this._overrides = new Map();
    this._initialized = false;
    this._initializationTime = null;
  }

  /**
   * Initialize feature flags from definitions and environment
   */
  initialize() {
    if (this._initialized) {
      return;
    }

    log.info('Initializing feature flags service');

    for (const [key, definition] of Object.entries(FLAG_DEFINITIONS)) {
      const envValue = process.env[definition.envVar];
      const value = parseBooleanEnv(envValue, definition.default);

      this._flags.set(key, {
        ...definition,
        value,
        source: envValue !== undefined ? 'environment' : 'default',
      });

      if (envValue !== undefined) {
        log.debug(`Feature flag ${key} set from env: ${value}`, {
          envVar: definition.envVar,
          envValue,
        });
      }
    }

    this._initialized = true;
    this._initializationTime = new Date().toISOString();

    log.info('Feature flags initialized', {
      totalFlags: this._flags.size,
      fromEnvironment: Array.from(this._flags.values()).filter((f) => f.source === 'environment')
        .length,
    });
  }

  /**
   * Check if a feature flag is enabled
   * @param {string} flagKey - The flag key to check
   * @returns {boolean} - True if enabled
   */
  isEnabled(flagKey) {
    this._ensureInitialized();

    // Check runtime overrides first
    if (this._overrides.has(flagKey)) {
      return this._overrides.get(flagKey);
    }

    const flag = this._flags.get(flagKey);
    if (!flag) {
      log.warn(`Unknown feature flag requested: ${flagKey}`);
      return false;
    }

    // Check dependencies
    if (flag.dependencies && flag.dependencies.length > 0) {
      const unmetDeps = flag.dependencies.filter((dep) => !this.isEnabled(dep));
      if (unmetDeps.length > 0) {
        log.debug(`Feature flag ${flagKey} disabled due to unmet dependencies: ${unmetDeps.join(', ')}`);
        return false;
      }
    }

    return flag.value;
  }

  /**
   * Get all flags or flags by category
   * @param {string} category - Optional category filter
   * @returns {Object[]} - Array of flag states
   */
  getFlags(category = null) {
    this._ensureInitialized();

    const flags = [];
    for (const [key, flag] of this._flags) {
      if (!category || flag.category === category) {
        flags.push({
          key: flag.key,
          description: flag.description,
          category: flag.category,
          enabled: this.isEnabled(key),
          default: flag.default,
          source: this._overrides.has(key) ? 'override' : flag.source,
          envVar: flag.envVar,
          deprecated: flag.deprecated || false,
        });
      }
    }
    return flags;
  }

  /**
   * Get a single flag's full state
   * @param {string} flagKey - The flag key
   * @returns {Object|null} - Flag state or null if not found
   */
  getFlag(flagKey) {
    this._ensureInitialized();

    const flag = this._flags.get(flagKey);
    if (!flag) {
      return null;
    }

    return {
      key: flag.key,
      description: flag.description,
      category: flag.category,
      enabled: this.isEnabled(flagKey),
      default: flag.default,
      source: this._overrides.has(flagKey) ? 'override' : flag.source,
      envVar: flag.envVar,
      deprecated: flag.deprecated || false,
      dependencies: flag.dependencies || [],
    };
  }

  /**
   * Get flags grouped by category
   * @returns {Object} - Flags organized by category
   */
  getFlagsByCategory() {
    this._ensureInitialized();

    const byCategory = {};
    for (const category of Object.values(FLAG_CATEGORIES)) {
      byCategory[category] = this.getFlags(category);
    }
    return byCategory;
  }

  /**
   * Set a runtime override for a flag (for testing/admin purposes)
   * Note: This does not persist across restarts
   * @param {string} flagKey - The flag key
   * @param {boolean} value - The override value
   */
  setOverride(flagKey, value) {
    this._ensureInitialized();

    if (!this._flags.has(flagKey)) {
      throw new Error(`Unknown feature flag: ${flagKey}`);
    }

    const previousValue = this.isEnabled(flagKey);
    this._overrides.set(flagKey, Boolean(value));

    log.info(`Feature flag override set: ${flagKey} = ${value}`, {
      previousValue,
      newValue: value,
    });

    trackEvent('feature_flag_override', {
      flagKey,
      previousValue,
      newValue: value,
    });

    // Notify listeners
    this._notifyListeners(flagKey, value, previousValue);
  }

  /**
   * Clear a runtime override
   * @param {string} flagKey - The flag key
   */
  clearOverride(flagKey) {
    this._ensureInitialized();

    if (this._overrides.has(flagKey)) {
      const previousValue = this.isEnabled(flagKey);
      this._overrides.delete(flagKey);
      const newValue = this.isEnabled(flagKey);

      log.info(`Feature flag override cleared: ${flagKey}`, {
        previousValue,
        newValue,
      });

      this._notifyListeners(flagKey, newValue, previousValue);
    }
  }

  /**
   * Clear all runtime overrides
   */
  clearAllOverrides() {
    this._ensureInitialized();

    const cleared = Array.from(this._overrides.keys());
    this._overrides.clear();

    log.info(`All feature flag overrides cleared: ${cleared.length} flags`);
  }

  /**
   * Register a listener for flag changes
   * @param {string} flagKey - The flag key to listen to
   * @param {Function} callback - Callback(newValue, previousValue)
   * @returns {Function} - Unsubscribe function
   */
  onFlagChange(flagKey, callback) {
    if (!this._listeners.has(flagKey)) {
      this._listeners.set(flagKey, new Set());
    }
    this._listeners.get(flagKey).add(callback);

    return () => {
      const listeners = this._listeners.get(flagKey);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * Get summary statistics
   * @returns {Object} - Statistics about flag states
   */
  getStatistics() {
    this._ensureInitialized();

    const stats = {
      total: this._flags.size,
      enabled: 0,
      disabled: 0,
      bySource: {
        default: 0,
        environment: 0,
        override: 0,
      },
      byCategory: {},
      overrides: this._overrides.size,
      deprecated: 0,
      initializationTime: this._initializationTime,
    };

    for (const category of Object.values(FLAG_CATEGORIES)) {
      stats.byCategory[category] = { total: 0, enabled: 0 };
    }

    for (const [key, flag] of this._flags) {
      const isEnabled = this.isEnabled(key);

      if (isEnabled) {
        stats.enabled++;
      } else {
        stats.disabled++;
      }

      const source = this._overrides.has(key) ? 'override' : flag.source;
      stats.bySource[source]++;

      if (flag.category && stats.byCategory[flag.category]) {
        stats.byCategory[flag.category].total++;
        if (isEnabled) {
          stats.byCategory[flag.category].enabled++;
        }
      }

      if (flag.deprecated) {
        stats.deprecated++;
      }
    }

    return stats;
  }

  /**
   * Get all available categories
   * @returns {string[]} - Array of category names
   */
  getCategories() {
    return Object.values(FLAG_CATEGORIES);
  }

  /**
   * Check if a flag exists
   * @param {string} flagKey - The flag key
   * @returns {boolean}
   */
  hasFlag(flagKey) {
    this._ensureInitialized();
    return this._flags.has(flagKey);
  }

  /**
   * Notify registered listeners of flag changes
   * @private
   */
  _notifyListeners(flagKey, newValue, previousValue) {
    const listeners = this._listeners.get(flagKey);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(newValue, previousValue);
        } catch (error) {
          log.error(`Error in feature flag listener for ${flagKey}:`, error);
        }
      }
    }
  }

  /**
   * Ensure service is initialized
   * @private
   */
  _ensureInitialized() {
    if (!this._initialized) {
      this.initialize();
    }
  }

  /**
   * Reset service (for testing)
   */
  reset() {
    this._flags.clear();
    this._listeners.clear();
    this._overrides.clear();
    this._initialized = false;
    this._initializationTime = null;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the feature flags service instance
 * @returns {FeatureFlagsService}
 */
function getFeatureFlags() {
  if (!instance) {
    instance = new FeatureFlagsService();
    instance.initialize();
  }
  return instance;
}

/**
 * Convenience function to check if a flag is enabled
 * @param {string} flagKey - The flag key
 * @returns {boolean}
 */
function isFeatureEnabled(flagKey) {
  return getFeatureFlags().isEnabled(flagKey);
}

module.exports = {
  FeatureFlagsService,
  getFeatureFlags,
  isFeatureEnabled,
  FLAG_CATEGORIES,
  FLAG_DEFINITIONS,
};
