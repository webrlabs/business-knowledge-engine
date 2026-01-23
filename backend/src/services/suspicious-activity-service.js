/**
 * Suspicious Activity Detection Service
 *
 * Monitors and detects unusual access patterns for security alerting.
 * Integrates with Azure Monitor for real-time alerting.
 *
 * Features:
 * - F5.1.6: Suspicious Activity Alerts
 *
 * Detection patterns:
 * - Excessive access denials (brute force attempts)
 * - Unusual query volumes (potential data exfiltration)
 * - Access at unusual times (off-hours access)
 * - Rapid successive requests (automated scraping)
 * - Bulk document access (potential data harvesting)
 * - Failed authentication spikes
 * - Rate limit violations
 *
 * @module services/suspicious-activity-service
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric, trackSecurityEvent } = require('../utils/telemetry');
const { getConfig, getConfigurationService, CONFIG_CATEGORIES, CONFIG_TYPES } = require('./configuration-service');
const { getAuditPersistenceService } = require('./audit-persistence-service');

/**
 * Suspicious activity types
 */
const ACTIVITY_TYPES = {
  EXCESSIVE_DENIALS: 'excessive_denials',
  HIGH_QUERY_VOLUME: 'high_query_volume',
  OFF_HOURS_ACCESS: 'off_hours_access',
  RAPID_REQUESTS: 'rapid_requests',
  BULK_DOCUMENT_ACCESS: 'bulk_document_access',
  AUTH_FAILURE_SPIKE: 'auth_failure_spike',
  RATE_LIMIT_VIOLATION: 'rate_limit_violation',
  UNUSUAL_ENTITY_ACCESS: 'unusual_entity_access',
  DATA_EXFILTRATION_PATTERN: 'data_exfiltration_pattern',
  PRIVILEGE_ESCALATION_ATTEMPT: 'privilege_escalation_attempt',
};

/**
 * Severity levels
 */
const SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/**
 * Default configuration for detection thresholds
 */
const DEFAULT_CONFIG = {
  // Access denial thresholds
  DENIAL_COUNT_THRESHOLD: 5,
  DENIAL_WINDOW_MS: 300000, // 5 minutes

  // Query volume thresholds
  QUERY_COUNT_THRESHOLD: 100,
  QUERY_WINDOW_MS: 60000, // 1 minute

  // Off-hours access (hours in local time)
  BUSINESS_HOURS_START: 6, // 6 AM
  BUSINESS_HOURS_END: 22, // 10 PM
  BUSINESS_DAYS: [1, 2, 3, 4, 5], // Monday-Friday

  // Rapid request thresholds
  RAPID_REQUEST_COUNT: 50,
  RAPID_REQUEST_WINDOW_MS: 10000, // 10 seconds

  // Bulk document access
  BULK_DOCUMENT_COUNT: 20,
  BULK_DOCUMENT_WINDOW_MS: 60000, // 1 minute

  // Auth failure thresholds
  AUTH_FAILURE_COUNT: 10,
  AUTH_FAILURE_WINDOW_MS: 300000, // 5 minutes

  // Rate limit violation thresholds
  RATE_LIMIT_VIOLATION_COUNT: 3,
  RATE_LIMIT_VIOLATION_WINDOW_MS: 300000, // 5 minutes

  // Data exfiltration pattern
  EXFILTRATION_DATA_VOLUME_MB: 50,
  EXFILTRATION_WINDOW_MS: 600000, // 10 minutes

  // Detection enabled by default
  DETECTION_ENABLED: true,

  // Alert cooldown to prevent spam
  ALERT_COOLDOWN_MS: 300000, // 5 minutes
};

/**
 * Register configuration definitions for suspicious activity detection
 */
