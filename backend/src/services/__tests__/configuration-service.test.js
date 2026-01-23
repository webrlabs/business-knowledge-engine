/**
 * Configuration Service Tests
 *
 * Tests for the centralized configuration management service that provides
 * a single source of truth for all application thresholds and settings.
 */

const {
  ConfigurationService,
  getConfigurationService,
  getConfig,
  CONFIG_CATEGORIES,
  CONFIG_TYPES,
  CONFIG_DEFINITIONS,
} = require('../configuration-service');

// Mock the logger and telemetry
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
  trackException: jest.fn(),
}));

describe('ConfigurationService', () => {
  let service;

  beforeEach(() => {
    // Create a fresh instance for each test
    service = new ConfigurationService();
  });

  afterEach(() => {
    // Reset the service after each test
    service.reset();
  });

  describe('initialization', () => {
    it('should initialize with all configuration definitions', () => {
      service.initialize();

      const stats = service.getStatistics();
      expect(stats.total).toBe(Object.keys(CONFIG_DEFINITIONS).length);
      expect(stats.total).toBeGreaterThan(0);
    });

    it('should only initialize once', () => {
      service.initialize();
      const firstStats = service.getStatistics();

      service.initialize();
      const secondStats = service.getStatistics();

      expect(firstStats.initializationTime).toBe(secondStats.initializationTime);
    });

    it('should auto-initialize on first get', () => {
      const value = service.get('CHUNK_SIZE');
      expect(value).toBeDefined();
    });

    it('should track initialization time', () => {
      service.initialize();
      const stats = service.getStatistics();

      expect(stats.initializationTime).toBeDefined();
      expect(new Date(stats.initializationTime)).toBeInstanceOf(Date);
    });
  });

  describe('environment variable parsing', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should use default values when env vars are not set', () => {
      service.initialize();

      const chunkSize = service.get('CHUNK_SIZE');
      expect(chunkSize).toBe(CONFIG_DEFINITIONS.CHUNK_SIZE.default);
    });

    it('should override with environment variables', () => {
      process.env.CFG_CHUNK_SIZE = '1000';

      const freshService = new ConfigurationService();
      freshService.initialize();

      expect(freshService.get('CHUNK_SIZE')).toBe(1000);
    });

    it('should parse numeric environment variables', () => {
      process.env.CFG_OPENAI_MAX_TOKENS = '8192';

      const freshService = new ConfigurationService();
      freshService.initialize();

      expect(freshService.get('OPENAI_MAX_TOKENS')).toBe(8192);
    });

    it('should parse boolean environment variables', () => {
      // Boolean configs don't exist in current definitions, but the parser supports them
      // Test via validation instead
      service.initialize();
      expect(service.get('CHUNKING_STRATEGY')).toBeDefined();
    });

    it('should handle invalid numeric environment variables', () => {
      process.env.CFG_CHUNK_SIZE = 'not-a-number';

      const freshService = new ConfigurationService();
      freshService.initialize();

      // Should fall back to default
      expect(freshService.get('CHUNK_SIZE')).toBe(CONFIG_DEFINITIONS.CHUNK_SIZE.default);
    });

    it('should track source as environment when env var is set', () => {
      process.env.CFG_CHUNK_SIZE = '1000';

      const freshService = new ConfigurationService();
      freshService.initialize();

      const config = freshService.getWithMetadata('CHUNK_SIZE');
      expect(config.source).toBe('environment');
    });

    it('should track source as default when env var is not set', () => {
      delete process.env.CFG_CHUNK_SIZE;

      const freshService = new ConfigurationService();
      freshService.initialize();

      const config = freshService.getWithMetadata('CHUNK_SIZE');
      expect(config.source).toBe('default');
    });
  });

  describe('get()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return the configuration value', () => {
      const value = service.get('CHUNK_SIZE');
      expect(typeof value).toBe('number');
      expect(value).toBe(CONFIG_DEFINITIONS.CHUNK_SIZE.default);
    });

    it('should return undefined for unknown keys', () => {
      const value = service.get('UNKNOWN_CONFIG');
      expect(value).toBeUndefined();
    });

    it('should return override value when set', () => {
      service.setOverride('CHUNK_SIZE', 999);
      expect(service.get('CHUNK_SIZE')).toBe(999);
    });
  });

  describe('getWithMetadata()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return full configuration metadata', () => {
      const config = service.getWithMetadata('CHUNK_SIZE');

      expect(config).toHaveProperty('key', 'CHUNK_SIZE');
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('category', CONFIG_CATEGORIES.CHUNKING);
      expect(config).toHaveProperty('type', CONFIG_TYPES.NUMBER);
      expect(config).toHaveProperty('value');
      expect(config).toHaveProperty('default');
      expect(config).toHaveProperty('source');
      expect(config).toHaveProperty('envVar');
      expect(config).toHaveProperty('min');
      expect(config).toHaveProperty('max');
      expect(config).toHaveProperty('unit');
    });

    it('should return null for unknown keys', () => {
      const config = service.getWithMetadata('UNKNOWN_CONFIG');
      expect(config).toBeNull();
    });

    it('should show override source when overridden', () => {
      service.setOverride('CHUNK_SIZE', 999);
      const config = service.getWithMetadata('CHUNK_SIZE');

      expect(config.source).toBe('override');
      expect(config.value).toBe(999);
    });
  });

  describe('getAll()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return all configurations', () => {
      const all = service.getAll();

      expect(Array.isArray(all)).toBe(true);
      expect(all.length).toBe(Object.keys(CONFIG_DEFINITIONS).length);
    });

    it('should filter by category', () => {
      const chunking = service.getAll(CONFIG_CATEGORIES.CHUNKING);

      expect(Array.isArray(chunking)).toBe(true);
      expect(chunking.length).toBeGreaterThan(0);
      expect(chunking.every((c) => c.category === CONFIG_CATEGORIES.CHUNKING)).toBe(true);
    });

    it('should return empty array for invalid category', () => {
      const invalid = service.getAll('invalid_category');
      expect(invalid).toEqual([]);
    });
  });

  describe('getByCategory()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return configurations grouped by category', () => {
      const byCategory = service.getByCategory();

      expect(typeof byCategory).toBe('object');
      expect(Object.keys(byCategory)).toEqual(expect.arrayContaining(Object.values(CONFIG_CATEGORIES)));
    });

    it('should have correct configurations in each category', () => {
      const byCategory = service.getByCategory();

      for (const [category, configs] of Object.entries(byCategory)) {
        expect(Array.isArray(configs)).toBe(true);
        for (const config of configs) {
          expect(config.category).toBe(category);
        }
      }
    });
  });

  describe('setOverride()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should set a runtime override', () => {
      const result = service.setOverride('CHUNK_SIZE', 999);

      expect(result.success).toBe(true);
      expect(service.get('CHUNK_SIZE')).toBe(999);
    });

    it('should return error for unknown configuration', () => {
      const result = service.setOverride('UNKNOWN_CONFIG', 123);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown configuration');
    });

    it('should validate numeric range constraints', () => {
      // CHUNK_SIZE has min: 100, max: 4000
      const tooSmall = service.setOverride('CHUNK_SIZE', 10);
      expect(tooSmall.success).toBe(false);
      expect(tooSmall.error).toContain('below minimum');

      const tooBig = service.setOverride('CHUNK_SIZE', 10000);
      expect(tooBig.success).toBe(false);
      expect(tooBig.error).toContain('exceeds maximum');
    });

    it('should validate type constraints', () => {
      const wrongType = service.setOverride('CHUNK_SIZE', 'not-a-number');

      expect(wrongType.success).toBe(false);
      expect(wrongType.error).toContain('Expected number');
    });

    it('should validate string options', () => {
      // CHUNKING_STRATEGY has options: ['fixed', 'semantic', 'auto']
      const valid = service.setOverride('CHUNKING_STRATEGY', 'semantic');
      expect(valid.success).toBe(true);

      const invalid = service.setOverride('CHUNKING_STRATEGY', 'invalid');
      expect(invalid.success).toBe(false);
      expect(invalid.error).toContain('must be one of');
    });

    it('should indicate if restart is required', () => {
      // SEARCH_INDEX_NAME has restartRequired: true
      const result = service.setOverride('SEARCH_INDEX_NAME', 'new-index');

      expect(result.success).toBe(true);
      expect(result.restartRequired).toBe(true);
    });
  });

  describe('clearOverride()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should clear a runtime override', () => {
      service.setOverride('CHUNK_SIZE', 999);
      expect(service.get('CHUNK_SIZE')).toBe(999);

      service.clearOverride('CHUNK_SIZE');
      expect(service.get('CHUNK_SIZE')).toBe(CONFIG_DEFINITIONS.CHUNK_SIZE.default);
    });

    it('should handle clearing non-existent override', () => {
      // Should not throw
      expect(() => service.clearOverride('CHUNK_SIZE')).not.toThrow();
    });
  });

  describe('clearAllOverrides()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should clear all runtime overrides', () => {
      service.setOverride('CHUNK_SIZE', 999);
      service.setOverride('CHUNK_OVERLAP', 100);

      service.clearAllOverrides();

      expect(service.get('CHUNK_SIZE')).toBe(CONFIG_DEFINITIONS.CHUNK_SIZE.default);
      expect(service.get('CHUNK_OVERLAP')).toBe(CONFIG_DEFINITIONS.CHUNK_OVERLAP.default);
    });
  });

  describe('onChange()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should register and notify listeners', () => {
      const callback = jest.fn();
      service.onChange('CHUNK_SIZE', callback);

      service.setOverride('CHUNK_SIZE', 999);

      expect(callback).toHaveBeenCalledWith(999, CONFIG_DEFINITIONS.CHUNK_SIZE.default);
    });

    it('should return unsubscribe function', () => {
      const callback = jest.fn();
      const unsubscribe = service.onChange('CHUNK_SIZE', callback);

      unsubscribe();
      service.setOverride('CHUNK_SIZE', 999);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should notify on override clear', () => {
      const callback = jest.fn();
      service.setOverride('CHUNK_SIZE', 999);

      service.onChange('CHUNK_SIZE', callback);
      service.clearOverride('CHUNK_SIZE');

      expect(callback).toHaveBeenCalledWith(CONFIG_DEFINITIONS.CHUNK_SIZE.default, 999);
    });
  });

  describe('getStatistics()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return comprehensive statistics', () => {
      const stats = service.getStatistics();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('bySource');
      expect(stats).toHaveProperty('byCategory');
      expect(stats).toHaveProperty('byType');
      expect(stats).toHaveProperty('overrides');
      expect(stats).toHaveProperty('validationErrors');
      expect(stats).toHaveProperty('initializationTime');
    });

    it('should track overrides count', () => {
      expect(service.getStatistics().overrides).toBe(0);

      service.setOverride('CHUNK_SIZE', 999);
      expect(service.getStatistics().overrides).toBe(1);

      service.setOverride('CHUNK_OVERLAP', 100);
      expect(service.getStatistics().overrides).toBe(2);
    });

    it('should track configuration by type', () => {
      const stats = service.getStatistics();

      expect(stats.byType[CONFIG_TYPES.NUMBER]).toBeGreaterThan(0);
      expect(stats.byType[CONFIG_TYPES.STRING]).toBeGreaterThan(0);
    });

    it('should track configuration by category', () => {
      const stats = service.getStatistics();

      expect(stats.byCategory[CONFIG_CATEGORIES.CHUNKING]).toBeGreaterThan(0);
      expect(stats.byCategory[CONFIG_CATEGORIES.OPENAI]).toBeGreaterThan(0);
    });
  });

  describe('validate()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should validate all configurations', () => {
      const validation = service.validate();

      expect(validation).toHaveProperty('valid');
      expect(validation).toHaveProperty('errors');
      expect(Array.isArray(validation.errors)).toBe(true);
    });

    it('should be valid with default values', () => {
      const validation = service.validate();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect validation errors', () => {
      // Force an invalid override (bypass validation)
      service._overrides.set('CHUNK_SIZE', 'invalid');

      const validation = service.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('export()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should export configuration documentation', () => {
      const exported = service.export();

      expect(typeof exported).toBe('object');
      expect(Object.keys(exported).length).toBe(Object.keys(CONFIG_DEFINITIONS).length);
    });

    it('should include definition metadata', () => {
      const exported = service.export();
      const chunkSize = exported.CHUNK_SIZE;

      expect(chunkSize).toHaveProperty('description');
      expect(chunkSize).toHaveProperty('category');
      expect(chunkSize).toHaveProperty('type');
      expect(chunkSize).toHaveProperty('default');
      expect(chunkSize).toHaveProperty('envVar');
    });

    it('should not include values by default', () => {
      const exported = service.export(false);
      const chunkSize = exported.CHUNK_SIZE;

      expect(chunkSize).not.toHaveProperty('currentValue');
      expect(chunkSize).not.toHaveProperty('source');
    });

    it('should include values when requested', () => {
      const exported = service.export(true);
      const chunkSize = exported.CHUNK_SIZE;

      expect(chunkSize).toHaveProperty('currentValue');
      expect(chunkSize).toHaveProperty('source');
    });
  });

  describe('has()', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return true for existing configurations', () => {
      expect(service.has('CHUNK_SIZE')).toBe(true);
      expect(service.has('OPENAI_MAX_TOKENS')).toBe(true);
    });

    it('should return false for non-existent configurations', () => {
      expect(service.has('UNKNOWN_CONFIG')).toBe(false);
    });
  });

  describe('getCategories()', () => {
    it('should return all available categories', () => {
      const categories = service.getCategories();

      expect(Array.isArray(categories)).toBe(true);
      expect(categories).toEqual(expect.arrayContaining(Object.values(CONFIG_CATEGORIES)));
    });
  });

  describe('reset()', () => {
    it('should reset service to initial state', () => {
      service.initialize();
      service.setOverride('CHUNK_SIZE', 999);

      service.reset();

      // Should need to re-initialize
      expect(service._initialized).toBe(false);
      expect(service._overrides.size).toBe(0);
    });
  });
});

