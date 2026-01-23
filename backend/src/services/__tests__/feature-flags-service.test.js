/**
 * Feature Flags Service Tests
 *
 * Tests for the centralized feature flag management system.
 */

const {
  FeatureFlagsService,
  getFeatureFlags,
  isFeatureEnabled,
  FLAG_CATEGORIES,
  FLAG_DEFINITIONS,
} = require('../feature-flags-service');

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

describe('FeatureFlagsService', () => {
  let service;

  beforeEach(() => {
    // Create a fresh instance for each test
    service = new FeatureFlagsService();
  });

  afterEach(() => {
    // Reset the service after each test
    service.reset();
  });

  describe('FLAG_CATEGORIES', () => {
    it('should define all expected categories', () => {
      expect(FLAG_CATEGORIES).toHaveProperty('SECURITY');
      expect(FLAG_CATEGORIES).toHaveProperty('PERFORMANCE');
      expect(FLAG_CATEGORIES).toHaveProperty('INGESTION');
      expect(FLAG_CATEGORIES).toHaveProperty('GRAPHRAG');
      expect(FLAG_CATEGORIES).toHaveProperty('EVALUATION');
      expect(FLAG_CATEGORIES).toHaveProperty('UI');
      expect(FLAG_CATEGORIES).toHaveProperty('EXPERIMENTAL');
    });
  });

  describe('FLAG_DEFINITIONS', () => {
    it('should have required properties for each flag', () => {
      for (const [key, def] of Object.entries(FLAG_DEFINITIONS)) {
        expect(def).toHaveProperty('key');
        expect(def).toHaveProperty('description');
        expect(def).toHaveProperty('category');
        expect(def).toHaveProperty('default');
        expect(def).toHaveProperty('envVar');
        expect(def.key).toBe(key);
      }
    });

    it('should have unique environment variable names', () => {
      const envVars = Object.values(FLAG_DEFINITIONS).map((d) => d.envVar);
      const uniqueEnvVars = new Set(envVars);
      expect(uniqueEnvVars.size).toBe(envVars.length);
    });

    it('should have valid categories', () => {
      const validCategories = Object.values(FLAG_CATEGORIES);
      for (const def of Object.values(FLAG_DEFINITIONS)) {
        expect(validCategories).toContain(def.category);
      }
    });
  });

  describe('initialize', () => {
    it('should initialize with default values when no env vars set', () => {
      service.initialize();

      expect(service._initialized).toBe(true);
      expect(service._flags.size).toBeGreaterThan(0);
    });

    it('should only initialize once', () => {
      service.initialize();
      const firstSize = service._flags.size;

      service.initialize();
      expect(service._flags.size).toBe(firstSize);
    });

    it('should read values from environment variables', () => {
      const originalEnv = process.env.CIRCUIT_BREAKER_ENABLED;
      process.env.CIRCUIT_BREAKER_ENABLED = 'false';

      service.initialize();
      expect(service.isEnabled('CIRCUIT_BREAKER')).toBe(false);

      process.env.CIRCUIT_BREAKER_ENABLED = originalEnv;
    });

    it('should set source to environment when env var is set', () => {
      const originalEnv = process.env.FF_SEMANTIC_CHUNKING;
      process.env.FF_SEMANTIC_CHUNKING = 'true';

      service.initialize();
      const flag = service.getFlag('SEMANTIC_CHUNKING');
      expect(flag.source).toBe('environment');

      process.env.FF_SEMANTIC_CHUNKING = originalEnv;
    });

    it('should set source to default when no env var is set', () => {
      delete process.env.FF_SEMANTIC_CHUNKING;

      service.initialize();
      const flag = service.getFlag('SEMANTIC_CHUNKING');
      expect(flag.source).toBe('default');
    });
  });

  describe('isEnabled', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return the flag value', () => {
      // CIRCUIT_BREAKER defaults to true
      expect(service.isEnabled('CIRCUIT_BREAKER')).toBe(true);
    });

    it('should return false for unknown flags', () => {
      expect(service.isEnabled('UNKNOWN_FLAG')).toBe(false);
    });

    it('should auto-initialize if not initialized', () => {
      const newService = new FeatureFlagsService();
      expect(newService._initialized).toBe(false);
      newService.isEnabled('CIRCUIT_BREAKER');
      expect(newService._initialized).toBe(true);
    });

    it('should respect runtime overrides', () => {
      expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(false); // default
      service.setOverride('SEMANTIC_CHUNKING', true);
      expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(true);
    });
  });

  describe('getFlags', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return all flags when no category specified', () => {
      const flags = service.getFlags();
      expect(flags.length).toBe(Object.keys(FLAG_DEFINITIONS).length);
    });

    it('should filter by category', () => {
      const securityFlags = service.getFlags(FLAG_CATEGORIES.SECURITY);
      expect(securityFlags.length).toBeGreaterThan(0);
      for (const flag of securityFlags) {
        expect(flag.category).toBe(FLAG_CATEGORIES.SECURITY);
      }
    });

    it('should include all required properties', () => {
      const flags = service.getFlags();
      for (const flag of flags) {
        expect(flag).toHaveProperty('key');
        expect(flag).toHaveProperty('description');
        expect(flag).toHaveProperty('category');
        expect(flag).toHaveProperty('enabled');
        expect(flag).toHaveProperty('default');
        expect(flag).toHaveProperty('source');
        expect(flag).toHaveProperty('envVar');
      }
    });
  });

  describe('getFlag', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return flag details for existing flag', () => {
      const flag = service.getFlag('CIRCUIT_BREAKER');
      expect(flag).not.toBeNull();
      expect(flag.key).toBe('CIRCUIT_BREAKER');
      expect(flag.category).toBe(FLAG_CATEGORIES.SECURITY);
    });

    it('should return null for unknown flag', () => {
      const flag = service.getFlag('UNKNOWN_FLAG');
      expect(flag).toBeNull();
    });
  });

  describe('getFlagsByCategory', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return flags organized by category', () => {
      const byCategory = service.getFlagsByCategory();

      for (const category of Object.values(FLAG_CATEGORIES)) {
        expect(byCategory).toHaveProperty(category);
        expect(Array.isArray(byCategory[category])).toBe(true);
      }
    });

    it('should have consistent results with getFlags', () => {
      const byCategory = service.getFlagsByCategory();
      const securityDirect = service.getFlags(FLAG_CATEGORIES.SECURITY);

      expect(byCategory[FLAG_CATEGORIES.SECURITY]).toEqual(securityDirect);
    });
  });

  describe('setOverride', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should override a flag value', () => {
      const original = service.isEnabled('SEMANTIC_CHUNKING');
      service.setOverride('SEMANTIC_CHUNKING', !original);
      expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(!original);
    });

    it('should throw for unknown flag', () => {
      expect(() => service.setOverride('UNKNOWN_FLAG', true)).toThrow('Unknown feature flag');
    });

    it('should update source to override', () => {
      service.setOverride('SEMANTIC_CHUNKING', true);
      const flag = service.getFlag('SEMANTIC_CHUNKING');
      expect(flag.source).toBe('override');
    });
  });

  describe('clearOverride', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should clear an override and revert to original value', () => {
      const original = service.isEnabled('SEMANTIC_CHUNKING');
      service.setOverride('SEMANTIC_CHUNKING', !original);
      expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(!original);

      service.clearOverride('SEMANTIC_CHUNKING');
      expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(original);
    });

    it('should do nothing for non-overridden flags', () => {
      const original = service.isEnabled('CIRCUIT_BREAKER');
      service.clearOverride('CIRCUIT_BREAKER');
      expect(service.isEnabled('CIRCUIT_BREAKER')).toBe(original);
    });
  });

  describe('clearAllOverrides', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should clear all overrides', () => {
      service.setOverride('SEMANTIC_CHUNKING', true);
      service.setOverride('LAZY_GRAPHRAG', true);

      expect(service._overrides.size).toBe(2);

      service.clearAllOverrides();

      expect(service._overrides.size).toBe(0);
    });
  });

  describe('onFlagChange', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should register a listener and call it on change', () => {
      const callback = jest.fn();
      service.onFlagChange('SEMANTIC_CHUNKING', callback);

      service.setOverride('SEMANTIC_CHUNKING', true);

      expect(callback).toHaveBeenCalledWith(true, false);
    });

    it('should return an unsubscribe function', () => {
      const callback = jest.fn();
      const unsubscribe = service.onFlagChange('SEMANTIC_CHUNKING', callback);

      unsubscribe();
      service.setOverride('SEMANTIC_CHUNKING', true);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should support multiple listeners', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onFlagChange('SEMANTIC_CHUNKING', callback1);
      service.onFlagChange('SEMANTIC_CHUNKING', callback2);

      service.setOverride('SEMANTIC_CHUNKING', true);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('getStatistics', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return valid statistics', () => {
      const stats = service.getStatistics();

      expect(stats.total).toBe(Object.keys(FLAG_DEFINITIONS).length);
      expect(stats.enabled + stats.disabled).toBe(stats.total);
      expect(stats.bySource.default + stats.bySource.environment + stats.bySource.override).toBe(
        stats.total
      );
    });

    it('should track overrides', () => {
      const statsBefore = service.getStatistics();
      expect(statsBefore.overrides).toBe(0);

      service.setOverride('SEMANTIC_CHUNKING', true);

      const statsAfter = service.getStatistics();
      expect(statsAfter.overrides).toBe(1);
    });

    it('should have byCategory stats', () => {
      const stats = service.getStatistics();

      for (const category of Object.values(FLAG_CATEGORIES)) {
        expect(stats.byCategory).toHaveProperty(category);
        expect(stats.byCategory[category]).toHaveProperty('total');
        expect(stats.byCategory[category]).toHaveProperty('enabled');
      }
    });
  });

  describe('getCategories', () => {
    it('should return all categories', () => {
      const categories = service.getCategories();
      expect(categories).toEqual(Object.values(FLAG_CATEGORIES));
    });
  });

  describe('hasFlag', () => {
    beforeEach(() => {
      service.initialize();
    });

    it('should return true for existing flags', () => {
      expect(service.hasFlag('CIRCUIT_BREAKER')).toBe(true);
      expect(service.hasFlag('SEMANTIC_CHUNKING')).toBe(true);
    });

    it('should return false for unknown flags', () => {
      expect(service.hasFlag('UNKNOWN_FLAG')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      service.initialize();
      service.setOverride('SEMANTIC_CHUNKING', true);

      service.reset();

      expect(service._initialized).toBe(false);
      expect(service._flags.size).toBe(0);
      expect(service._overrides.size).toBe(0);
      expect(service._listeners.size).toBe(0);
    });
  });
});