function registerConfigDefinitions() {
  const configService = getConfigurationService();

  // Only add if not already defined (allows external override)
  const definitions = {
    SUSPICIOUS_ACTIVITY_ENABLED: {
      key: 'SUSPICIOUS_ACTIVITY_ENABLED',
      description: 'Enable suspicious activity detection',
      category: CONFIG_CATEGORIES.SECURITY,
      type: CONFIG_TYPES.BOOLEAN,
      default: DEFAULT_CONFIG.DETECTION_ENABLED,
      envVar: 'CFG_SUSPICIOUS_ACTIVITY_ENABLED',
    },
    SUSPICIOUS_DENIAL_THRESHOLD: {
      key: 'SUSPICIOUS_DENIAL_THRESHOLD',
      description: 'Number of access denials to trigger alert',
      category: CONFIG_CATEGORIES.SECURITY,
      type: CONFIG_TYPES.NUMBER,
      default: DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD,
      envVar: 'CFG_SUSPICIOUS_DENIAL_THRESHOLD',
      min: 1,
      max: 100,
    },
    SUSPICIOUS_QUERY_THRESHOLD: {
      key: 'SUSPICIOUS_QUERY_THRESHOLD',
      description: 'Number of queries per minute to trigger alert',
      category: CONFIG_CATEGORIES.SECURITY,
      type: CONFIG_TYPES.NUMBER,
      default: DEFAULT_CONFIG.QUERY_COUNT_THRESHOLD,
      envVar: 'CFG_SUSPICIOUS_QUERY_THRESHOLD',
      min: 10,
      max: 1000,
    },
    SUSPICIOUS_ALERT_COOLDOWN_MS: {
      key: 'SUSPICIOUS_ALERT_COOLDOWN_MS',
      description: 'Cooldown between repeated alerts for same activity type',
      category: CONFIG_CATEGORIES.SECURITY,
      type: CONFIG_TYPES.NUMBER,
      default: DEFAULT_CONFIG.ALERT_COOLDOWN_MS,
      envVar: 'CFG_SUSPICIOUS_ALERT_COOLDOWN_MS',
      min: 60000,
      max: 3600000,
      unit: 'ms',
    },
  };

  // Register definitions - they will be used when config is queried
  return definitions;
}

/**
 * Activity window for tracking recent events
 */
class ActivityWindow {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.events = [];
  }

  /**
   * Add an event to the window
   * @param {Object} event - Event data
   */
  add(event) {
    const now = Date.now();
    this.events.push({ ...event, timestamp: now });
    this._cleanup(now);
  }

  /**
   * Get count of events in window
   * @returns {number}
   */
  count() {
    this._cleanup(Date.now());
    return this.events.length;
  }

  /**
   * Get all events in window
   * @returns {Array}
   */
  getEvents() {
    this._cleanup(Date.now());
    return [...this.events];
  }

  /**
   * Remove old events outside window
   * @private
   */
  _cleanup(now) {
    const cutoff = now - this.windowMs;
    this.events = this.events.filter((e) => e.timestamp > cutoff);
  }

  /**
   * Clear all events
   */
  clear() {
    this.events = [];
  }
}

/**
 * User activity tracker
 */
class UserActivityTracker {
  constructor() {
    // Track different activity types per user
    this.denials = new Map(); // userId -> ActivityWindow
    this.queries = new Map(); // userId -> ActivityWindow
    this.requests = new Map(); // userId -> ActivityWindow
    this.documentAccess = new Map(); // userId -> ActivityWindow
    this.authFailures = new Map(); // userId -> ActivityWindow
    this.rateLimitViolations = new Map(); // userId -> ActivityWindow
    this.dataVolume = new Map(); // userId -> { bytes, window }
  }

  /**
   * Get or create activity window for user
   * @private
   */
  _getWindow(map, userId, windowMs) {
    if (!map.has(userId)) {
      map.set(userId, new ActivityWindow(windowMs));
    }
    return map.get(userId);
  }

  /**
   * Track access denial
   */
  trackDenial(userId, details) {
    const window = this._getWindow(this.denials, userId, DEFAULT_CONFIG.DENIAL_WINDOW_MS);
    window.add(details);
    return window.count();
  }

  /**
   * Track query
   */
  trackQuery(userId, details) {
    const window = this._getWindow(this.queries, userId, DEFAULT_CONFIG.QUERY_WINDOW_MS);
    window.add(details);
    return window.count();
  }

  /**
   * Track request (for rapid request detection)
   */
  trackRequest(userId, details) {
    const window = this._getWindow(this.requests, userId, DEFAULT_CONFIG.RAPID_REQUEST_WINDOW_MS);
    window.add(details);
    return window.count();
  }

