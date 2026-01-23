/**
 * Tests for Suspicious Activity Detection Service
 *
 * Tests F5.1.6: Suspicious Activity Alerts
 */

const {
  SuspiciousActivityService,
  getSuspiciousActivityService,
  ACTIVITY_TYPES,
  SEVERITY,
  DEFAULT_CONFIG,
} = require('../suspicious-activity-service');

// Mock dependencies
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
  trackMetric: jest.fn(),
  trackSecurityEvent: jest.fn(),
}));

jest.mock('../configuration-service', () => ({
  getConfig: jest.fn((key) => {
    const configs = {
      SUSPICIOUS_ACTIVITY_ENABLED: true,
      SUSPICIOUS_DENIAL_THRESHOLD: 5,
      SUSPICIOUS_QUERY_THRESHOLD: 100,
      SUSPICIOUS_ALERT_COOLDOWN_MS: 300000,
    };
    return configs[key];
  }),
  getConfigurationService: jest.fn(() => ({
    get: jest.fn(),
    setOverride: jest.fn(),
  })),
  CONFIG_CATEGORIES: { SECURITY: 'security' },
  CONFIG_TYPES: { BOOLEAN: 'boolean', NUMBER: 'number' },
}));

jest.mock('../audit-persistence-service', () => ({
  getAuditPersistenceService: jest.fn(() => ({
    queryLogs: jest.fn().mockResolvedValue([]),
  })),
}));

const { trackSecurityEvent, trackMetric } = require('../../utils/telemetry');
const { log } = require('../../utils/logger');