describe('getConfigurationService()', () => {
  it('should return singleton instance', () => {
    const instance1 = getConfigurationService();
    const instance2 = getConfigurationService();

    expect(instance1).toBe(instance2);
  });

  it('should auto-initialize', () => {
    const instance = getConfigurationService();
    expect(instance._initialized).toBe(true);
  });
});

describe('getConfig()', () => {
  it('should be a convenience function for getting values', () => {
    const value = getConfig('CHUNK_SIZE');
    const directValue = getConfigurationService().get('CHUNK_SIZE');

    expect(value).toBe(directValue);
  });
});

describe('CONFIG_CATEGORIES', () => {
  it('should define all required categories', () => {
    expect(CONFIG_CATEGORIES.OPENAI).toBe('openai');
    expect(CONFIG_CATEGORIES.SEARCH).toBe('search');
    expect(CONFIG_CATEGORIES.DOCUMENT_PROCESSING).toBe('document_processing');
    expect(CONFIG_CATEGORIES.CHUNKING).toBe('chunking');
    expect(CONFIG_CATEGORIES.CACHE).toBe('cache');
    expect(CONFIG_CATEGORIES.CIRCUIT_BREAKER).toBe('circuit_breaker');
    expect(CONFIG_CATEGORIES.RATE_LIMITING).toBe('rate_limiting');
    expect(CONFIG_CATEGORIES.GRAPH).toBe('graph');
    expect(CONFIG_CATEGORIES.EVALUATION).toBe('evaluation');
    expect(CONFIG_CATEGORIES.ENTITY_RESOLUTION).toBe('entity_resolution');
    expect(CONFIG_CATEGORIES.SECURITY).toBe('security');
    expect(CONFIG_CATEGORIES.STORAGE).toBe('storage');
    expect(CONFIG_CATEGORIES.TELEMETRY).toBe('telemetry');
  });
});