  /**
   * Track document access
   */
  trackDocumentAccess(userId, documentId) {
    const window = this._getWindow(this.documentAccess, userId, DEFAULT_CONFIG.BULK_DOCUMENT_WINDOW_MS);
    window.add({ documentId });
    return window.count();
  }

  /**
   * Track auth failure
   */
  trackAuthFailure(userId, details) {
    const window = this._getWindow(this.authFailures, userId, DEFAULT_CONFIG.AUTH_FAILURE_WINDOW_MS);
    window.add(details);
    return window.count();
  }

  /**
   * Track rate limit violation
   */
  trackRateLimitViolation(userId, details) {
    const window = this._getWindow(
      this.rateLimitViolations,
      userId,
      DEFAULT_CONFIG.RATE_LIMIT_VIOLATION_WINDOW_MS
    );
    window.add(details);
    return window.count();
  }

  /**
   * Track data volume (for exfiltration detection)
   */
  trackDataVolume(userId, bytes) {
    if (!this.dataVolume.has(userId)) {
      this.dataVolume.set(userId, {
        bytes: 0,
        windowStart: Date.now(),
      });
    }

    const tracker = this.dataVolume.get(userId);
    const now = Date.now();

    // Reset window if expired
    if (now - tracker.windowStart > DEFAULT_CONFIG.EXFILTRATION_WINDOW_MS) {
      tracker.bytes = 0;
      tracker.windowStart = now;
    }

    tracker.bytes += bytes;
    return tracker.bytes;
  }

  /**
   * Get user statistics
   */
  getUserStats(userId) {
    return {
      denials: this.denials.get(userId)?.count() || 0,
      queries: this.queries.get(userId)?.count() || 0,
      requests: this.requests.get(userId)?.count() || 0,
      documentAccess: this.documentAccess.get(userId)?.count() || 0,
      authFailures: this.authFailures.get(userId)?.count() || 0,
      rateLimitViolations: this.rateLimitViolations.get(userId)?.count() || 0,
      dataVolumeMB: (this.dataVolume.get(userId)?.bytes || 0) / (1024 * 1024),
    };
  }

  /**
   * Get all tracked users
   */
  getTrackedUsers() {
    const users = new Set();
    for (const map of [
      this.denials,
      this.queries,
      this.requests,
      this.documentAccess,
      this.authFailures,
      this.rateLimitViolations,
      this.dataVolume,
    ]) {
      for (const userId of map.keys()) {
        users.add(userId);
      }
    }
    return Array.from(users);
  }

  /**
   * Clear all tracking data
   */
  clear() {
    this.denials.clear();
    this.queries.clear();
    this.requests.clear();
    this.documentAccess.clear();
    this.authFailures.clear();
    this.rateLimitViolations.clear();
    this.dataVolume.clear();
  }
}

/**
 * Suspicious Activity Detection Service
 */
class SuspiciousActivityService {
  constructor() {
    this.tracker = new UserActivityTracker();
    this.alertHistory = new Map(); // activityType:userId -> lastAlertTime
    this.detectionRules = this._initializeRules();
    this.alertCallbacks = [];
    this.statistics = {
      totalAlerts: 0,
      alertsByType: {},
      alertsBySeverity: {},
      suppressedAlerts: 0,
      lastAlertTime: null,
    };
  }