describe('getFeatureFlags (singleton)', () => {
  it('should return the same instance', () => {
    const instance1 = getFeatureFlags();
    const instance2 = getFeatureFlags();
    expect(instance1).toBe(instance2);
  });

  it('should be initialized', () => {
    const instance = getFeatureFlags();
    expect(instance._initialized).toBe(true);
  });
});

describe('isFeatureEnabled (convenience function)', () => {
  it('should check flag status', () => {
    const result = isFeatureEnabled('CIRCUIT_BREAKER');
    expect(typeof result).toBe('boolean');
  });
});

describe('Environment variable parsing', () => {
  let service;

  beforeEach(() => {
    service = new FeatureFlagsService();
  });

  afterEach(() => {
    service.reset();
    // Restore environment
    delete process.env.FF_TEST_FLAG;
  });

  const testCases = [
    { value: 'true', expected: true },
    { value: 'TRUE', expected: true },
    { value: 'True', expected: true },
    { value: '1', expected: true },
    { value: 'yes', expected: true },
    { value: 'YES', expected: true },
    { value: 'on', expected: true },
    { value: 'ON', expected: true },
    { value: 'false', expected: false },
    { value: 'FALSE', expected: false },
    { value: 'False', expected: false },
    { value: '0', expected: false },
    { value: 'no', expected: false },
    { value: 'NO', expected: false },
    { value: 'off', expected: false },
    { value: 'OFF', expected: false },
  ];

  // Test a sampling of the cases using a real flag
  it('should parse "true" correctly', () => {
    process.env.FF_SEMANTIC_CHUNKING = 'true';
    service.initialize();
    expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(true);
  });

  it('should parse "false" correctly', () => {
    process.env.CIRCUIT_BREAKER_ENABLED = 'false';
    service.initialize();
    expect(service.isEnabled('CIRCUIT_BREAKER')).toBe(false);
    delete process.env.CIRCUIT_BREAKER_ENABLED;
  });

  it('should parse "1" correctly', () => {
    process.env.FF_SEMANTIC_CHUNKING = '1';
    service.initialize();
    expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(true);
    delete process.env.FF_SEMANTIC_CHUNKING;
  });

  it('should parse "0" correctly', () => {
    process.env.CIRCUIT_BREAKER_ENABLED = '0';
    service.initialize();
    expect(service.isEnabled('CIRCUIT_BREAKER')).toBe(false);
    delete process.env.CIRCUIT_BREAKER_ENABLED;
  });

  it('should parse "yes" correctly', () => {
    process.env.FF_SEMANTIC_CHUNKING = 'yes';
    service.initialize();
    expect(service.isEnabled('SEMANTIC_CHUNKING')).toBe(true);
    delete process.env.FF_SEMANTIC_CHUNKING;
  });

  it('should parse "no" correctly', () => {
    process.env.CIRCUIT_BREAKER_ENABLED = 'no';
    service.initialize();
    expect(service.isEnabled('CIRCUIT_BREAKER')).toBe(false);
    delete process.env.CIRCUIT_BREAKER_ENABLED;
  });
});

