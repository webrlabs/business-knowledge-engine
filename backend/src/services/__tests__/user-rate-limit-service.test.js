/**
 * Unit tests for User-Based Rate Limiting Service (F5.3.5)
 */

const {
  getRateLimitStats,
  getUserRateLimitStats,
  resetRateLimitStats,
  getRateLimitConfig,
  getRoleMultiplier,
  calculateEffectiveMax,
  generateKey,
  getHighestRole,
  ROLE_MULTIPLIERS,
  BASE_LIMITS,
  userGeneralLimiter,
  userQueryLimiter,
  userUploadLimiter,
  userProcessingLimiter,
  userStrictLimiter,
} = require('../user-rate-limit-service');

describe('User Rate Limit Service', () => {
  beforeEach(() => {
    // Reset stats before each test
    resetRateLimitStats();
  });

  describe('getHighestRole', () => {
    it('should return admin as highest role when present', () => {
      expect(getHighestRole(['reader', 'admin', 'contributor'])).toBe('admin');
    });

    it('should return reviewer when admin is not present', () => {
      expect(getHighestRole(['reader', 'reviewer', 'contributor'])).toBe('reviewer');
    });

    it('should return contributor when admin and reviewer are not present', () => {
      expect(getHighestRole(['reader', 'contributor'])).toBe('contributor');
    });

    it('should return reader when only reader is present', () => {
      expect(getHighestRole(['reader'])).toBe('reader');
    });

    it('should return default for empty roles', () => {
      expect(getHighestRole([])).toBe('default');
    });

    it('should return default for undefined roles', () => {
      expect(getHighestRole(undefined)).toBe('default');
    });

    it('should handle case-insensitive role matching', () => {
      expect(getHighestRole(['ADMIN'])).toBe('admin');
      expect(getHighestRole(['Reviewer'])).toBe('reviewer');
    });

    it('should handle partial role matching (e.g., App.Admin)', () => {
      expect(getHighestRole(['App.Admin', 'Platform.Reader'])).toBe('admin');
      expect(getHighestRole(['KnowledgePlatform.Reviewer'])).toBe('reviewer');
    });
  });

  describe('getRoleMultiplier', () => {
    it('should return correct multiplier for admin', () => {
      expect(getRoleMultiplier(['admin'])).toBe(ROLE_MULTIPLIERS.admin);
    });

    it('should return correct multiplier for reviewer', () => {
      expect(getRoleMultiplier(['reviewer'])).toBe(ROLE_MULTIPLIERS.reviewer);
    });

    it('should return correct multiplier for contributor', () => {
      expect(getRoleMultiplier(['contributor'])).toBe(ROLE_MULTIPLIERS.contributor);
    });

    it('should return correct multiplier for reader', () => {
      expect(getRoleMultiplier(['reader'])).toBe(ROLE_MULTIPLIERS.reader);
    });

    it('should return default multiplier for unknown roles', () => {
      expect(getRoleMultiplier(['unknown_role'])).toBe(ROLE_MULTIPLIERS.default);
    });

    it('should use highest role when multiple roles present', () => {
      expect(getRoleMultiplier(['reader', 'admin'])).toBe(ROLE_MULTIPLIERS.admin);
    });
  });

  describe('calculateEffectiveMax', () => {
    it('should multiply base by admin multiplier', () => {
      const baseMax = 100;
      const result = calculateEffectiveMax(baseMax, ['admin']);
      expect(result).toBe(Math.floor(baseMax * ROLE_MULTIPLIERS.admin));
    });

    it('should multiply base by reviewer multiplier', () => {
      const baseMax = 100;
      const result = calculateEffectiveMax(baseMax, ['reviewer']);
      expect(result).toBe(Math.floor(baseMax * ROLE_MULTIPLIERS.reviewer));
    });

    it('should return base for reader role', () => {
      const baseMax = 100;
      const result = calculateEffectiveMax(baseMax, ['reader']);
      expect(result).toBe(Math.floor(baseMax * ROLE_MULTIPLIERS.reader));
    });

    it('should floor the result', () => {
      const baseMax = 10;
      // With contributor multiplier of 1.5, 10 * 1.5 = 15
      const result = calculateEffectiveMax(baseMax, ['contributor']);
      expect(result).toBe(15);
    });
  });

  describe('generateKey', () => {
    it('should generate user key when user is authenticated', () => {
      const req = {
        user: { id: 'user123' },
        ip: '192.168.1.1',
        headers: {},
      };
      expect(generateKey(req)).toBe('user:user123');
    });

    it('should generate IP key when user is not authenticated', () => {
      const req = {
        user: null,
        ip: '192.168.1.1',
        headers: {},
      };
      expect(generateKey(req)).toBe('ip:192.168.1.1');
    });

    it('should use x-forwarded-for header when available', () => {
      const req = {
        user: null,
        ip: '192.168.1.1',
        headers: {
          'x-forwarded-for': '10.0.0.1, 192.168.1.1',
        },
      };
      expect(generateKey(req)).toBe('ip:10.0.0.1');
    });

    it('should generate combined user+IP key when includeIp is true', () => {
      const req = {
        user: { id: 'user123' },
        ip: '192.168.1.1',
        headers: {},
      };
      expect(generateKey(req, true)).toBe('user:user123:ip:192.168.1.1');
    });

    it('should handle missing user object', () => {
      const req = {
        ip: '192.168.1.1',
        headers: {},
      };
      expect(generateKey(req)).toBe('ip:192.168.1.1');
    });

    it('should handle missing IP with fallback', () => {
      const req = {
        user: null,
        headers: {},
      };
      expect(generateKey(req)).toBe('ip:unknown');
    });
  });

  describe('getRateLimitStats', () => {
    it('should return global statistics', () => {
      const stats = getRateLimitStats();

      expect(stats).toHaveProperty('global');
      expect(stats).toHaveProperty('topBlocked');
      expect(stats).toHaveProperty('topUsers');
      expect(stats).toHaveProperty('roleMultipliers');
      expect(stats).toHaveProperty('baseLimits');
      expect(stats).toHaveProperty('environment');
    });

    it('should have correct global stats structure', () => {
      const stats = getRateLimitStats();

      expect(stats.global).toHaveProperty('totalHits');
      expect(stats.global).toHaveProperty('totalBlocked');
      expect(stats.global).toHaveProperty('uniqueKeys');
      expect(stats.global).toHaveProperty('uptimeMs');
      expect(stats.global).toHaveProperty('uptimeHuman');
      expect(stats.global).toHaveProperty('avgHitsPerMinute');
      expect(stats.global).toHaveProperty('blockRate');
    });
  });

  describe('getUserRateLimitStats', () => {
    it('should return null for unknown user', () => {
      const stats = getUserRateLimitStats('nonexistent_user');
      expect(stats).toBeNull();
    });
  });

  describe('resetRateLimitStats', () => {
    it('should reset all statistics', () => {
      // Get initial stats
      const statsBefore = getRateLimitStats();

      // Reset
      resetRateLimitStats();

      // Verify reset
      const statsAfter = getRateLimitStats();
      expect(statsAfter.global.totalHits).toBe(0);
      expect(statsAfter.global.totalBlocked).toBe(0);
      expect(statsAfter.global.uniqueKeys).toBe(0);
    });
  });

  describe('getRateLimitConfig', () => {
    it('should return configuration object', () => {
      const config = getRateLimitConfig();

      expect(config).toHaveProperty('roleMultipliers');
      expect(config).toHaveProperty('baseLimits');
      expect(config).toHaveProperty('environment');
      expect(config).toHaveProperty('cleanupIntervalHours');
    });

    it('should have all role multipliers', () => {
      const config = getRateLimitConfig();

      expect(config.roleMultipliers).toHaveProperty('admin');
      expect(config.roleMultipliers).toHaveProperty('reviewer');
      expect(config.roleMultipliers).toHaveProperty('contributor');
      expect(config.roleMultipliers).toHaveProperty('reader');
      expect(config.roleMultipliers).toHaveProperty('default');
    });

    it('should have all base limit configurations', () => {
      const config = getRateLimitConfig();

      expect(config.baseLimits).toHaveProperty('general');
      expect(config.baseLimits).toHaveProperty('query');
      expect(config.baseLimits).toHaveProperty('upload');
      expect(config.baseLimits).toHaveProperty('processing');
      expect(config.baseLimits).toHaveProperty('strict');
    });

    it('should have correct base limit structure', () => {
      const config = getRateLimitConfig();

      expect(config.baseLimits.general).toHaveProperty('windowMs');
      expect(config.baseLimits.general).toHaveProperty('maxDev');
      expect(config.baseLimits.general).toHaveProperty('maxProd');
    });
  });

  describe('ROLE_MULTIPLIERS', () => {
    it('should have admin as highest multiplier', () => {
      expect(ROLE_MULTIPLIERS.admin).toBeGreaterThan(ROLE_MULTIPLIERS.reviewer);
      expect(ROLE_MULTIPLIERS.reviewer).toBeGreaterThan(ROLE_MULTIPLIERS.contributor);
      expect(ROLE_MULTIPLIERS.contributor).toBeGreaterThan(ROLE_MULTIPLIERS.reader);
    });

    it('should have positive multipliers', () => {
      expect(ROLE_MULTIPLIERS.admin).toBeGreaterThan(0);
      expect(ROLE_MULTIPLIERS.reviewer).toBeGreaterThan(0);
      expect(ROLE_MULTIPLIERS.contributor).toBeGreaterThan(0);
      expect(ROLE_MULTIPLIERS.reader).toBeGreaterThan(0);
      expect(ROLE_MULTIPLIERS.default).toBeGreaterThan(0);
    });
  });

  describe('BASE_LIMITS', () => {
    it('should have all limiter types', () => {
      expect(BASE_LIMITS).toHaveProperty('general');
      expect(BASE_LIMITS).toHaveProperty('query');
      expect(BASE_LIMITS).toHaveProperty('upload');
      expect(BASE_LIMITS).toHaveProperty('processing');
      expect(BASE_LIMITS).toHaveProperty('strict');
    });

    it('should have positive window durations', () => {
      expect(BASE_LIMITS.general.windowMs).toBeGreaterThan(0);
      expect(BASE_LIMITS.query.windowMs).toBeGreaterThan(0);
      expect(BASE_LIMITS.upload.windowMs).toBeGreaterThan(0);
      expect(BASE_LIMITS.processing.windowMs).toBeGreaterThan(0);
      expect(BASE_LIMITS.strict.windowMs).toBeGreaterThan(0);
    });

    it('should have dev limits higher than prod limits', () => {
      expect(BASE_LIMITS.general.maxDev).toBeGreaterThanOrEqual(BASE_LIMITS.general.maxProd);
      expect(BASE_LIMITS.query.maxDev).toBeGreaterThanOrEqual(BASE_LIMITS.query.maxProd);
      expect(BASE_LIMITS.upload.maxDev).toBeGreaterThanOrEqual(BASE_LIMITS.upload.maxProd);
      expect(BASE_LIMITS.processing.maxDev).toBeGreaterThanOrEqual(BASE_LIMITS.processing.maxProd);
    });
  });

  describe('Rate Limiter Middleware', () => {
    it('should export userGeneralLimiter', () => {
      expect(userGeneralLimiter).toBeDefined();
      expect(typeof userGeneralLimiter).toBe('function');
    });

    it('should export userQueryLimiter', () => {
      expect(userQueryLimiter).toBeDefined();
      expect(typeof userQueryLimiter).toBe('function');
    });

    it('should export userUploadLimiter', () => {
      expect(userUploadLimiter).toBeDefined();
      expect(typeof userUploadLimiter).toBe('function');
    });

    it('should export userProcessingLimiter', () => {
      expect(userProcessingLimiter).toBeDefined();
      expect(typeof userProcessingLimiter).toBe('function');
    });

    it('should export userStrictLimiter', () => {
      expect(userStrictLimiter).toBeDefined();
      expect(typeof userStrictLimiter).toBe('function');
    });
  });

  describe('Environment-specific behavior', () => {
    it('should report correct environment', () => {
      const stats = getRateLimitStats();
      // In test environment, NODE_ENV is typically 'test' which is not 'production'
      expect(['development', 'production']).toContain(stats.environment);
    });
  });
});