  /**
   * Initialize detection rules
   * @private
   */
  _initializeRules() {
    return [
      {
        type: ACTIVITY_TYPES.EXCESSIVE_DENIALS,
        severity: SEVERITY.HIGH,
        check: (userId) => {
          const count = this.tracker.denials.get(userId)?.count() || 0;
          const threshold =
            getConfig('SUSPICIOUS_DENIAL_THRESHOLD') || DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD;
          return count >= threshold ? { count, threshold } : null;
        },
        message: (data) =>
          `User exceeded access denial threshold: ${data.count} denials in ${DEFAULT_CONFIG.DENIAL_WINDOW_MS / 1000}s (threshold: ${data.threshold})`,
      },
      {
        type: ACTIVITY_TYPES.HIGH_QUERY_VOLUME,
        severity: SEVERITY.MEDIUM,
        check: (userId) => {
          const count = this.tracker.queries.get(userId)?.count() || 0;
          const threshold =
            getConfig('SUSPICIOUS_QUERY_THRESHOLD') || DEFAULT_CONFIG.QUERY_COUNT_THRESHOLD;
          return count >= threshold ? { count, threshold } : null;
        },
        message: (data) =>
          `User exceeded query volume threshold: ${data.count} queries in ${DEFAULT_CONFIG.QUERY_WINDOW_MS / 1000}s (threshold: ${data.threshold})`,
      },
      {
        type: ACTIVITY_TYPES.RAPID_REQUESTS,
        severity: SEVERITY.MEDIUM,
        check: (userId) => {
          const count = this.tracker.requests.get(userId)?.count() || 0;
          return count >= DEFAULT_CONFIG.RAPID_REQUEST_COUNT
            ? { count, threshold: DEFAULT_CONFIG.RAPID_REQUEST_COUNT }
            : null;
        },
        message: (data) =>
          `Rapid request pattern detected: ${data.count} requests in ${DEFAULT_CONFIG.RAPID_REQUEST_WINDOW_MS / 1000}s (threshold: ${data.threshold})`,
      },
      {
        type: ACTIVITY_TYPES.BULK_DOCUMENT_ACCESS,
        severity: SEVERITY.HIGH,
        check: (userId) => {
          const count = this.tracker.documentAccess.get(userId)?.count() || 0;
          return count >= DEFAULT_CONFIG.BULK_DOCUMENT_COUNT
            ? { count, threshold: DEFAULT_CONFIG.BULK_DOCUMENT_COUNT }
            : null;
        },
        message: (data) =>
          `Bulk document access detected: ${data.count} documents in ${DEFAULT_CONFIG.BULK_DOCUMENT_WINDOW_MS / 1000}s (threshold: ${data.threshold})`,
      },
      {
        type: ACTIVITY_TYPES.AUTH_FAILURE_SPIKE,
        severity: SEVERITY.CRITICAL,
        check: (userId) => {
          const count = this.tracker.authFailures.get(userId)?.count() || 0;
          return count >= DEFAULT_CONFIG.AUTH_FAILURE_COUNT
            ? { count, threshold: DEFAULT_CONFIG.AUTH_FAILURE_COUNT }
            : null;
        },
        message: (data) =>
          `Authentication failure spike: ${data.count} failures in ${DEFAULT_CONFIG.AUTH_FAILURE_WINDOW_MS / 1000}s (threshold: ${data.threshold})`,
      },
      {
        type: ACTIVITY_TYPES.RATE_LIMIT_VIOLATION,
        severity: SEVERITY.MEDIUM,
        check: (userId) => {
          const count = this.tracker.rateLimitViolations.get(userId)?.count() || 0;
          return count >= DEFAULT_CONFIG.RATE_LIMIT_VIOLATION_COUNT
            ? { count, threshold: DEFAULT_CONFIG.RATE_LIMIT_VIOLATION_COUNT }
            : null;
        },
        message: (data) =>
          `Repeated rate limit violations: ${data.count} in ${DEFAULT_CONFIG.RATE_LIMIT_VIOLATION_WINDOW_MS / 1000}s (threshold: ${data.threshold})`,
      },
      {
        type: ACTIVITY_TYPES.DATA_EXFILTRATION_PATTERN,
        severity: SEVERITY.CRITICAL,
        check: (userId) => {
          const volumeMB =
            (this.tracker.dataVolume.get(userId)?.bytes || 0) / (1024 * 1024);
          return volumeMB >= DEFAULT_CONFIG.EXFILTRATION_DATA_VOLUME_MB
            ? { volumeMB, threshold: DEFAULT_CONFIG.EXFILTRATION_DATA_VOLUME_MB }
            : null;
        },
        message: (data) =>
          `Potential data exfiltration: ${data.volumeMB.toFixed(2)}MB transferred in ${DEFAULT_CONFIG.EXFILTRATION_WINDOW_MS / 1000}s (threshold: ${data.threshold}MB)`,
      },
    ];
  }