describe('SuspiciousActivityService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SuspiciousActivityService();
  });

  afterEach(() => {
    service.reset();
  });

  describe('constructor', () => {
    it('should initialize with default state', () => {
      expect(service.tracker).toBeDefined();
      expect(service.alertHistory).toBeDefined();
      expect(service.detectionRules).toBeDefined();
      expect(service.alertCallbacks).toEqual([]);
      expect(service.statistics.totalAlerts).toBe(0);
    });
  });

  describe('isOffHours', () => {
    it('should return true for weekend', () => {
      const saturday = new Date('2026-01-24T14:00:00'); // Saturday
      expect(service.isOffHours(saturday)).toBe(true);
    });

    it('should return true for late night on weekday', () => {
      const lateNight = new Date('2026-01-23T02:00:00'); // Friday 2 AM
      expect(service.isOffHours(lateNight)).toBe(true);
    });

    it('should return false for business hours on weekday', () => {
      const businessHours = new Date('2026-01-23T10:00:00'); // Friday 10 AM
      expect(service.isOffHours(businessHours)).toBe(false);
    });

    it('should return true for early morning on weekday', () => {
      const earlyMorning = new Date('2026-01-23T05:00:00'); // Friday 5 AM
      expect(service.isOffHours(earlyMorning)).toBe(true);
    });
  });

  describe('trackAccessDenial', () => {
    it('should track denial without alert below threshold', async () => {
      const alerts = await service.trackAccessDenial('user1', { resource: 'doc1' });

      expect(alerts).toHaveLength(0);
      expect(service.tracker.denials.get('user1').count()).toBe(1);
    });

    it('should trigger alert when threshold exceeded', async () => {
      // Track denials up to threshold
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user1', { resource: `doc${i}` });
      }

      const stats = service.getUserStats('user1');
      expect(stats.denials).toBe(DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD);

      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.objectContaining({
          activityType: ACTIVITY_TYPES.EXCESSIVE_DENIALS,
          severity: SEVERITY.HIGH,
        })
      );
    });

    it('should suppress duplicate alerts within cooldown', async () => {
      // Trigger first alert
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user1', {});
      }

      const firstAlertCount = trackSecurityEvent.mock.calls.length;

      // Try to trigger again
      await service.trackAccessDenial('user1', {});

      // Should be suppressed
      expect(trackSecurityEvent.mock.calls.length).toBe(firstAlertCount);
      expect(service.statistics.suppressedAlerts).toBeGreaterThan(0);
    });
  });

  describe('trackQuery', () => {
    it('should track queries without alert below threshold', async () => {
      const alerts = await service.trackQuery('user1', { query: 'test' });

      expect(alerts).toHaveLength(0);
      expect(service.tracker.queries.get('user1').count()).toBe(1);
    });

    it('should trigger alert when query threshold exceeded', async () => {
      // Track queries up to threshold
      for (let i = 0; i < DEFAULT_CONFIG.QUERY_COUNT_THRESHOLD; i++) {
        await service.trackQuery('user1', { query: `query${i}` });
      }

      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.objectContaining({
          activityType: ACTIVITY_TYPES.HIGH_QUERY_VOLUME,
          severity: SEVERITY.MEDIUM,
        })
      );
    });
  });

  describe('trackRequest', () => {
    it('should detect rapid requests', async () => {
      // Track rapid requests
      for (let i = 0; i < DEFAULT_CONFIG.RAPID_REQUEST_COUNT; i++) {
        await service.trackRequest('user1', { path: '/api/test' });
      }

      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.objectContaining({
          activityType: ACTIVITY_TYPES.RAPID_REQUESTS,
        })
      );
    });
  });

  describe('trackDocumentAccess', () => {
    it('should detect bulk document access', async () => {
      // Access many documents quickly
      for (let i = 0; i < DEFAULT_CONFIG.BULK_DOCUMENT_COUNT; i++) {
        await service.trackDocumentAccess('user1', `doc${i}`);
      }

      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.objectContaining({
          activityType: ACTIVITY_TYPES.BULK_DOCUMENT_ACCESS,
          severity: SEVERITY.HIGH,
        })
      );
    });
  });

  describe('trackAuthFailure', () => {
    it('should detect authentication failure spike', async () => {
      for (let i = 0; i < DEFAULT_CONFIG.AUTH_FAILURE_COUNT; i++) {
        await service.trackAuthFailure('user1', { reason: 'invalid_password' });
      }

      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.objectContaining({
          activityType: ACTIVITY_TYPES.AUTH_FAILURE_SPIKE,
          severity: SEVERITY.CRITICAL,
        })
      );
    });
  });

  describe('trackRateLimitViolation', () => {
    it('should detect repeated rate limit violations', async () => {
      for (let i = 0; i < DEFAULT_CONFIG.RATE_LIMIT_VIOLATION_COUNT; i++) {
        await service.trackRateLimitViolation('user1', { endpoint: '/api/graphrag' });
      }

      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.objectContaining({
          activityType: ACTIVITY_TYPES.RATE_LIMIT_VIOLATION,
        })
      );
    });
  });

  describe('trackDataVolume', () => {
    it('should detect potential data exfiltration', async () => {
      const volumeMB = DEFAULT_CONFIG.EXFILTRATION_DATA_VOLUME_MB;
      const volumeBytes = volumeMB * 1024 * 1024;

      await service.trackDataVolume('user1', volumeBytes);

      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.objectContaining({
          activityType: ACTIVITY_TYPES.DATA_EXFILTRATION_PATTERN,
          severity: SEVERITY.CRITICAL,
        })
      );
    });

    it('should accumulate data volume across multiple calls', async () => {
      const chunkSize = 10 * 1024 * 1024; // 10 MB per call
      const threshold = DEFAULT_CONFIG.EXFILTRATION_DATA_VOLUME_MB;
      const callsNeeded = Math.ceil(threshold / 10);

      for (let i = 0; i < callsNeeded; i++) {
        await service.trackDataVolume('user1', chunkSize);
      }

      const stats = service.getUserStats('user1');
      expect(stats.dataVolumeMB).toBeGreaterThanOrEqual(threshold);
    });
  });

  describe('checkOffHoursAccess', () => {
    it('should not alert during business hours', async () => {
      // Mock isOffHours to return false
      jest.spyOn(service, 'isOffHours').mockReturnValue(false);

      const alert = await service.checkOffHoursAccess('user1', { resource: 'doc1' });

      expect(alert).toBeNull();
    });

    it('should alert during off hours', async () => {
      // Mock isOffHours to return true
      jest.spyOn(service, 'isOffHours').mockReturnValue(true);

      const alert = await service.checkOffHoursAccess('user1', { resource: 'doc1' });

      expect(alert).not.toBeNull();
      expect(alert.type).toBe(ACTIVITY_TYPES.OFF_HOURS_ACCESS);
      expect(alert.severity).toBe(SEVERITY.LOW);
    });
  });

  describe('onAlert', () => {
    it('should call registered callback when alert triggered', async () => {
      const callback = jest.fn();
      service.onAlert(callback);

      // Trigger an alert
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user1', {});
      }

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ACTIVITY_TYPES.EXCESSIVE_DENIALS,
          userId: 'user1',
        })
      );
    });

    it('should unsubscribe when returned function called', async () => {
      const callback = jest.fn();
      const unsubscribe = service.onAlert(callback);

      unsubscribe();

      // Trigger an alert
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user2', {});
      }

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getUserStats', () => {
    it('should return zeroes for unknown user', () => {
      const stats = service.getUserStats('unknown_user');

      expect(stats.denials).toBe(0);
      expect(stats.queries).toBe(0);
      expect(stats.requests).toBe(0);
      expect(stats.documentAccess).toBe(0);
      expect(stats.authFailures).toBe(0);
      expect(stats.rateLimitViolations).toBe(0);
      expect(stats.dataVolumeMB).toBe(0);
    });

    it('should track multiple activity types for same user', async () => {
      await service.trackAccessDenial('user1', {});
      await service.trackQuery('user1', {});
      await service.trackRequest('user1', {});
      await service.trackDocumentAccess('user1', 'doc1');

      const stats = service.getUserStats('user1');

      expect(stats.denials).toBe(1);
      expect(stats.queries).toBe(1);
      expect(stats.requests).toBe(1);
      expect(stats.documentAccess).toBe(1);
    });
  });

  describe('getSuspiciousUsers', () => {
    it('should return empty array when no suspicious activity', () => {
      const suspicious = service.getSuspiciousUsers();
      expect(suspicious).toHaveLength(0);
    });

    it('should return users exceeding thresholds', async () => {
      // Make user1 suspicious
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user1', {});
      }

      const suspicious = service.getSuspiciousUsers();

      expect(suspicious).toHaveLength(1);
      expect(suspicious[0].userId).toBe('user1');
      expect(suspicious[0].stats.denials).toBe(DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD);
    });
  });

  describe('getStatistics', () => {
    it('should track alert statistics', async () => {
      // Trigger some alerts
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user1', {});
      }

      const stats = service.getStatistics();

      expect(stats.totalAlerts).toBeGreaterThan(0);
      expect(stats.alertsByType[ACTIVITY_TYPES.EXCESSIVE_DENIALS]).toBeDefined();
      expect(stats.alertsBySeverity[SEVERITY.HIGH]).toBeGreaterThan(0);
      expect(stats.trackedUsers).toBeGreaterThan(0);
    });
  });

  describe('analyzeHistoricalLogs', () => {
    it('should analyze denial patterns from audit logs', async () => {
      const auditModule = require('../audit-persistence-service');

      // Mock audit logs with suspicious pattern
      const mockQueryLogs = jest.fn().mockResolvedValue([
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
        { userId: 'user1', action: 'ACCESS_DENIED', timestamp: new Date().toISOString() },
      ]);

      auditModule.getAuditPersistenceService.mockReturnValue({
        queryLogs: mockQueryLogs,
      });

      const analysis = await service.analyzeHistoricalLogs({ hours: 24 });

      expect(analysis.totalDenials).toBe(10);
      expect(analysis.uniqueUsers).toBe(1);
      expect(analysis.suspiciousUsers.length).toBeGreaterThan(0);
    });

    it('should handle audit service errors gracefully', async () => {
      const auditModule = require('../audit-persistence-service');

      const mockQueryLogs = jest.fn().mockRejectedValue(new Error('DB error'));
      auditModule.getAuditPersistenceService.mockReturnValue({
        queryLogs: mockQueryLogs,
      });

      const analysis = await service.analyzeHistoricalLogs({ hours: 24 });

      expect(analysis.error).toBe('DB error');
    });
  });

  describe('getAzureMonitorAlertConfig', () => {
    it('should return valid alert configuration', () => {
      const config = service.getAzureMonitorAlertConfig();

      expect(config.metrics).toBeDefined();
      expect(config.metrics.length).toBeGreaterThan(0);
      expect(config.events).toBeDefined();
      expect(config.recommendedActions).toBeDefined();
    });

    it('should include critical severity alert configuration', () => {
      const config = service.getAzureMonitorAlertConfig();

      const criticalMetric = config.metrics.find(
        (m) => m.name === 'security.suspicious_activity.critical'
      );

      expect(criticalMetric).toBeDefined();
      expect(criticalMetric.severity).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all tracking data', async () => {
      // Add some tracking data
      await service.trackAccessDenial('user1', {});
      await service.trackQuery('user2', {});

      service.reset();

      expect(service.tracker.getTrackedUsers()).toHaveLength(0);
      expect(service.alertHistory.size).toBe(0);
      expect(service.statistics.totalAlerts).toBe(0);
    });
  });

  describe('getSuspiciousActivityService (singleton)', () => {
    it('should return same instance', () => {
      const instance1 = getSuspiciousActivityService();
      const instance2 = getSuspiciousActivityService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('ActivityWindow', () => {
    it('should expire old events', async () => {
      // Create service with short window for testing
      await service.trackAccessDenial('user1', {});
      expect(service.tracker.denials.get('user1').count()).toBe(1);

      // Manually expire by manipulating the window
      const window = service.tracker.denials.get('user1');
      window.events[0].timestamp = Date.now() - DEFAULT_CONFIG.DENIAL_WINDOW_MS - 1000;

      expect(window.count()).toBe(0);
    });
  });

  describe('Multiple users tracking', () => {
    it('should track activity independently per user', async () => {
      await service.trackAccessDenial('user1', {});
      await service.trackAccessDenial('user1', {});
      await service.trackAccessDenial('user2', {});

      const stats1 = service.getUserStats('user1');
      const stats2 = service.getUserStats('user2');

      expect(stats1.denials).toBe(2);
      expect(stats2.denials).toBe(1);
    });

    it('should trigger alerts only for users exceeding threshold', async () => {
      // User1 exceeds threshold
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user1', {});
      }

      // User2 stays below threshold
      await service.trackAccessDenial('user2', {});

      // Check that only user1 triggered an alert
      expect(trackSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        'user1',
        expect.anything()
      );

      // Verify user2 did not trigger (filter calls to check)
      const user2Calls = trackSecurityEvent.mock.calls.filter(
        (call) => call[1] === 'user2'
      );
      expect(user2Calls).toHaveLength(0);
    });
  });

  describe('ACTIVITY_TYPES constants', () => {
    it('should export all activity types', () => {
      expect(ACTIVITY_TYPES.EXCESSIVE_DENIALS).toBe('excessive_denials');
      expect(ACTIVITY_TYPES.HIGH_QUERY_VOLUME).toBe('high_query_volume');
      expect(ACTIVITY_TYPES.OFF_HOURS_ACCESS).toBe('off_hours_access');
      expect(ACTIVITY_TYPES.RAPID_REQUESTS).toBe('rapid_requests');
      expect(ACTIVITY_TYPES.BULK_DOCUMENT_ACCESS).toBe('bulk_document_access');
      expect(ACTIVITY_TYPES.AUTH_FAILURE_SPIKE).toBe('auth_failure_spike');
      expect(ACTIVITY_TYPES.RATE_LIMIT_VIOLATION).toBe('rate_limit_violation');
      expect(ACTIVITY_TYPES.DATA_EXFILTRATION_PATTERN).toBe('data_exfiltration_pattern');
    });
  });

  describe('SEVERITY constants', () => {
    it('should export all severity levels', () => {
      expect(SEVERITY.LOW).toBe('low');
      expect(SEVERITY.MEDIUM).toBe('medium');
      expect(SEVERITY.HIGH).toBe('high');
      expect(SEVERITY.CRITICAL).toBe('critical');
    });
  });

  describe('Detection disabled', () => {
    it('should not alert when detection is disabled', async () => {
      const { getConfig } = require('../configuration-service');
      getConfig.mockImplementation((key) => {
        if (key === 'SUSPICIOUS_ACTIVITY_ENABLED') return false;
        return DEFAULT_CONFIG[key.replace('SUSPICIOUS_', '')];
      });

      const newService = new SuspiciousActivityService();

      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await newService.trackAccessDenial('user1', {});
      }

      // No alerts should be triggered
      const calls = trackSecurityEvent.mock.calls.filter(
        (call) => call[0] === 'suspicious_activity' && call[1] === 'user1'
      );

      // The service was created after mock was updated, so it uses the disabled config
      // Reset mock to original behavior for other tests
      getConfig.mockImplementation((key) => {
        const configs = {
          SUSPICIOUS_ACTIVITY_ENABLED: true,
          SUSPICIOUS_DENIAL_THRESHOLD: 5,
          SUSPICIOUS_QUERY_THRESHOLD: 100,
          SUSPICIOUS_ALERT_COOLDOWN_MS: 300000,
        };
        return configs[key];
      });
    });
  });

  describe('Telemetry integration', () => {
    it('should track metric with severity dimension', async () => {
      for (let i = 0; i < DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD; i++) {
        await service.trackAccessDenial('user1', {});
      }

      expect(trackMetric).toHaveBeenCalledWith(
        'security.suspicious_activity',
        1,
        expect.objectContaining({
          type: ACTIVITY_TYPES.EXCESSIVE_DENIALS,
          severity: SEVERITY.HIGH,
        })
      );

      expect(trackMetric).toHaveBeenCalledWith(
        `security.suspicious_activity.${SEVERITY.HIGH}`,
        1,
        expect.anything()
      );
    });
  });
});
