/**
 * Environment Variable Validator
 *
 * Validates required environment variables at startup and provides
 * clear error messages when configuration is missing or invalid.
 */

const { log } = require('./logger');

/**
 * Environment variable configuration
 * Groups variables by service with validation rules
 */
const envConfig = {
  // Core application settings (optional with defaults)
  app: {
    required: [],
    optional: [
      { name: 'NODE_ENV', default: 'development' },
      { name: 'PORT', default: '8080', validate: isValidPort },
      { name: 'API_PORT', default: '8080', validate: isValidPort },
      { name: 'LOG_LEVEL', default: 'info', validate: isValidLogLevel },
    ],
  },

  // Azure AD / Entra ID Authentication
  auth: {
    required: [
      { name: 'AZURE_AD_TENANT_ID', description: 'Azure AD Tenant (Directory) ID' },
      { name: 'AZURE_AD_CLIENT_ID', description: 'Backend API Client ID' },
      { name: 'AZURE_AD_AUDIENCE', description: 'API Audience URI (e.g., api://client-id)' },
    ],
    optional: [],
  },

  // Azure OpenAI
  openai: {
    required: [
      { name: 'AZURE_OPENAI_ENDPOINT', description: 'OpenAI endpoint URL', validate: isValidUrl },
      { name: 'AZURE_OPENAI_DEPLOYMENT_NAME', description: 'Chat model deployment name' },
      { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT', description: 'Embedding model deployment name' },
    ],
    optional: [
      { name: 'AZURE_OPENAI_API_VERSION', default: '2024-02-15-preview' },
    ],
  },

  // Azure Document Intelligence
  documentIntelligence: {
    required: [
      { name: 'AZURE_FORM_RECOGNIZER_ENDPOINT', description: 'Document Intelligence endpoint', validate: isValidUrl },
    ],
    optional: [],
  },

  // Azure AI Search
  search: {
    required: [
      { name: 'AZURE_SEARCH_ENDPOINT', description: 'AI Search endpoint', validate: isValidUrl },
      { name: 'AZURE_SEARCH_INDEX_NAME', description: 'Search index name' },
    ],
    optional: [],
  },

  // Azure Cosmos DB (SQL API)
  cosmos: {
    required: [
      { name: 'COSMOS_DB_ENDPOINT', description: 'Cosmos DB endpoint', validate: isValidUrl },
    ],
    optional: [
      { name: 'COSMOS_DB_DATABASE', default: 'knowledge-platform' },
      { name: 'COSMOS_DB_DOCUMENTS_CONTAINER', default: 'documents' },
      { name: 'COSMOS_DB_AUDIT_CONTAINER', default: 'audit-logs' },
      { name: 'COSMOS_DB_KEY', description: 'Optional: primary key (if not using Entra ID)' },
    ],
  },

  // Azure Cosmos DB (Gremlin API)
  gremlin: {
    required: [
      { name: 'COSMOS_GREMLIN_ENDPOINT', description: 'Gremlin WebSocket endpoint', validate: isValidWssUrl },
    ],
    optional: [
      { name: 'COSMOS_GREMLIN_DATABASE', default: 'knowledge-graph' },
      { name: 'COSMOS_GREMLIN_GRAPH', default: 'entities' },
    ],
  },

  // Azure Blob Storage
  storage: {
    required: [
      { name: 'AZURE_STORAGE_ACCOUNT_NAME', description: 'Storage account name' },
    ],
    optional: [
      { name: 'AZURE_STORAGE_CONTAINER_DOCUMENTS', default: 'documents' },
      { name: 'AZURE_STORAGE_CONNECTION_STRING', description: 'Optional: connection string (if not using Entra ID)' },
    ],
  },

  // Telemetry (optional)
  telemetry: {
    required: [],
    optional: [
      { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', description: 'Application Insights instrumentation key' },
      { name: 'APPINSIGHTS_CLOUD_ROLE', default: 'knowledge-platform-backend' },
    ],
  },
};

/**
 * Validation helper functions
 */
function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isValidWssUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' || url.protocol === 'ws:';
  } catch {
    return false;
  }
}

function isValidPort(value) {
  const port = parseInt(value, 10);
  return !isNaN(port) && port > 0 && port <= 65535;
}