  /**
   * Check if current time is outside business hours
   * @param {Date} [date] - Date to check (default: now)
   * @returns {boolean}
   */
  isOffHours(date = new Date()) {
    const hour = date.getHours();
    const day = date.getDay(); // 0 = Sunday

    const isBusinessDay = DEFAULT_CONFIG.BUSINESS_DAYS.includes(day);
    const isBusinessHour =
      hour >= DEFAULT_CONFIG.BUSINESS_HOURS_START &&
      hour < DEFAULT_CONFIG.BUSINESS_HOURS_END;

    return !isBusinessDay || !isBusinessHour;
  }

  /**
   * Check if alert should be suppressed (cooldown)
   * @private
   */
  _shouldSuppressAlert(type, userId) {
    const key = `${type}:${userId}`;
    const lastAlert = this.alertHistory.get(key);
    const cooldown =
      getConfig('SUSPICIOUS_ALERT_COOLDOWN_MS') || DEFAULT_CONFIG.ALERT_COOLDOWN_MS;

    if (lastAlert && Date.now() - lastAlert < cooldown) {
      return true;
    }

    return false;
  }

  /**
   * Record alert and update history
   * @private
   */
  _recordAlert(type, userId) {
    const key = `${type}:${userId}`;
    this.alertHistory.set(key, Date.now());

    // Update statistics
    this.statistics.totalAlerts++;
    this.statistics.alertsByType[type] = (this.statistics.alertsByType[type] || 0) + 1;
    this.statistics.lastAlertTime = new Date().toISOString();
  }

  /**
   * Send alert to Azure Monitor and registered callbacks
   * @private
   */
  async _sendAlert(alert) {
    // Track as security event in Application Insights
    trackSecurityEvent('suspicious_activity', alert.userId, {
      activityType: alert.type,
      severity: alert.severity,
      message: alert.message,
      details: JSON.stringify(alert.details),
      timestamp: alert.timestamp,
    });

    // Track metric for alerting rules
    trackMetric('security.suspicious_activity', 1, {
      type: alert.type,
      severity: alert.severity,
      userId: alert.userId,
    });

    // Track custom metric for each severity
    trackMetric(`security.suspicious_activity.${alert.severity}`, 1, {
      type: alert.type,
      userId: alert.userId,
    });

    // Log for local monitoring
    log.warn('Suspicious activity detected', {
      type: alert.type,
      severity: alert.severity,
      userId: alert.userId,
      message: alert.message,
    });

    // Update severity statistics
    this.statistics.alertsBySeverity[alert.severity] =
      (this.statistics.alertsBySeverity[alert.severity] || 0) + 1;

    // Notify registered callbacks
    for (const callback of this.alertCallbacks) {
      try {
        await callback(alert);
      } catch (error) {
        log.error('Alert callback error', { error: error.message });
      }
    }
  }

  /**
   * Run all detection rules for a user
   * @param {string} userId - User ID to check
   * @returns {Array} - Array of triggered alerts
   */
  async runDetection(userId) {
    const enabled = getConfig('SUSPICIOUS_ACTIVITY_ENABLED');
    if (enabled === false) {
      return [];
    }

    const alerts = [];

    for (const rule of this.detectionRules) {
      const result = rule.check(userId);
      if (result) {
        if (this._shouldSuppressAlert(rule.type, userId)) {
          this.statistics.suppressedAlerts++;
          continue;
        }

        const alert = {
          id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: rule.type,
          severity: rule.severity,
          userId,
          message: rule.message(result),
          details: result,
          timestamp: new Date().toISOString(),
          offHours: this.isOffHours(),
        };

        this._recordAlert(rule.type, userId);
        await this._sendAlert(alert);
        alerts.push(alert);
      }
    }

    return alerts;
  }

  /**
   * Track an access denial event
   * @param {string} userId - User ID
   * @param {Object} details - Denial details
   * @returns {Promise<Array>} - Any triggered alerts
   */
  async trackAccessDenial(userId, details = {}) {
    this.tracker.trackDenial(userId, details);
    return this.runDetection(userId);
  }

  /**
   * Track a query event
   * @param {string} userId - User ID
   * @param {Object} details - Query details
   * @returns {Promise<Array>} - Any triggered alerts
   */
  async trackQuery(userId, details = {}) {
    this.tracker.trackQuery(userId, details);
    return this.runDetection(userId);
  }

