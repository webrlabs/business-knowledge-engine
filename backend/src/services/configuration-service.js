/**
 * Configuration Management Service
 *
 * Centralized configuration management for all thresholds and settings.
 * Provides a single source of truth for application configuration.
 *
 * Features:
 * - Centralized configuration definitions with descriptions, types, and defaults
 * - Environment variable overrides
 * - Configuration categories for organization
 * - Schema validation with type checking
 * - Runtime configuration changes (non-persistent)
 * - Configuration change listeners
 * - API endpoints for configuration queries and management
 *
 * Usage:
 *   const { getConfigurationService } = require('./services/configuration-service');
 *   const config = getConfigurationService();
 *   const chunkSize = config.get('CHUNK_SIZE');
 *   const allSearchConfig = config.getByCategory('search');
 *
 * Environment variable naming:
 *   CFG_<CONFIG_KEY>=value
 *   or use the specific envVar defined for each config
 *
 * @module services/configuration-service
 */

const { log } = require('../utils/logger');
const { trackEvent } = require('../utils/telemetry');

/**
 * Configuration categories
 */
const CONFIG_CATEGORIES = {
  OPENAI: 'openai',
  SEARCH: 'search',
  DOCUMENT_PROCESSING: 'document_processing',
  CHUNKING: 'chunking',
  CACHE: 'cache',
  CIRCUIT_BREAKER: 'circuit_breaker',
  RATE_LIMITING: 'rate_limiting',
  LATENCY_BUDGET: 'latency_budget',
  GRAPH: 'graph',
  EVALUATION: 'evaluation',
  ENTITY_RESOLUTION: 'entity_resolution',
  SECURITY: 'security',
  STORAGE: 'storage',
  TELEMETRY: 'telemetry',
};

/**
 * Configuration value types
 */
const CONFIG_TYPES = {
  NUMBER: 'number',
  STRING: 'string',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
};

/**
 * Configuration definitions
 *
 * Each config has:
 * - key: Unique identifier (SCREAMING_SNAKE_CASE)
 * - description: What the config controls
 * - category: Grouping for organization
 * - type: Value type for validation
 * - default: Default value when no override
 * - envVar: Environment variable name for override (optional, defaults to CFG_<KEY>)
 * - min/max: For numeric values, optional range constraints
 * - options: For string values, optional allowed values
 * - sensitive: If true, value is masked in logs/API responses
 * - restartRequired: If true, changes require restart to take effect
 * - unit: Optional unit description (e.g., 'ms', 'tokens', 'bytes')
 */