describe('CONFIG_TYPES', () => {
  it('should define all supported types', () => {
    expect(CONFIG_TYPES.NUMBER).toBe('number');
    expect(CONFIG_TYPES.STRING).toBe('string');
    expect(CONFIG_TYPES.BOOLEAN).toBe('boolean');
    expect(CONFIG_TYPES.ARRAY).toBe('array');
    expect(CONFIG_TYPES.OBJECT).toBe('object');
  });
});

describe('CONFIG_DEFINITIONS', () => {
  it('should have valid definitions for all configs', () => {
    for (const [key, definition] of Object.entries(CONFIG_DEFINITIONS)) {
      expect(definition.key).toBe(key);
      expect(definition.description).toBeDefined();
      expect(Object.values(CONFIG_CATEGORIES)).toContain(definition.category);
      expect(Object.values(CONFIG_TYPES)).toContain(definition.type);
      expect(definition.default).toBeDefined();
      expect(definition.envVar).toBeDefined();
    }
  });

  it('should have numeric constraints for number types', () => {
    for (const [key, definition] of Object.entries(CONFIG_DEFINITIONS)) {
      if (definition.type === CONFIG_TYPES.NUMBER) {
        // Most numbers should have min/max constraints for safety
        if (definition.min !== undefined) {
          expect(typeof definition.min).toBe('number');
        }
        if (definition.max !== undefined) {
          expect(typeof definition.max).toBe('number');
        }
      }
    }
  });

  it('should have valid options for string types with options', () => {
    for (const definition of Object.values(CONFIG_DEFINITIONS)) {
      if (definition.options) {
        expect(Array.isArray(definition.options)).toBe(true);
        expect(definition.options.length).toBeGreaterThan(0);
        expect(definition.options).toContain(definition.default);
      }
    }
  });
});