  /**
   * Track a request event (for rapid request detection)
   * @param {string} userId - User ID
   * @param {Object} details - Request details
   * @returns {Promise<Array>} - Any triggered alerts
   */
  async trackRequest(userId, details = {}) {
    this.tracker.trackRequest(userId, details);
    return this.runDetection(userId);
  }

  /**
   * Track document access
   * @param {string} userId - User ID
   * @param {string} documentId - Document ID
   * @returns {Promise<Array>} - Any triggered alerts
   */
  async trackDocumentAccess(userId, documentId) {
    this.tracker.trackDocumentAccess(userId, documentId);
    return this.runDetection(userId);
  }

  /**
   * Track authentication failure
   * @param {string} userId - User ID or identifier
   * @param {Object} details - Failure details
   * @returns {Promise<Array>} - Any triggered alerts
   */
  async trackAuthFailure(userId, details = {}) {
    this.tracker.trackAuthFailure(userId, details);
    return this.runDetection(userId);
  }

  /**
   * Track rate limit violation
   * @param {string} userId - User ID
   * @param {Object} details - Violation details
   * @returns {Promise<Array>} - Any triggered alerts
   */
  async trackRateLimitViolation(userId, details = {}) {
    this.tracker.trackRateLimitViolation(userId, details);
    return this.runDetection(userId);
  }

  /**
   * Track data volume (for exfiltration detection)
   * @param {string} userId - User ID
   * @param {number} bytes - Bytes transferred
   * @returns {Promise<Array>} - Any triggered alerts
   */
  async trackDataVolume(userId, bytes) {
    this.tracker.trackDataVolume(userId, bytes);
    return this.runDetection(userId);
  }

  /**
   * Check for off-hours access
   * @param {string} userId - User ID
   * @param {Object} details - Access details
   * @returns {Object|null} - Alert if off-hours access detected
   */
  async checkOffHoursAccess(userId, details = {}) {
    if (!this.isOffHours()) {
      return null;
    }

    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: ACTIVITY_TYPES.OFF_HOURS_ACCESS,
      severity: SEVERITY.LOW,
      userId,
      message: `Off-hours access detected at ${new Date().toISOString()}`,
      details: {
        ...details,
        localHour: new Date().getHours(),
        dayOfWeek: new Date().getDay(),
      },
      timestamp: new Date().toISOString(),
      offHours: true,
    };

    // Only alert occasionally for off-hours (less frequent)
    if (!this._shouldSuppressAlert(ACTIVITY_TYPES.OFF_HOURS_ACCESS, userId)) {
      this._recordAlert(ACTIVITY_TYPES.OFF_HOURS_ACCESS, userId);
      await this._sendAlert(alert);
      return alert;
    }