const CONFIG_DEFINITIONS = {
  // OpenAI Configuration
  OPENAI_API_VERSION: {
    key: 'OPENAI_API_VERSION',
    description: 'Azure OpenAI API version',
    category: CONFIG_CATEGORIES.OPENAI,
    type: CONFIG_TYPES.STRING,
    default: '2024-10-21',
    envVar: 'AZURE_OPENAI_API_VERSION',
    restartRequired: true,
  },
  OPENAI_MAX_TOKENS: {
    key: 'OPENAI_MAX_TOKENS',
    description: 'Maximum tokens per completion request',
    category: CONFIG_CATEGORIES.OPENAI,
    type: CONFIG_TYPES.NUMBER,
    default: 4096,
    envVar: 'CFG_OPENAI_MAX_TOKENS',
    min: 100,
    max: 128000,
    unit: 'tokens',
  },
  OPENAI_MAX_RETRIES: {
    key: 'OPENAI_MAX_RETRIES',
    description: 'Maximum retry attempts for OpenAI API calls',
    category: CONFIG_CATEGORIES.OPENAI,
    type: CONFIG_TYPES.NUMBER,
    default: 3,
    envVar: 'CFG_OPENAI_MAX_RETRIES',
    min: 0,
    max: 10,
  },
  OPENAI_RETRY_DELAY: {
    key: 'OPENAI_RETRY_DELAY',
    description: 'Base delay between retry attempts',
    category: CONFIG_CATEGORIES.OPENAI,
    type: CONFIG_TYPES.NUMBER,
    default: 1000,
    envVar: 'CFG_OPENAI_RETRY_DELAY',
    min: 100,
    max: 30000,
    unit: 'ms',
  },
  OPENAI_RPM_LIMIT: {
    key: 'OPENAI_RPM_LIMIT',
    description: 'Requests per minute limit for OpenAI API',
    category: CONFIG_CATEGORIES.OPENAI,
    type: CONFIG_TYPES.NUMBER,
    default: 60,
    envVar: 'OPENAI_RPM_LIMIT',
    min: 1,
    max: 10000,
    unit: 'requests/min',
  },
  OPENAI_TPM_LIMIT: {
    key: 'OPENAI_TPM_LIMIT',
    description: 'Tokens per minute limit for OpenAI API',
    category: CONFIG_CATEGORIES.OPENAI,
    type: CONFIG_TYPES.NUMBER,
    default: 90000,
    envVar: 'OPENAI_TPM_LIMIT',
    min: 1000,
    max: 10000000,
    unit: 'tokens/min',
  },
  OPENAI_EMBEDDING_BATCH_SIZE: {
    key: 'OPENAI_EMBEDDING_BATCH_SIZE',
    description: 'Batch size for embedding requests',
    category: CONFIG_CATEGORIES.OPENAI,
    type: CONFIG_TYPES.NUMBER,
    default: 16,
    envVar: 'CFG_OPENAI_EMBEDDING_BATCH_SIZE',
    min: 1,
    max: 100,
  },

  // Search Configuration
  SEARCH_INDEX_NAME: {
    key: 'SEARCH_INDEX_NAME',
    description: 'Azure AI Search index name for documents',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.STRING,
    default: 'documents',
    envVar: 'AZURE_SEARCH_INDEX_NAME',
    restartRequired: true,
  },
  SEARCH_ENTITY_INDEX: {
    key: 'SEARCH_ENTITY_INDEX',
    description: 'Azure AI Search index name for entities',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.STRING,
    default: 'entities',
    envVar: 'AZURE_SEARCH_ENTITY_INDEX',
    restartRequired: true,
  },
  SEARCH_BATCH_SIZE: {
    key: 'SEARCH_BATCH_SIZE',
    description: 'Batch size for search indexing operations',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.NUMBER,
    default: 100,
    envVar: 'CFG_SEARCH_BATCH_SIZE',
    min: 1,
    max: 1000,
  },
  SEARCH_VECTOR_DIMENSIONS: {
    key: 'SEARCH_VECTOR_DIMENSIONS',
    description: 'Vector embedding dimensions for search',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.NUMBER,
    default: 1536,
    envVar: 'CFG_SEARCH_VECTOR_DIMENSIONS',
    restartRequired: true,
  },
  SEARCH_HNSW_M: {
    key: 'SEARCH_HNSW_M',
    description: 'HNSW algorithm M parameter (connections per node)',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.NUMBER,
    default: 4,
    envVar: 'CFG_SEARCH_HNSW_M',
    min: 2,
    max: 100,
    restartRequired: true,
  },
  SEARCH_HNSW_EF_CONSTRUCTION: {
    key: 'SEARCH_HNSW_EF_CONSTRUCTION',
    description: 'HNSW algorithm efConstruction parameter',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.NUMBER,
    default: 400,
    envVar: 'CFG_SEARCH_HNSW_EF_CONSTRUCTION',
    min: 100,
    max: 1000,
    restartRequired: true,
  },
  SEARCH_HNSW_EF_SEARCH: {
    key: 'SEARCH_HNSW_EF_SEARCH',
    description: 'HNSW algorithm efSearch parameter',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.NUMBER,
    default: 500,
    envVar: 'CFG_SEARCH_HNSW_EF_SEARCH',
    min: 100,
    max: 1000,
  },
  SEARCH_DEFAULT_TOP_K: {
    key: 'SEARCH_DEFAULT_TOP_K',
    description: 'Default number of results to return',
    category: CONFIG_CATEGORIES.SEARCH,
    type: CONFIG_TYPES.NUMBER,
    default: 10,
    envVar: 'CFG_SEARCH_DEFAULT_TOP_K',
    min: 1,
    max: 100,
  },

  // Document Processing Configuration
  DOCUMENT_MAX_SIZE_MB: {
    key: 'DOCUMENT_MAX_SIZE_MB',
    description: 'Maximum document upload size',
    category: CONFIG_CATEGORIES.DOCUMENT_PROCESSING,
    type: CONFIG_TYPES.NUMBER,
    default: 50,
    envVar: 'CFG_DOCUMENT_MAX_SIZE_MB',
    min: 1,
    max: 500,
    unit: 'MB',
  },
  DOCUMENT_ALLOWED_EXTENSIONS: {
    key: 'DOCUMENT_ALLOWED_EXTENSIONS',
    description: 'Allowed file extensions for upload',
    category: CONFIG_CATEGORIES.DOCUMENT_PROCESSING,
    type: CONFIG_TYPES.ARRAY,
    default: ['.pdf', '.docx', '.pptx', '.xlsx', '.vsdx', '.doc', '.ppt', '.xls'],
    envVar: 'CFG_DOCUMENT_ALLOWED_EXTENSIONS',
  },
  DOCUMENT_PROCESSOR_BATCH_SIZE: {
    key: 'DOCUMENT_PROCESSOR_BATCH_SIZE',
    description: 'Batch size for document processing',
    category: CONFIG_CATEGORIES.DOCUMENT_PROCESSING,
    type: CONFIG_TYPES.NUMBER,
    default: 16,
    envVar: 'CFG_DOCUMENT_PROCESSOR_BATCH_SIZE',
    min: 1,
    max: 50,
  },
  ENTITY_EXTRACTOR_BATCH_SIZE: {
    key: 'ENTITY_EXTRACTOR_BATCH_SIZE',
    description: 'Number of chunks to process in parallel for entity extraction',
    category: CONFIG_CATEGORIES.DOCUMENT_PROCESSING,
    type: CONFIG_TYPES.NUMBER,
    default: 3,
    envVar: 'CFG_ENTITY_EXTRACTOR_BATCH_SIZE',
    min: 1,
    max: 10,
  },

  // Chunking Configuration
  CHUNK_SIZE: {
    key: 'CHUNK_SIZE',
    description: 'Target chunk size in tokens',
    category: CONFIG_CATEGORIES.CHUNKING,
    type: CONFIG_TYPES.NUMBER,
    default: 500,
    envVar: 'CFG_CHUNK_SIZE',
    min: 100,
    max: 4000,
    unit: 'tokens',
  },
  CHUNK_OVERLAP: {
    key: 'CHUNK_OVERLAP',
    description: 'Overlap between chunks',
    category: CONFIG_CATEGORIES.CHUNKING,
    type: CONFIG_TYPES.NUMBER,
    default: 50,
    envVar: 'CFG_CHUNK_OVERLAP',
    min: 0,
    max: 500,
    unit: 'tokens',
  },
  SEMANTIC_CHUNKING_MAX_CHARS: {
    key: 'SEMANTIC_CHUNKING_MAX_CHARS',
    description: 'Maximum characters for semantic chunking',
    category: CONFIG_CATEGORIES.CHUNKING,
    type: CONFIG_TYPES.NUMBER,
    default: 200000,
    envVar: 'SEMANTIC_CHUNKING_MAX_CHARS',
    min: 10000,
    max: 1000000,
    unit: 'chars',
  },
  SEMANTIC_CHUNKING_MAX_PAGES: {
    key: 'SEMANTIC_CHUNKING_MAX_PAGES',
    description: 'Maximum pages for semantic chunking',
    category: CONFIG_CATEGORIES.CHUNKING,
    type: CONFIG_TYPES.NUMBER,
    default: 50,
    envVar: 'SEMANTIC_CHUNKING_MAX_PAGES',
    min: 1,
    max: 500,
    unit: 'pages',
  },
  SEMANTIC_CHUNKING_THRESHOLD: {
    key: 'SEMANTIC_CHUNKING_THRESHOLD',
    description: 'Percentile threshold for topic boundary detection',
    category: CONFIG_CATEGORIES.CHUNKING,
    type: CONFIG_TYPES.NUMBER,
    default: 95,
    envVar: 'CFG_SEMANTIC_CHUNKING_THRESHOLD',
    min: 50,
    max: 99,
    unit: 'percentile',
  },
  CHUNKING_STRATEGY: {
    key: 'CHUNKING_STRATEGY',
    description: 'Default chunking strategy',
    category: CONFIG_CATEGORIES.CHUNKING,
    type: CONFIG_TYPES.STRING,
    default: 'fixed',
    envVar: 'CHUNKING_STRATEGY',
    options: ['fixed', 'semantic', 'auto'],
  },

  // Cache Configuration
  CACHE_RESOLVED_ENTITIES_MAX: {
    key: 'CACHE_RESOLVED_ENTITIES_MAX',
    description: 'Maximum items in resolved entities cache',
    category: CONFIG_CATEGORIES.CACHE,
    type: CONFIG_TYPES.NUMBER,
    default: 5000,
    envVar: 'CACHE_RESOLVED_ENTITIES_MAX',
    min: 100,
    max: 100000,
  },
  CACHE_RESOLVED_ENTITIES_TTL: {
    key: 'CACHE_RESOLVED_ENTITIES_TTL',
    description: 'TTL for resolved entities cache',
    category: CONFIG_CATEGORIES.CACHE,
    type: CONFIG_TYPES.NUMBER,
    default: 1800000,
    envVar: 'CACHE_RESOLVED_ENTITIES_TTL_MS',
    min: 60000,
    max: 86400000,
    unit: 'ms',
  },
  CACHE_EMBEDDINGS_MAX: {
    key: 'CACHE_EMBEDDINGS_MAX',
    description: 'Maximum items in embeddings cache',
    category: CONFIG_CATEGORIES.CACHE,
    type: CONFIG_TYPES.NUMBER,
    default: 2000,
    envVar: 'CACHE_EMBEDDINGS_MAX',
    min: 100,
    max: 50000,
  },
  CACHE_EMBEDDINGS_TTL: {
    key: 'CACHE_EMBEDDINGS_TTL',
    description: 'TTL for embeddings cache',
    category: CONFIG_CATEGORIES.CACHE,
    type: CONFIG_TYPES.NUMBER,
    default: 3600000,
    envVar: 'CACHE_EMBEDDINGS_TTL_MS',
    min: 60000,
    max: 86400000,
    unit: 'ms',
  },
  CACHE_SIMILARITY_MAX: {
    key: 'CACHE_SIMILARITY_MAX',
    description: 'Maximum items in similarity cache',
    category: CONFIG_CATEGORIES.CACHE,
    type: CONFIG_TYPES.NUMBER,
    default: 10000,
    envVar: 'CACHE_SIMILARITY_MAX',
    min: 100,
    max: 100000,
  },
  CACHE_SIMILARITY_TTL: {
    key: 'CACHE_SIMILARITY_TTL',
    description: 'TTL for similarity cache',
    category: CONFIG_CATEGORIES.CACHE,
    type: CONFIG_TYPES.NUMBER,
    default: 900000,
    envVar: 'CACHE_SIMILARITY_TTL_MS',
    min: 60000,
    max: 86400000,
    unit: 'ms',
  },

  // Circuit Breaker Configuration
  CB_OPENAI_TIMEOUT: {
    key: 'CB_OPENAI_TIMEOUT',
    description: 'Timeout for OpenAI circuit breaker',
    category: CONFIG_CATEGORIES.CIRCUIT_BREAKER,
    type: CONFIG_TYPES.NUMBER,
    default: 60000,
    envVar: 'CB_OPENAI_TIMEOUT',
    min: 5000,
    max: 300000,
    unit: 'ms',
  },
  CB_OPENAI_ERROR_THRESHOLD: {
    key: 'CB_OPENAI_ERROR_THRESHOLD',
    description: 'Error threshold percentage for OpenAI circuit breaker',
    category: CONFIG_CATEGORIES.CIRCUIT_BREAKER,
    type: CONFIG_TYPES.NUMBER,
    default: 50,
    envVar: 'CB_OPENAI_ERROR_THRESHOLD',
    min: 10,
    max: 100,
    unit: '%',
  },
  CB_OPENAI_RESET_TIMEOUT: {
    key: 'CB_OPENAI_RESET_TIMEOUT',
    description: 'Reset timeout for OpenAI circuit breaker',
    category: CONFIG_CATEGORIES.CIRCUIT_BREAKER,
    type: CONFIG_TYPES.NUMBER,
    default: 30000,
    envVar: 'CB_OPENAI_RESET_TIMEOUT',
    min: 5000,
    max: 300000,
    unit: 'ms',
  },
  CB_SEARCH_TIMEOUT: {
    key: 'CB_SEARCH_TIMEOUT',
    description: 'Timeout for Search circuit breaker',
    category: CONFIG_CATEGORIES.CIRCUIT_BREAKER,
    type: CONFIG_TYPES.NUMBER,
    default: 15000,
    envVar: 'CB_SEARCH_TIMEOUT',
    min: 1000,
    max: 60000,
    unit: 'ms',
  },
  CB_GREMLIN_TIMEOUT: {
    key: 'CB_GREMLIN_TIMEOUT',
    description: 'Timeout for Gremlin circuit breaker',
    category: CONFIG_CATEGORIES.CIRCUIT_BREAKER,
    type: CONFIG_TYPES.NUMBER,
    default: 30000,
    envVar: 'CB_GREMLIN_TIMEOUT',
    min: 5000,
    max: 120000,
    unit: 'ms',
  },

  // Rate Limiting Configuration
  RATE_LIMIT_WINDOW_MS: {
    key: 'RATE_LIMIT_WINDOW_MS',
    description: 'Window duration for rate limiting',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 900000,
    envVar: 'RATE_LIMIT_WINDOW_MS',
    min: 60000,
    max: 3600000,
    unit: 'ms',
  },
  RATE_LIMIT_MAX_REQUESTS_DEV: {
    key: 'RATE_LIMIT_MAX_REQUESTS_DEV',
    description: 'Max requests per window in development',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 1000,
    envVar: 'CFG_RATE_LIMIT_MAX_REQUESTS_DEV',
    min: 10,
    max: 10000,
  },
  RATE_LIMIT_MAX_REQUESTS_PROD: {
    key: 'RATE_LIMIT_MAX_REQUESTS_PROD',
    description: 'Max requests per window in production',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 100,
    envVar: 'CFG_RATE_LIMIT_MAX_REQUESTS_PROD',
    min: 10,
    max: 10000,
  },
  RATE_LIMIT_GRAPHRAG_MAX: {
    key: 'RATE_LIMIT_GRAPHRAG_MAX',
    description: 'Max GraphRAG queries per minute',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 30,
    envVar: 'CFG_RATE_LIMIT_GRAPHRAG_MAX',
    min: 1,
    max: 1000,
  },
  RATE_LIMIT_UPLOADS_MAX: {
    key: 'RATE_LIMIT_UPLOADS_MAX',
    description: 'Max uploads per hour',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 20,
    envVar: 'CFG_RATE_LIMIT_UPLOADS_MAX',
    min: 1,
    max: 100,
  },

  // Per-User Rate Limiting (F5.3.5)
  RATE_LIMIT_ADMIN_MULTIPLIER: {
    key: 'RATE_LIMIT_ADMIN_MULTIPLIER',
    description: 'Rate limit multiplier for admin users',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 3.0,
    envVar: 'RATE_LIMIT_ADMIN_MULTIPLIER',
    min: 1.0,
    max: 10.0,
  },
  RATE_LIMIT_REVIEWER_MULTIPLIER: {
    key: 'RATE_LIMIT_REVIEWER_MULTIPLIER',
    description: 'Rate limit multiplier for reviewer users',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 2.0,
    envVar: 'RATE_LIMIT_REVIEWER_MULTIPLIER',
    min: 1.0,
    max: 10.0,
  },
  RATE_LIMIT_CONTRIBUTOR_MULTIPLIER: {
    key: 'RATE_LIMIT_CONTRIBUTOR_MULTIPLIER',
    description: 'Rate limit multiplier for contributor users',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 1.5,
    envVar: 'RATE_LIMIT_CONTRIBUTOR_MULTIPLIER',
    min: 1.0,
    max: 10.0,
  },
  RATE_LIMIT_READER_MULTIPLIER: {
    key: 'RATE_LIMIT_READER_MULTIPLIER',
    description: 'Rate limit multiplier for reader users',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.NUMBER,
    default: 1.0,
    envVar: 'RATE_LIMIT_READER_MULTIPLIER',
    min: 0.5,
    max: 5.0,
  },
  RATE_LIMIT_PER_USER_ENABLED: {
    key: 'RATE_LIMIT_PER_USER_ENABLED',
    description: 'Enable per-user rate limiting (vs IP-only)',
    category: CONFIG_CATEGORIES.RATE_LIMITING,
    type: CONFIG_TYPES.BOOLEAN,
    default: true,
    envVar: 'RATE_LIMIT_PER_USER_ENABLED',
  },

  // Latency Budget Configuration (F5.2.5)
  LATENCY_BUDGET_ENABLED: {
    key: 'LATENCY_BUDGET_ENABLED',
    description: 'Enable latency budget tracking and enforcement',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.BOOLEAN,
    default: true,
    envVar: 'LATENCY_BUDGET_ENABLED',
  },
  LATENCY_BUDGET_QUERY_MS: {
    key: 'LATENCY_BUDGET_QUERY_MS',
    description: 'SLO budget for query operations (GraphRAG, search)',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 3000,
    envVar: 'LATENCY_BUDGET_QUERY_MS',
    min: 100,
    max: 60000,
    unit: 'ms',
  },
  LATENCY_BUDGET_PROCESSING_MS: {
    key: 'LATENCY_BUDGET_PROCESSING_MS',
    description: 'SLO budget for document processing operations',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 300000,
    envVar: 'LATENCY_BUDGET_PROCESSING_MS',
    min: 10000,
    max: 600000,
    unit: 'ms',
  },
  LATENCY_BUDGET_GRAPH_TRAVERSAL_MS: {
    key: 'LATENCY_BUDGET_GRAPH_TRAVERSAL_MS',
    description: 'SLO budget for graph traversal operations',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 5000,
    envVar: 'LATENCY_BUDGET_GRAPH_TRAVERSAL_MS',
    min: 500,
    max: 60000,
    unit: 'ms',
  },
  LATENCY_BUDGET_ENTITY_RESOLUTION_MS: {
    key: 'LATENCY_BUDGET_ENTITY_RESOLUTION_MS',
    description: 'SLO budget for entity resolution operations',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 2000,
    envVar: 'LATENCY_BUDGET_ENTITY_RESOLUTION_MS',
    min: 100,
    max: 30000,
    unit: 'ms',
  },
  LATENCY_BUDGET_SEARCH_MS: {
    key: 'LATENCY_BUDGET_SEARCH_MS',
    description: 'SLO budget for search operations',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 1500,
    envVar: 'LATENCY_BUDGET_SEARCH_MS',
    min: 100,
    max: 30000,
    unit: 'ms',
  },
  LATENCY_BUDGET_OPENAI_MS: {
    key: 'LATENCY_BUDGET_OPENAI_MS',
    description: 'SLO budget for OpenAI API calls',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 30000,
    envVar: 'LATENCY_BUDGET_OPENAI_MS',
    min: 1000,
    max: 120000,
    unit: 'ms',
  },
  LATENCY_BUDGET_WARNING_THRESHOLD: {
    key: 'LATENCY_BUDGET_WARNING_THRESHOLD',
    description: 'Percentage of budget that triggers warning (0.0-1.0)',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 0.7,
    envVar: 'LATENCY_BUDGET_WARNING_THRESHOLD',
    min: 0.1,
    max: 1.0,
  },
  LATENCY_BUDGET_CRITICAL_THRESHOLD: {
    key: 'LATENCY_BUDGET_CRITICAL_THRESHOLD',
    description: 'Percentage of budget that triggers critical alert (0.0-1.0)',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 0.9,
    envVar: 'LATENCY_BUDGET_CRITICAL_THRESHOLD',
    min: 0.5,
    max: 1.0,
  },
  LATENCY_BUDGET_WINDOW_MS: {
    key: 'LATENCY_BUDGET_WINDOW_MS',
    description: 'Time window for percentile calculations',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 60000,
    envVar: 'LATENCY_BUDGET_WINDOW_MS',
    min: 10000,
    max: 600000,
    unit: 'ms',
  },
  LATENCY_BUDGET_BUCKET_COUNT: {
    key: 'LATENCY_BUDGET_BUCKET_COUNT',
    description: 'Number of time buckets for rolling window',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 60,
    envVar: 'LATENCY_BUDGET_BUCKET_COUNT',
    min: 10,
    max: 120,
  },
  LATENCY_BUDGET_RETENTION_BUCKETS: {
    key: 'LATENCY_BUDGET_RETENTION_BUCKETS',
    description: 'Number of historical buckets to retain for trend analysis',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.NUMBER,
    default: 1440,
    envVar: 'LATENCY_BUDGET_RETENTION_BUCKETS',
    min: 60,
    max: 10080,
  },
  LATENCY_BUDGET_ALERTS_ENABLED: {
    key: 'LATENCY_BUDGET_ALERTS_ENABLED',
    description: 'Enable telemetry alerts for budget breaches',
    category: CONFIG_CATEGORIES.LATENCY_BUDGET,
    type: CONFIG_TYPES.BOOLEAN,
    default: true,
    envVar: 'LATENCY_BUDGET_ALERTS_ENABLED',
  },

  // Graph Configuration
  GRAPH_DEFAULT_TRAVERSAL_DEPTH: {
    key: 'GRAPH_DEFAULT_TRAVERSAL_DEPTH',
    description: 'Default depth for graph traversals',
    category: CONFIG_CATEGORIES.GRAPH,
    type: CONFIG_TYPES.NUMBER,
    default: 2,
    envVar: 'CFG_GRAPH_DEFAULT_TRAVERSAL_DEPTH',
    min: 1,
    max: 10,
  },
  GRAPH_MAX_TRAVERSAL_DEPTH: {
    key: 'GRAPH_MAX_TRAVERSAL_DEPTH',
    description: 'Maximum depth for graph traversals',
    category: CONFIG_CATEGORIES.GRAPH,
    type: CONFIG_TYPES.NUMBER,
    default: 5,
    envVar: 'CFG_GRAPH_MAX_TRAVERSAL_DEPTH',
    min: 1,
    max: 20,
  },
  GRAPH_IMPACT_DECAY_FACTOR: {
    key: 'GRAPH_IMPACT_DECAY_FACTOR',
    description: 'Decay factor for impact scoring per hop',
    category: CONFIG_CATEGORIES.GRAPH,
    type: CONFIG_TYPES.NUMBER,
    default: 0.7,
    envVar: 'CFG_GRAPH_IMPACT_DECAY_FACTOR',
    min: 0.1,
    max: 1.0,
  },

  // Entity Resolution Configuration
  ENTITY_SIMILARITY_THRESHOLD: {
    key: 'ENTITY_SIMILARITY_THRESHOLD',
    description: 'Minimum similarity for entity matching',
    category: CONFIG_CATEGORIES.ENTITY_RESOLUTION,
    type: CONFIG_TYPES.NUMBER,
    default: 0.85,
    envVar: 'CFG_ENTITY_SIMILARITY_THRESHOLD',
    min: 0.5,
    max: 1.0,
  },
  ENTITY_MERGE_THRESHOLD: {
    key: 'ENTITY_MERGE_THRESHOLD',
    description: 'Similarity threshold for automatic entity merging',
    category: CONFIG_CATEGORIES.ENTITY_RESOLUTION,
    type: CONFIG_TYPES.NUMBER,
    default: 0.95,
    envVar: 'CFG_ENTITY_MERGE_THRESHOLD',
    min: 0.8,
    max: 1.0,
  },

  // Importance Weights
  IMPORTANCE_PAGERANK_WEIGHT: {
    key: 'IMPORTANCE_PAGERANK_WEIGHT',
    description: 'Weight of PageRank in importance calculation',
    category: CONFIG_CATEGORIES.GRAPH,
    type: CONFIG_TYPES.NUMBER,
    default: 0.4,
    envVar: 'CFG_IMPORTANCE_PAGERANK_WEIGHT',
    min: 0,
    max: 1,
  },
  IMPORTANCE_BETWEENNESS_WEIGHT: {
    key: 'IMPORTANCE_BETWEENNESS_WEIGHT',
    description: 'Weight of betweenness centrality in importance calculation',
    category: CONFIG_CATEGORIES.GRAPH,
    type: CONFIG_TYPES.NUMBER,
    default: 0.35,
    envVar: 'CFG_IMPORTANCE_BETWEENNESS_WEIGHT',
    min: 0,
    max: 1,
  },
  IMPORTANCE_MENTION_WEIGHT: {
    key: 'IMPORTANCE_MENTION_WEIGHT',
    description: 'Weight of mention frequency in importance calculation',
    category: CONFIG_CATEGORIES.GRAPH,
    type: CONFIG_TYPES.NUMBER,
    default: 0.25,
    envVar: 'CFG_IMPORTANCE_MENTION_WEIGHT',
    min: 0,
    max: 1,
  },

  // Evaluation Configuration
  EVALUATION_RETRIEVAL_K: {
    key: 'EVALUATION_RETRIEVAL_K',
    description: 'K value for Recall@K and Precision@K metrics',
    category: CONFIG_CATEGORIES.EVALUATION,
    type: CONFIG_TYPES.NUMBER,
    default: 10,
    envVar: 'CFG_EVALUATION_RETRIEVAL_K',
    min: 1,
    max: 100,
  },
  EVALUATION_THRESHOLD_WARNING: {
    key: 'EVALUATION_THRESHOLD_WARNING',
    description: 'Threshold below which metrics trigger warnings',
    category: CONFIG_CATEGORIES.EVALUATION,
    type: CONFIG_TYPES.NUMBER,
    default: 0.7,
    envVar: 'CFG_EVALUATION_THRESHOLD_WARNING',
    min: 0,
    max: 1,
  },
  EVALUATION_THRESHOLD_CRITICAL: {
    key: 'EVALUATION_THRESHOLD_CRITICAL',
    description: 'Threshold below which metrics trigger critical alerts',
    category: CONFIG_CATEGORIES.EVALUATION,
    type: CONFIG_TYPES.NUMBER,
    default: 0.5,
    envVar: 'CFG_EVALUATION_THRESHOLD_CRITICAL',
    min: 0,
    max: 1,
  },

  // Security Configuration
  PROMPT_INJECTION_HEURISTIC_THRESHOLD: {
    key: 'PROMPT_INJECTION_HEURISTIC_THRESHOLD',
    description: 'Threshold for prompt injection heuristic scoring',
    category: CONFIG_CATEGORIES.SECURITY,
    type: CONFIG_TYPES.NUMBER,
    default: 0.7,
    envVar: 'PROMPT_INJECTION_HEURISTIC_THRESHOLD',
    min: 0.1,
    max: 1.0,
  },
  AUDIT_LOG_RETENTION_DAYS: {
    key: 'AUDIT_LOG_RETENTION_DAYS',
    description: 'Days to retain audit logs',
    category: CONFIG_CATEGORIES.SECURITY,
    type: CONFIG_TYPES.NUMBER,
    default: 90,
    envVar: 'CFG_AUDIT_LOG_RETENTION_DAYS',
    min: 7,
    max: 365,
    unit: 'days',
  },
  AUDIT_LOG_RETENTION_SWEEP_HOURS: {
    key: 'AUDIT_LOG_RETENTION_SWEEP_HOURS',
    description: 'How often to run audit log retention cleanup',
    category: CONFIG_CATEGORIES.SECURITY,
    type: CONFIG_TYPES.NUMBER,
    default: 24,
    envVar: 'CFG_AUDIT_LOG_RETENTION_SWEEP_HOURS',
    min: 1,
    max: 168,
    unit: 'hours',
  },
  AUDIT_LOG_ARCHIVE_ENABLED: {
    key: 'AUDIT_LOG_ARCHIVE_ENABLED',
    description: 'Enable archiving of audit logs before deletion',
    category: CONFIG_CATEGORIES.SECURITY,
    type: CONFIG_TYPES.BOOLEAN,
    default: false,
    envVar: 'CFG_AUDIT_LOG_ARCHIVE_ENABLED',
  },
  AUDIT_LOG_ARCHIVE_DIR: {
    key: 'AUDIT_LOG_ARCHIVE_DIR',
    description: 'Directory for archived audit log exports',
    category: CONFIG_CATEGORIES.SECURITY,
    type: CONFIG_TYPES.STRING,
    default: 'audit-archives',
    envVar: 'CFG_AUDIT_LOG_ARCHIVE_DIR',
  },

  // Storage Configuration
  COSMOS_DB_DATABASE: {
    key: 'COSMOS_DB_DATABASE',
    description: 'Cosmos DB database name',
    category: CONFIG_CATEGORIES.STORAGE,
    type: CONFIG_TYPES.STRING,
    default: 'knowledge-platform',
    envVar: 'COSMOS_DB_DATABASE',
    restartRequired: true,
  },
  COSMOS_GREMLIN_DATABASE: {
    key: 'COSMOS_GREMLIN_DATABASE',
    description: 'Cosmos DB Gremlin database name',
    category: CONFIG_CATEGORIES.STORAGE,
    type: CONFIG_TYPES.STRING,
    default: 'knowledge-graph',
    envVar: 'COSMOS_GREMLIN_DATABASE',
    restartRequired: true,
  },
  COSMOS_GREMLIN_GRAPH: {
    key: 'COSMOS_GREMLIN_GRAPH',
    description: 'Cosmos DB Gremlin graph name',
    category: CONFIG_CATEGORIES.STORAGE,
    type: CONFIG_TYPES.STRING,
    default: 'entities',
    envVar: 'COSMOS_GREMLIN_GRAPH',
    restartRequired: true,
  },
  BLOB_CONTAINER_DOCUMENTS: {
    key: 'BLOB_CONTAINER_DOCUMENTS',
    description: 'Blob storage container for documents',
    category: CONFIG_CATEGORIES.STORAGE,
    type: CONFIG_TYPES.STRING,
    default: 'documents',
    envVar: 'AZURE_STORAGE_CONTAINER_DOCUMENTS',
    restartRequired: true,
  },

  // Telemetry Configuration
  TELEMETRY_CLOUD_ROLE: {
    key: 'TELEMETRY_CLOUD_ROLE',
    description: 'Cloud role name for Application Insights',
    category: CONFIG_CATEGORIES.TELEMETRY,
    type: CONFIG_TYPES.STRING,
    default: 'knowledge-platform-backend',
    envVar: 'APPINSIGHTS_CLOUD_ROLE',
  },
  LOG_LEVEL: {
    key: 'LOG_LEVEL',
    description: 'Logging level',
    category: CONFIG_CATEGORIES.TELEMETRY,
    type: CONFIG_TYPES.STRING,
    default: 'info',
    envVar: 'LOG_LEVEL',
    options: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
  },
};