function isValidLogLevel(value) {
  return ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].includes(value);
}

/**
 * Check if a value is a placeholder
 */
function isPlaceholder(value) {
  if (!value) return true;
  const placeholders = [
    'your-',
    'REPLACE_',
    'TODO',
    'CHANGEME',
    'xxx',
    'placeholder',
    '<',
    '>',
  ];
  const lowerValue = value.toLowerCase();
  return placeholders.some((p) => lowerValue.includes(p.toLowerCase()));
}

/**
 * Validate all environment variables
 * @param {Object} options - Validation options
 * @param {boolean} options.strict - If true, fail on any missing required variable
 * @param {boolean} options.logWarnings - If true, log warnings for optional variables
 * @returns {Object} - { valid: boolean, errors: string[], warnings: string[] }
 */
function validateEnvironment(options = {}) {
  const { strict = true, logWarnings = true } = options;
  const errors = [];
  const warnings = [];
  const validatedValues = {};

  for (const [serviceName, config] of Object.entries(envConfig)) {
    // Check required variables
    for (const variable of config.required) {
      const value = process.env[variable.name];

      if (!value) {
        errors.push(`Missing required variable: ${variable.name} (${variable.description})`);
      } else if (isPlaceholder(value)) {
        errors.push(`Placeholder value for: ${variable.name} - please set a real value`);
      } else if (variable.validate && !variable.validate(value)) {
        errors.push(`Invalid value for ${variable.name}: "${value}" - ${variable.description}`);
      } else {
        validatedValues[variable.name] = value;
      }
    }

    // Check optional variables
    for (const variable of config.optional) {
      const value = process.env[variable.name];

      if (!value && variable.default) {
        // Apply default
        process.env[variable.name] = variable.default;
        validatedValues[variable.name] = variable.default;
      } else if (value && isPlaceholder(value)) {
        warnings.push(`Placeholder value for optional: ${variable.name}`);
      } else if (value && variable.validate && !variable.validate(value)) {
        warnings.push(`Invalid value for optional ${variable.name}: "${value}"`);
      } else if (value) {
        validatedValues[variable.name] = value;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    values: validatedValues,
  };
}

/**
 * Validate environment and handle errors
 * Call this at application startup
 * @param {Object} options - Validation options
 * @returns {boolean} - True if validation passed
 */
function validateAndReport(options = {}) {
  const { exitOnError = true, logWarnings = true } = options;
  const result = validateEnvironment({ logWarnings });

  // Log warnings
  if (logWarnings && result.warnings.length > 0) {
    log.warn('Environment configuration warnings:', {
      warnings: result.warnings,
    });
  }

  // Handle errors
  if (!result.valid) {
    log.error('Environment configuration errors:', {
      errors: result.errors,
    });

    if (exitOnError) {
      log.error('Application startup aborted due to configuration errors.');
      log.info('Please check your .env file or environment variables.');
      log.info('See .env.example for required variables and their descriptions.');
      process.exit(1);
    }
  } else {
    log.info('Environment configuration validated successfully');
  }

  return result.valid;
}

/**
 * Get a summary of configured services
 * @returns {Object} - Object with service names and their configuration status
 */
function getConfigurationSummary() {
  const summary = {};

  for (const [serviceName, config] of Object.entries(envConfig)) {
    const requiredCount = config.required.length;
    const configuredRequired = config.required.filter(
      (v) => process.env[v.name] && !isPlaceholder(process.env[v.name])
    ).length;

    summary[serviceName] = {
      status: configuredRequired === requiredCount ? 'configured' : 'missing',
      required: requiredCount,
      configured: configuredRequired,
    };
  }

  return summary;
}

/**
 * Check if a specific service is configured
 * @param {string} serviceName - Name of the service to check
 * @returns {boolean} - True if all required variables are configured
 */
function isServiceConfigured(serviceName) {
  const config = envConfig[serviceName];
  if (!config) return false;

  return config.required.every(
    (v) => process.env[v.name] && !isPlaceholder(process.env[v.name])
  );
}

module.exports = {
  validateEnvironment,
  validateAndReport,
  getConfigurationSummary,
  isServiceConfigured,
  envConfig,
};