    return null;
  }

  /**
   * Register alert callback
   * @param {Function} callback - Callback(alert)
   * @returns {Function} - Unsubscribe function
   */
  onAlert(callback) {
    this.alertCallbacks.push(callback);
    return () => {
      const index = this.alertCallbacks.indexOf(callback);
      if (index >= 0) {
        this.alertCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get user activity statistics
   * @param {string} userId - User ID
   * @returns {Object}
   */
  getUserStats(userId) {
    return this.tracker.getUserStats(userId);
  }

  /**
   * Get all tracked users with suspicious activity
   * @returns {Array}
   */
  getSuspiciousUsers() {
    const users = this.tracker.getTrackedUsers();
    const suspicious = [];

    for (const userId of users) {
      const stats = this.tracker.getUserStats(userId);
      // Check if any threshold is exceeded
      if (
        stats.denials >= DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD ||
        stats.queries >= DEFAULT_CONFIG.QUERY_COUNT_THRESHOLD ||
        stats.requests >= DEFAULT_CONFIG.RAPID_REQUEST_COUNT ||
        stats.documentAccess >= DEFAULT_CONFIG.BULK_DOCUMENT_COUNT ||
        stats.authFailures >= DEFAULT_CONFIG.AUTH_FAILURE_COUNT ||
        stats.rateLimitViolations >= DEFAULT_CONFIG.RATE_LIMIT_VIOLATION_COUNT ||
        stats.dataVolumeMB >= DEFAULT_CONFIG.EXFILTRATION_DATA_VOLUME_MB
      ) {
        suspicious.push({
          userId,
          stats,
        });
      }
    }

    return suspicious;
  }

  /**
   * Get service statistics
   * @returns {Object}
   */
  getStatistics() {
    return {
      ...this.statistics,
      trackedUsers: this.tracker.getTrackedUsers().length,
      suspiciousUsers: this.getSuspiciousUsers().length,
      activeAlertCooldowns: this.alertHistory.size,
    };
  }

  /**
   * Analyze historical audit logs for suspicious patterns
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeHistoricalLogs(options = {}) {
    const { hours = 24, minAlerts = 1 } = options;
    const auditService = getAuditPersistenceService();

    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      // Query denial logs
      const denials = await auditService.queryLogs({
        action: 'ACCESS_DENIED',
        startDate,
      });

      // Aggregate by user
      const userDenials = new Map();
      for (const log of denials) {
        const count = (userDenials.get(log.userId) || 0) + 1;
        userDenials.set(log.userId, count);
      }

      // Find users with suspicious denial counts
      const suspiciousFromHistory = [];
      for (const [userId, count] of userDenials) {
        if (count >= DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD * 2) {
          // Higher threshold for historical
          suspiciousFromHistory.push({
            userId,
            denialCount: count,
            severity:
              count >= DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD * 5
                ? SEVERITY.CRITICAL
                : count >= DEFAULT_CONFIG.DENIAL_COUNT_THRESHOLD * 3
                  ? SEVERITY.HIGH
                  : SEVERITY.MEDIUM,
          });
        }
      }

      return {
        periodHours: hours,
        totalDenials: denials.length,
        uniqueUsers: userDenials.size,
        suspiciousUsers: suspiciousFromHistory,
        analyzedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.error('Failed to analyze historical logs', { error: error.message });
      return {
        error: error.message,
        periodHours: hours,
      };
    }
  }

  /**
   * Generate Azure Monitor alert configuration
   * Returns a sample alert rule configuration for Azure Monitor
   * @returns {Object}
   */
  getAzureMonitorAlertConfig() {
    return {
      description:
        'Sample Azure Monitor alert configuration for suspicious activity detection',
      metrics: [
        {
          name: 'security.suspicious_activity',
          description: 'Total count of suspicious activity alerts',
          aggregation: 'Count',
          threshold: 1,
          windowSize: 'PT5M',
          frequency: 'PT1M',
        },
        {
          name: 'security.suspicious_activity.critical',
          description: 'Critical severity alerts',
          aggregation: 'Count',
          threshold: 1,
          windowSize: 'PT5M',
          frequency: 'PT1M',
          severity: 0, // Azure Monitor Sev 0 = Critical
        },
        {
          name: 'security.suspicious_activity.high',
          description: 'High severity alerts',
          aggregation: 'Count',
          threshold: 3,
          windowSize: 'PT15M',
          frequency: 'PT5M',
          severity: 1,
        },
      ],
      events: [
        {
          name: 'suspicious_activity',
          query:
            'customEvents | where name == "security.suspicious_activity" | summarize count() by tostring(customDimensions.type), bin(timestamp, 5m)',
        },
      ],
      recommendedActions: [
        'Review user access patterns in audit logs',
        'Check for compromised credentials',
        'Consider temporary account lockout for critical alerts',
        'Investigate IP addresses for geographic anomalies',
      ],
    };
  }

  /**
   * Reset all tracking data (for testing)
   */
  reset() {
    this.tracker.clear();
    this.alertHistory.clear();
    this.statistics = {
      totalAlerts: 0,
      alertsByType: {},
      alertsBySeverity: {},
      suppressedAlerts: 0,
      lastAlertTime: null,
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get the suspicious activity service instance
 * @returns {SuspiciousActivityService}
 */
function getSuspiciousActivityService() {
  if (!instance) {
    instance = new SuspiciousActivityService();
  }
  return instance;
}

module.exports = {
  SuspiciousActivityService,
  getSuspiciousActivityService,
  ACTIVITY_TYPES,
  SEVERITY,
  DEFAULT_CONFIG,
  registerConfigDefinitions,
};