/**
 * Parse value from environment variable based on type
 * @param {string} value - Environment variable value
 * @param {string} type - Expected type
 * @param {*} defaultValue - Default if parsing fails
 * @returns {*} - Parsed value
 */
function parseEnvValue(value, type, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  try {
    switch (type) {
      case CONFIG_TYPES.NUMBER: {
        const num = parseFloat(value);
        return isNaN(num) ? defaultValue : num;
      }
      case CONFIG_TYPES.BOOLEAN: {
        const normalized = String(value).toLowerCase().trim();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
          return true;
        }
        if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
          return false;
        }
        return defaultValue;
      }
      case CONFIG_TYPES.ARRAY: {
        // Support comma-separated values or JSON array
        if (value.startsWith('[')) {
          return JSON.parse(value);
        }
        return value.split(',').map((s) => s.trim());
      }
      case CONFIG_TYPES.OBJECT: {
        return JSON.parse(value);
      }
      case CONFIG_TYPES.STRING:
      default:
        return value;
    }
  } catch {
    return defaultValue;
  }
}

/**
 * Validate a value against its definition
 * @param {*} value - Value to validate
 * @param {Object} definition - Configuration definition
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateValue(value, definition) {
  // Type check
  switch (definition.type) {
    case CONFIG_TYPES.NUMBER:
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: `Expected number, got ${typeof value}` };
      }
      if (definition.min !== undefined && value < definition.min) {
        return { valid: false, error: `Value ${value} is below minimum ${definition.min}` };
      }
      if (definition.max !== undefined && value > definition.max) {
        return { valid: false, error: `Value ${value} exceeds maximum ${definition.max}` };
      }
      break;
    case CONFIG_TYPES.STRING:
      if (typeof value !== 'string') {
        return { valid: false, error: `Expected string, got ${typeof value}` };
      }
      if (definition.options && !definition.options.includes(value)) {
        return { valid: false, error: `Value must be one of: ${definition.options.join(', ')}` };
      }
      break;
    case CONFIG_TYPES.BOOLEAN:
      if (typeof value !== 'boolean') {
        return { valid: false, error: `Expected boolean, got ${typeof value}` };
      }
      break;
    case CONFIG_TYPES.ARRAY:
      if (!Array.isArray(value)) {
        return { valid: false, error: `Expected array, got ${typeof value}` };
      }
      break;
    case CONFIG_TYPES.OBJECT:
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { valid: false, error: `Expected object, got ${typeof value}` };
      }
      break;
  }

  return { valid: true };
}

class ConfigurationService {
  constructor() {
    this._config = new Map();
    this._overrides = new Map();
    this._listeners = new Map();
    this._initialized = false;
    this._initializationTime = null;
    this._validationErrors = [];
  }

  /**
   * Initialize configuration from definitions and environment
   */
  initialize() {
    if (this._initialized) {
      return;
    }

    log.info('Initializing configuration service');
    this._validationErrors = [];

    for (const [key, definition] of Object.entries(CONFIG_DEFINITIONS)) {
      const envValue = process.env[definition.envVar];
      const value = parseEnvValue(envValue, definition.type, definition.default);

      // Validate the value
      const validation = validateValue(value, definition);
      if (!validation.valid) {
        this._validationErrors.push({
          key,
          error: validation.error,
          value,
          envVar: definition.envVar,
        });
        log.warn(`Configuration validation error for ${key}: ${validation.error}`, {
          value,
          envVar: definition.envVar,
        });
      }

      this._config.set(key, {
        ...definition,
        value,
        source: envValue !== undefined ? 'environment' : 'default',
      });

      if (envValue !== undefined) {
        log.debug(`Configuration ${key} set from env: ${definition.sensitive ? '***' : value}`, {
          envVar: definition.envVar,
        });
      }
    }

    this._initialized = true;
    this._initializationTime = new Date().toISOString();

    log.info('Configuration service initialized', {
      totalConfigs: this._config.size,
      fromEnvironment: Array.from(this._config.values()).filter((c) => c.source === 'environment').length,
      validationErrors: this._validationErrors.length,
    });
  }

  /**
   * Get a configuration value
   * @param {string} key - Configuration key
   * @returns {*} - Configuration value
   */
  get(key) {
    this._ensureInitialized();

    // Check runtime overrides first
    if (this._overrides.has(key)) {
      return this._overrides.get(key);
    }

    const config = this._config.get(key);
    if (!config) {
      log.warn(`Unknown configuration requested: ${key}`);
      return undefined;
    }

    return config.value;
  }

  /**
   * Get configuration with full metadata
   * @param {string} key - Configuration key
   * @returns {Object|null} - Full configuration object or null
   */
  getWithMetadata(key) {
    this._ensureInitialized();

    const config = this._config.get(key);
    if (!config) {
      return null;
    }

    return {
      key: config.key,
      description: config.description,
      category: config.category,
      type: config.type,
      value: this._overrides.has(key) ? this._overrides.get(key) : config.value,
      default: config.default,
      source: this._overrides.has(key) ? 'override' : config.source,
      envVar: config.envVar,
      min: config.min,
      max: config.max,
      options: config.options,
      unit: config.unit,
      sensitive: config.sensitive || false,
      restartRequired: config.restartRequired || false,
    };
  }

  /**
   * Get all configurations or by category
   * @param {string} category - Optional category filter
   * @returns {Object[]} - Array of configuration objects
   */
  getAll(category = null) {
    this._ensureInitialized();

    const configs = [];
    for (const [key] of this._config) {
      const config = this.getWithMetadata(key);
      if (!category || config.category === category) {
        // Mask sensitive values
        if (config.sensitive) {
          config.value = '***';
        }
        configs.push(config);
      }
    }
    return configs;
  }

  /**
   * Get configurations grouped by category
   * @returns {Object} - Configs organized by category
   */
  getByCategory() {
    this._ensureInitialized();

    const byCategory = {};
    for (const category of Object.values(CONFIG_CATEGORIES)) {
      byCategory[category] = this.getAll(category);
    }
    return byCategory;
  }

  /**
   * Set a runtime override (non-persistent)
   * @param {string} key - Configuration key
   * @param {*} value - New value
   * @returns {Object} - { success: boolean, error?: string, restartRequired?: boolean }
   */
  setOverride(key, value) {
    this._ensureInitialized();

    const config = this._config.get(key);
    if (!config) {
      return { success: false, error: `Unknown configuration: ${key}` };
    }

    // Validate the new value
    const validation = validateValue(value, config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const previousValue = this.get(key);
    this._overrides.set(key, value);

    log.info(`Configuration override set: ${key}`, {
      previousValue: config.sensitive ? '***' : previousValue,
      newValue: config.sensitive ? '***' : value,
    });

    trackEvent('configuration_override', {
      key,
      previousValue: config.sensitive ? '***' : previousValue,
      newValue: config.sensitive ? '***' : value,
    });

    // Notify listeners
    this._notifyListeners(key, value, previousValue);

    return {
      success: true,
      restartRequired: config.restartRequired || false,
    };
  }

  /**
   * Clear a runtime override
   * @param {string} key - Configuration key
   */
  clearOverride(key) {
    this._ensureInitialized();

    if (this._overrides.has(key)) {
      const previousValue = this.get(key);
      this._overrides.delete(key);
      const newValue = this.get(key);

      log.info(`Configuration override cleared: ${key}`, {
        previousValue,
        newValue,
      });

      this._notifyListeners(key, newValue, previousValue);
    }
  }

  /**
   * Clear all runtime overrides
   */
  clearAllOverrides() {
    this._ensureInitialized();

    const cleared = Array.from(this._overrides.keys());
    this._overrides.clear();

    log.info(`All configuration overrides cleared: ${cleared.length} configs`);
  }

  /**
   * Register a listener for configuration changes
   * @param {string} key - Configuration key to listen to
   * @param {Function} callback - Callback(newValue, previousValue)
   * @returns {Function} - Unsubscribe function
   */
  onChange(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);

    return () => {
      const listeners = this._listeners.get(key);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * Get summary statistics
   * @returns {Object}
   */
  getStatistics() {
    this._ensureInitialized();

    const stats = {
      total: this._config.size,
      bySource: {
        default: 0,
        environment: 0,
        override: 0,
      },
      byCategory: {},
      byType: {},
      overrides: this._overrides.size,
      validationErrors: this._validationErrors.length,
      initializationTime: this._initializationTime,
    };

    for (const category of Object.values(CONFIG_CATEGORIES)) {
      stats.byCategory[category] = 0;
    }

    for (const type of Object.values(CONFIG_TYPES)) {
      stats.byType[type] = 0;
    }

    for (const [key, config] of this._config) {
      const source = this._overrides.has(key) ? 'override' : config.source;
      stats.bySource[source]++;

      if (config.category) {
        stats.byCategory[config.category]++;
      }

      if (config.type) {
        stats.byType[config.type]++;
      }
    }

    return stats;
  }

  /**
   * Get validation errors from initialization
   * @returns {Object[]}
   */
  getValidationErrors() {
    return [...this._validationErrors];
  }

  /**
   * Get all available categories
   * @returns {string[]}
   */
  getCategories() {
    return Object.values(CONFIG_CATEGORIES);
  }

  /**
   * Check if a configuration exists
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    this._ensureInitialized();
    return this._config.has(key);
  }

  /**
   * Validate all current configuration values
   * @returns {Object} - { valid: boolean, errors: Object[] }
   */
  validate() {
    this._ensureInitialized();

    const errors = [];
    for (const [key, config] of this._config) {
      const value = this.get(key);
      const validation = validateValue(value, config);
      if (!validation.valid) {
        errors.push({
          key,
          error: validation.error,
          value,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Export configuration (for debugging/documentation)
   * @param {boolean} includeValues - Include actual values (default: false for security)
   * @returns {Object}
   */
  export(includeValues = false) {
    this._ensureInitialized();

    const exported = {};
    for (const [key, config] of this._config) {
      exported[key] = {
        description: config.description,
        category: config.category,
        type: config.type,
        default: config.sensitive ? '***' : config.default,
        envVar: config.envVar,
        min: config.min,
        max: config.max,
        options: config.options,
        unit: config.unit,
        restartRequired: config.restartRequired || false,
      };

      if (includeValues && !config.sensitive) {
        exported[key].currentValue = this.get(key);
        exported[key].source = this._overrides.has(key) ? 'override' : config.source;
      }
    }

    return exported;
  }

  /**
   * Notify registered listeners of configuration changes
   * @private
   */
  _notifyListeners(key, newValue, previousValue) {
    const listeners = this._listeners.get(key);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(newValue, previousValue);
        } catch (error) {
          log.error(`Error in configuration listener for ${key}:`, error);
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
    this._config.clear();
    this._overrides.clear();
    this._listeners.clear();
    this._initialized = false;
    this._initializationTime = null;
    this._validationErrors = [];
  }
}

// Singleton instance
let instance = null;

/**
 * Get the configuration service instance
 * @returns {ConfigurationService}
 */
function getConfigurationService() {
  if (!instance) {
    instance = new ConfigurationService();
    instance.initialize();
  }
  return instance;
}

/**
 * Convenience function to get a configuration value
 * @param {string} key - Configuration key
 * @returns {*}
 */
function getConfig(key) {
  return getConfigurationService().get(key);
}

module.exports = {
  ConfigurationService,
  getConfigurationService,
  getConfig,
  CONFIG_CATEGORIES,
  CONFIG_TYPES,
  CONFIG_DEFINITIONS,
};