describe('Security flags', () => {
  let service;

  beforeEach(() => {
    service = new FeatureFlagsService();
    service.initialize();
  });

  afterEach(() => {
    service.reset();
  });

  it('should have CIRCUIT_BREAKER flag', () => {
    expect(service.hasFlag('CIRCUIT_BREAKER')).toBe(true);
    const flag = service.getFlag('CIRCUIT_BREAKER');
    expect(flag.category).toBe(FLAG_CATEGORIES.SECURITY);
    expect(flag.default).toBe(true);
  });

  it('should have PROMPT_INJECTION_DETECTION flag', () => {
    expect(service.hasFlag('PROMPT_INJECTION_DETECTION')).toBe(true);
    const flag = service.getFlag('PROMPT_INJECTION_DETECTION');
    expect(flag.category).toBe(FLAG_CATEGORIES.SECURITY);
    expect(flag.default).toBe(true);
  });

  it('should have PII_REDACTION flag', () => {
    expect(service.hasFlag('PII_REDACTION')).toBe(true);
    const flag = service.getFlag('PII_REDACTION');
    expect(flag.category).toBe(FLAG_CATEGORIES.SECURITY);
    expect(flag.default).toBe(true);
  });
});

describe('Experimental flags', () => {
  let service;

  beforeEach(() => {
    service = new FeatureFlagsService();
    service.initialize();
  });

  afterEach(() => {
    service.reset();
  });

  it('should have experimental flags disabled by default', () => {
    const experimentalFlags = service.getFlags(FLAG_CATEGORIES.EXPERIMENTAL);
    for (const flag of experimentalFlags) {
      expect(flag.default).toBe(false);
    }
  });

  it('should have LAZY_GRAPHRAG flag', () => {
    expect(service.hasFlag('LAZY_GRAPHRAG')).toBe(true);
    const flag = service.getFlag('LAZY_GRAPHRAG');
    expect(flag.category).toBe(FLAG_CATEGORIES.EXPERIMENTAL);
  });

  it('should have PERSONA_VIEWS flag', () => {
    expect(service.hasFlag('PERSONA_VIEWS')).toBe(true);
    const flag = service.getFlag('PERSONA_VIEWS');
    expect(flag.category).toBe(FLAG_CATEGORIES.EXPERIMENTAL);
  });
});
