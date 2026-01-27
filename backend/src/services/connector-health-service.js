/**
 * Connector Health Monitoring Service (F4.2.7)
 *
 * Provides comprehensive health monitoring for external data connectors
 * (SharePoint, ADLS, etc.). Tracks connector status, sync operations,
 * errors, and provides dashboard widgets for operational visibility.
 *
 * Features:
 * - Per-connector health status tracking
 * - Sync operation tracking (start/complete/error)
 * - Error history with time-windowed tracking
 * - Metrics collection (documents processed, sync duration, error rates)
 * - Status change listeners for alerts/notifications
 * - Dashboard widget data generation
 * - Integration with telemetry and audit services
 *
 * @module services/connector-health-service
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');

// Connector status constants
const ConnectorStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown',
  DISCONNECTED: 'disconnected',
};

// Sync status constants
const SyncStatus = {
  IDLE: 'idle',
  RUNNING: 'running',
  SUCCESS: 'success',
  PARTIAL: 'partial', // Some documents failed
  FAILURE: 'failure',
};

// Connector types
const ConnectorType = {
  SHAREPOINT: 'sharepoint',
  ADLS: 'adls',
  BLOB_STORAGE: 'blob_storage',
  LOCAL_FILE: 'local_file',
  CUSTOM: 'custom',
};

// Error severity levels
const ErrorSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

// Default configuration
const DEFAULT_CONFIG = {
  errorWindowMs: parseInt(process.env.CONNECTOR_ERROR_WINDOW_MS) || 3600000, // 1 hour
  maxErrorHistory: parseInt(process.env.CONNECTOR_MAX_ERROR_HISTORY) || 100,
  healthCheckIntervalMs: parseInt(process.env.CONNECTOR_HEALTH_CHECK_INTERVAL_MS) || 60000,
  unhealthyThreshold: parseInt(process.env.CONNECTOR_UNHEALTHY_THRESHOLD) || 5, // errors in window
  degradedThreshold: parseInt(process.env.CONNECTOR_DEGRADED_THRESHOLD) || 2,
  syncTimeoutMs: parseInt(process.env.CONNECTOR_SYNC_TIMEOUT_MS) || 300000, // 5 minutes
  metricsRetentionMs: parseInt(process.env.CONNECTOR_METRICS_RETENTION_MS) || 86400000, // 24 hours
  historySize: parseInt(process.env.CONNECTOR_HISTORY_SIZE) || 50,
};

/**
 * Activity window for tracking errors/events within a time period
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
    this._cleanup();
    this.events.push({
      ...event,
      timestamp: Date.now(),
    });
  }

  /**
   * Get count of events in the window
   * @returns {number}
   */
  count() {
    this._cleanup();
    return this.events.length;
  }

  /**
   * Get all events in the window
   * @returns {Array}
   */
  getEvents() {
    this._cleanup();
    return [...this.events];
  }

  /**
   * Get events by type
   * @param {string} type - Event type
   * @returns {Array}
   */
  getEventsByType(type) {
    this._cleanup();
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Clear all events
   */
  clear() {
    this.events = [];
  }

  /**
   * Remove expired events
   * @private
   */
  _cleanup() {
    const cutoff = Date.now() - this.windowMs;
    this.events = this.events.filter((e) => e.timestamp > cutoff);
  }
}

/**
 * Per-connector state tracker
 */
class ConnectorState {
  constructor(connectorId, connectorType, config) {
    this.connectorId = connectorId;
    this.connectorType = connectorType;
    this.config = config;

    // Status tracking
    this.status = ConnectorStatus.UNKNOWN;
    this.syncStatus = SyncStatus.IDLE;
    this.lastStatusChange = null;
    this.statusMessage = 'Connector initialized';

    // Sync tracking
    this.lastSyncStart = null;
    this.lastSyncEnd = null;
    this.lastSyncDuration = null;
    this.lastSyncResult = null;
    this.currentSyncId = null;

    // Error tracking
    this.errorWindow = new ActivityWindow(config.errorWindowMs);
    this.errorHistory = []; // Full history (capped)
    this.lastError = null;

    // Metrics
    this.metrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      partialSyncs: 0,
      documentsProcessed: 0,
      documentsFailed: 0,
      totalBytesProcessed: 0,
      averageSyncDuration: 0,
      totalSyncDuration: 0,
    };

    // Configuration
    this.connectionConfig = {};
    this.isEnabled = true;
    this.createdAt = new Date().toISOString();
    this.lastHealthCheck = null;
  }

  /**
   * Calculate current status based on error count
   * @returns {string} - Status
   */
  calculateStatus() {
    const errorCount = this.errorWindow.count();

    if (!this.isEnabled) {
      return ConnectorStatus.DISCONNECTED;
    }

    if (errorCount >= this.config.unhealthyThreshold) {
      return ConnectorStatus.UNHEALTHY;
    }

    if (errorCount >= this.config.degradedThreshold) {
      return ConnectorStatus.DEGRADED;
    }

    if (this.lastSyncResult === SyncStatus.SUCCESS || this.lastHealthCheck) {
      return ConnectorStatus.HEALTHY;
    }

    return ConnectorStatus.UNKNOWN;
  }

  /**
   * Add an error to the tracker
   * @param {Object} error - Error details
   */
  addError(error) {
    const errorEntry = {
      type: error.type || 'unknown',
      message: error.message,
      code: error.code,
      severity: error.severity || ErrorSeverity.MEDIUM,
      context: error.context || {},
      timestamp: Date.now(),
    };

    this.errorWindow.add(errorEntry);
    this.errorHistory.push(errorEntry);
    this.lastError = errorEntry;

    // Cap history size
    while (this.errorHistory.length > this.config.maxErrorHistory) {
      this.errorHistory.shift();
    }

    // Recalculate status
    this._updateStatus();
  }

  /**
   * Update the connector status
   * @private
   */
  _updateStatus() {
    const newStatus = this.calculateStatus();
    if (newStatus !== this.status) {
      const oldStatus = this.status;
      this.status = newStatus;
      this.lastStatusChange = new Date().toISOString();
      return { changed: true, oldStatus, newStatus };
    }
    return { changed: false };
  }

  /**
   * Record sync start
   * @param {string} syncId - Unique sync operation ID
   * @param {string} syncType - Type of sync (full/incremental)
   */
  startSync(syncId, syncType = 'full') {
    this.currentSyncId = syncId;
    this.syncStatus = SyncStatus.RUNNING;
    this.lastSyncStart = Date.now();
    this.lastSyncType = syncType;
    this._updateStatus();
  }

  /**
   * Record sync completion
   * @param {Object} result - Sync result
   */
  completeSync(result) {
    const duration = this.lastSyncStart ? Date.now() - this.lastSyncStart : 0;

    this.lastSyncEnd = Date.now();
    this.lastSyncDuration = duration;
    this.lastSyncResult = result.status;
    this.syncStatus = result.status;
    this.currentSyncId = null;

    // Update metrics
    this.metrics.totalSyncs++;
    this.metrics.totalSyncDuration += duration;
    this.metrics.averageSyncDuration = this.metrics.totalSyncDuration / this.metrics.totalSyncs;

    if (result.documentsProcessed) {
      this.metrics.documentsProcessed += result.documentsProcessed;
    }
    if (result.documentsFailed) {
      this.metrics.documentsFailed += result.documentsFailed;
    }
    if (result.bytesProcessed) {
      this.metrics.totalBytesProcessed += result.bytesProcessed;
    }

    switch (result.status) {
      case SyncStatus.SUCCESS:
        this.metrics.successfulSyncs++;
        break;
      case SyncStatus.PARTIAL:
        this.metrics.partialSyncs++;
        break;
      case SyncStatus.FAILURE:
        this.metrics.failedSyncs++;
        break;
    }

    this._updateStatus();

    return {
      duration,
      status: result.status,
    };
  }

  /**
   * Get serializable state
   * @returns {Object}
   */
  toJSON() {
    return {
      connectorId: this.connectorId,
      connectorType: this.connectorType,
      status: this.status,
      syncStatus: this.syncStatus,
      statusMessage: this.statusMessage,
      lastStatusChange: this.lastStatusChange,
      lastSyncStart: this.lastSyncStart ? new Date(this.lastSyncStart).toISOString() : null,
      lastSyncEnd: this.lastSyncEnd ? new Date(this.lastSyncEnd).toISOString() : null,
      lastSyncDuration: this.lastSyncDuration,
      lastSyncResult: this.lastSyncResult,
      lastSyncType: this.lastSyncType,
      errorCount: this.errorWindow.count(),
      lastError: this.lastError,
      metrics: { ...this.metrics },
      isEnabled: this.isEnabled,
      createdAt: this.createdAt,
      lastHealthCheck: this.lastHealthCheck,
    };
  }
}

/**
 * Connector Health Monitoring Service
 */
class ConnectorHealthService {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.connectors = new Map(); // connectorId -> ConnectorState
    this.listeners = new Set(); // Status change listeners
    this.syncHistory = []; // Global sync history
    this.healthCheckInterval = null;
  }

  /**
   * Register a new connector
   * @param {string} connectorId - Unique connector identifier
   * @param {string} connectorType - Type of connector
   * @param {Object} options - Additional options
   * @returns {Object} - Registered connector state
   */
  registerConnector(connectorId, connectorType, options = {}) {
    if (this.connectors.has(connectorId)) {
      log.warn({ connectorId }, 'Connector already registered, updating configuration');
    }

    const state = new ConnectorState(connectorId, connectorType, this.config);

    if (options.connectionConfig) {
      state.connectionConfig = options.connectionConfig;
    }
    if (options.isEnabled !== undefined) {
      state.isEnabled = options.isEnabled;
    }

    this.connectors.set(connectorId, state);

    log.info({ connectorId, connectorType }, 'Connector registered');
    trackEvent('connector_registered', { connectorId, connectorType });

    return state.toJSON();
  }

  /**
   * Unregister a connector
   * @param {string} connectorId - Connector ID
   * @returns {boolean} - True if removed
   */
  unregisterConnector(connectorId) {
    if (this.connectors.delete(connectorId)) {
      log.info({ connectorId }, 'Connector unregistered');
      trackEvent('connector_unregistered', { connectorId });
      return true;
    }
    return false;
  }

  /**
   * Track the start of a sync operation
   * @param {string} connectorId - Connector ID
   * @param {Object} options - Sync options
   * @returns {Object} - Sync tracking info
   */
  trackSyncStart(connectorId, options = {}) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return { success: false, error: 'Connector not registered' };
    }

    const syncId = options.syncId || `sync-${connectorId}-${Date.now()}`;
    const syncType = options.syncType || 'full';

    state.startSync(syncId, syncType);

    // Add to history
    this._addToSyncHistory({
      syncId,
      connectorId,
      connectorType: state.connectorType,
      syncType,
      status: 'started',
      startTime: new Date().toISOString(),
      expectedDocuments: options.expectedDocuments,
    });

    log.info({ connectorId, syncId, syncType }, 'Sync operation started');
    trackEvent('connector_sync_started', { connectorId, syncType });
    trackMetric('connector.sync.started', 1, { connectorId, connectorType: state.connectorType });

    return {
      success: true,
      syncId,
      connectorId,
      startTime: new Date(state.lastSyncStart).toISOString(),
    };
  }

  /**
   * Track the completion of a sync operation
   * @param {string} connectorId - Connector ID
   * @param {Object} result - Sync result
   * @returns {Object} - Completion info
   */
  trackSyncComplete(connectorId, result) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return { success: false, error: 'Connector not registered' };
    }

    const syncResult = state.completeSync({
      status: result.status || SyncStatus.SUCCESS,
      documentsProcessed: result.documentsProcessed || 0,
      documentsFailed: result.documentsFailed || 0,
      bytesProcessed: result.bytesProcessed || 0,
    });

    // Update sync history
    this._updateSyncHistory(state.currentSyncId || `sync-${connectorId}`, {
      status: result.status,
      endTime: new Date().toISOString(),
      duration: syncResult.duration,
      documentsProcessed: result.documentsProcessed,
      documentsFailed: result.documentsFailed,
      errors: result.errors,
    });

    // Track telemetry
    log.info({
      connectorId,
      status: result.status,
      duration: syncResult.duration,
      documentsProcessed: result.documentsProcessed,
    }, 'Sync operation completed');

    trackEvent('connector_sync_completed', {
      connectorId,
      status: result.status,
      documentsProcessed: result.documentsProcessed,
      documentsFailed: result.documentsFailed,
    });

    trackMetric('connector.sync.duration', syncResult.duration, {
      connectorId,
      connectorType: state.connectorType,
      status: result.status,
    });

    trackMetric('connector.sync.documents', result.documentsProcessed || 0, {
      connectorId,
      connectorType: state.connectorType,
    });

    // Notify listeners if status changed
    this._checkAndNotifyStatusChange(state);

    return {
      success: true,
      connectorId,
      duration: syncResult.duration,
      status: result.status,
      metrics: state.metrics,
    };
  }

  /**
   * Track a sync error
   * @param {string} connectorId - Connector ID
   * @param {Object} error - Error details
   * @returns {Object} - Error tracking result
   */
  trackSyncError(connectorId, error) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return { success: false, error: 'Connector not registered' };
    }

    const errorEntry = {
      type: error.type || 'sync_error',
      message: error.message || 'Unknown error',
      code: error.code,
      severity: this._classifyErrorSeverity(error),
      context: {
        documentId: error.documentId,
        syncId: state.currentSyncId,
        phase: error.phase,
        ...error.context,
      },
    };

    const previousStatus = state.status;
    state.addError(errorEntry);

    log.error({ connectorId, error: errorEntry }, 'Connector sync error');

    trackEvent('connector_sync_error', {
      connectorId,
      connectorType: state.connectorType,
      errorType: errorEntry.type,
      errorCode: errorEntry.code,
      severity: errorEntry.severity,
    });

    trackMetric('connector.errors', 1, {
      connectorId,
      connectorType: state.connectorType,
      errorType: errorEntry.type,
    });

    // Notify listeners if status changed
    if (previousStatus !== state.status) {
      this._notifyStatusChange(connectorId, previousStatus, state.status);
    }

    return {
      success: true,
      connectorId,
      errorCount: state.errorWindow.count(),
      currentStatus: state.status,
      severity: errorEntry.severity,
    };
  }

  /**
   * Get the status of a specific connector
   * @param {string} connectorId - Connector ID
   * @returns {Object|null} - Connector status
   */
  getConnectorStatus(connectorId) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return null;
    }
    return state.toJSON();
  }

  /**
   * Get status of all connectors
   * @returns {Object[]} - Array of connector statuses
   */
  getAllConnectorsStatus() {
    const statuses = [];
    for (const [, state] of this.connectors) {
      statuses.push(state.toJSON());
    }
    return statuses;
  }

  /**
   * Get overall health summary
   * @returns {Object} - Health summary
   */
  getHealthSummary() {
    const connectors = this.getAllConnectorsStatus();

    const summary = {
      totalConnectors: connectors.length,
      byStatus: {
        healthy: 0,
        degraded: 0,
        unhealthy: 0,
        unknown: 0,
        disconnected: 0,
      },
      bySyncStatus: {
        idle: 0,
        running: 0,
        success: 0,
        partial: 0,
        failure: 0,
      },
      totalErrorsInWindow: 0,
      activeSyncs: 0,
      issues: [],
    };

    for (const connector of connectors) {
      // Count by status
      const status = connector.status.toLowerCase();
      if (summary.byStatus[status] !== undefined) {
        summary.byStatus[status]++;
      }

      // Count by sync status
      const syncStatus = connector.syncStatus.toLowerCase();
      if (summary.bySyncStatus[syncStatus] !== undefined) {
        summary.bySyncStatus[syncStatus]++;
      }

      // Track errors
      summary.totalErrorsInWindow += connector.errorCount;

      // Track active syncs
      if (connector.syncStatus === SyncStatus.RUNNING) {
        summary.activeSyncs++;
      }

      // Track issues
      if (connector.status === ConnectorStatus.UNHEALTHY) {
        summary.issues.push({
          connectorId: connector.connectorId,
          severity: 'critical',
          message: `Connector is unhealthy with ${connector.errorCount} errors`,
          lastError: connector.lastError,
        });
      } else if (connector.status === ConnectorStatus.DEGRADED) {
        summary.issues.push({
          connectorId: connector.connectorId,
          severity: 'warning',
          message: `Connector is degraded with ${connector.errorCount} errors`,
          lastError: connector.lastError,
        });
      }
    }

    // Calculate overall status
    if (summary.byStatus.unhealthy > 0) {
      summary.overallStatus = ConnectorStatus.UNHEALTHY;
    } else if (summary.byStatus.degraded > 0) {
      summary.overallStatus = ConnectorStatus.DEGRADED;
    } else if (summary.byStatus.healthy > 0) {
      summary.overallStatus = ConnectorStatus.HEALTHY;
    } else {
      summary.overallStatus = ConnectorStatus.UNKNOWN;
    }

    summary.timestamp = new Date().toISOString();

    return summary;
  }

  /**
   * Get error history for a connector
   * @param {string} connectorId - Connector ID
   * @param {number} limit - Maximum errors to return
   * @returns {Object[]} - Error history
   */
  getErrorHistory(connectorId, limit = 20) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return [];
    }

    return state.errorHistory.slice(-limit).reverse();
  }

  /**
   * Get sync history (global or per connector)
   * @param {string} connectorId - Optional connector ID filter
   * @param {number} limit - Maximum entries to return
   * @returns {Object[]} - Sync history
   */
  getSyncHistory(connectorId = null, limit = 20) {
    let history = this.syncHistory;

    if (connectorId) {
      history = history.filter((h) => h.connectorId === connectorId);
    }

    return history.slice(-limit).reverse();
  }

  /**
   * Analyze error patterns for a connector
   * @param {string} connectorId - Connector ID
   * @returns {Object} - Error pattern analysis
   */
  analyzeErrorPatterns(connectorId) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return null;
    }

    const errors = state.errorWindow.getEvents();
    const analysis = {
      totalErrors: errors.length,
      byType: {},
      bySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      trending: [], // Most common recent errors
      recommendations: [],
    };

    // Count by type
    for (const error of errors) {
      const type = error.type || 'unknown';
      if (!analysis.byType[type]) {
        analysis.byType[type] = { count: 0, lastOccurrence: null };
      }
      analysis.byType[type].count++;
      analysis.byType[type].lastOccurrence = error.timestamp;

      // Count by severity
      const severity = error.severity || 'medium';
      if (analysis.bySeverity[severity] !== undefined) {
        analysis.bySeverity[severity]++;
      }
    }

    // Sort by frequency for trending
    analysis.trending = Object.entries(analysis.byType)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([type, data]) => ({
        type,
        count: data.count,
        lastOccurrence: new Date(data.lastOccurrence).toISOString(),
      }));

    // Generate recommendations
    if (analysis.bySeverity.critical > 0) {
      analysis.recommendations.push({
        priority: 'critical',
        action: 'Investigate critical errors immediately',
        details: `${analysis.bySeverity.critical} critical errors detected`,
      });
    }

    if (analysis.byType['auth_error']?.count > 2) {
      analysis.recommendations.push({
        priority: 'high',
        action: 'Check connector authentication credentials',
        details: 'Multiple authentication failures detected',
      });
    }

    if (analysis.byType['timeout']?.count > 3) {
      analysis.recommendations.push({
        priority: 'medium',
        action: 'Consider increasing timeout settings or checking network connectivity',
        details: 'Multiple timeout errors detected',
      });
    }

    return analysis;
  }

  /**
   * Get metrics for a connector
   * @param {string} connectorId - Connector ID
   * @returns {Object|null} - Metrics
   */
  getConnectorMetrics(connectorId) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return null;
    }

    return {
      connectorId,
      connectorType: state.connectorType,
      ...state.metrics,
      errorRate: state.metrics.totalSyncs > 0
        ? (state.metrics.failedSyncs / state.metrics.totalSyncs) * 100
        : 0,
      successRate: state.metrics.totalSyncs > 0
        ? (state.metrics.successfulSyncs / state.metrics.totalSyncs) * 100
        : 0,
      currentErrorsInWindow: state.errorWindow.count(),
    };
  }

  /**
   * Get dashboard widget data
   * @returns {Object} - Dashboard widget data
   */
  getDashboardWidget() {
    const summary = this.getHealthSummary();
    const connectors = this.getAllConnectorsStatus();

    // Generate sparkline data for recent activity
    const recentSyncs = this.syncHistory.slice(-24);
    const sparklineData = recentSyncs.map((sync) => ({
      timestamp: sync.startTime,
      success: sync.status === SyncStatus.SUCCESS ? 1 : 0,
      failure: sync.status === SyncStatus.FAILURE ? 1 : 0,
    }));

    return {
      summary: {
        status: summary.overallStatus,
        totalConnectors: summary.totalConnectors,
        healthyCounts: summary.byStatus,
        activeSyncs: summary.activeSyncs,
        totalErrors: summary.totalErrorsInWindow,
      },
      connectors: connectors.map((c) => ({
        id: c.connectorId,
        type: c.connectorType,
        status: c.status,
        syncStatus: c.syncStatus,
        lastSync: c.lastSyncEnd,
        errorCount: c.errorCount,
      })),
      recentActivity: sparklineData,
      issues: summary.issues.slice(0, 5),
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Add a status change listener
   * @param {Function} listener - Callback(connectorId, oldStatus, newStatus)
   */
  addStatusChangeListener(listener) {
    this.listeners.add(listener);
  }

  /**
   * Remove a status change listener
   * @param {Function} listener - Listener to remove
   */
  removeStatusChangeListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * Perform a health check on a connector
   * @param {string} connectorId - Connector ID
   * @param {Function} checkFn - Health check function (async, returns { healthy, message })
   * @returns {Promise<Object>} - Health check result
   */
  async performHealthCheck(connectorId, checkFn) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return { success: false, error: 'Connector not registered' };
    }

    const startTime = Date.now();

    try {
      const result = await Promise.race([
        checkFn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timed out')), this.config.syncTimeoutMs)
        ),
      ]);

      const duration = Date.now() - startTime;
      state.lastHealthCheck = new Date().toISOString();

      if (result.healthy) {
        const previousStatus = state.status;
        state.status = ConnectorStatus.HEALTHY;
        state.statusMessage = result.message || 'Health check passed';

        if (previousStatus !== state.status) {
          this._notifyStatusChange(connectorId, previousStatus, state.status);
        }
      } else {
        this.trackSyncError(connectorId, {
          type: 'health_check_failed',
          message: result.message || 'Health check failed',
          severity: ErrorSeverity.HIGH,
        });
      }

      trackMetric('connector.health_check.duration', duration, {
        connectorId,
        connectorType: state.connectorType,
        healthy: result.healthy,
      });

      return {
        success: true,
        healthy: result.healthy,
        message: result.message,
        duration,
        connectorStatus: state.status,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.trackSyncError(connectorId, {
        type: 'health_check_error',
        message: error.message,
        severity: ErrorSeverity.HIGH,
      });

      return {
        success: false,
        healthy: false,
        message: error.message,
        duration,
        connectorStatus: state.status,
      };
    }
  }

  /**
   * Enable/disable a connector
   * @param {string} connectorId - Connector ID
   * @param {boolean} enabled - Enable or disable
   * @returns {Object} - Result
   */
  setConnectorEnabled(connectorId, enabled) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return { success: false, error: 'Connector not registered' };
    }

    const previousStatus = state.status;
    state.isEnabled = enabled;
    state._updateStatus();

    log.info({ connectorId, enabled }, 'Connector enabled state changed');
    trackEvent('connector_enabled_changed', { connectorId, enabled });

    if (previousStatus !== state.status) {
      this._notifyStatusChange(connectorId, previousStatus, state.status);
    }

    return {
      success: true,
      connectorId,
      enabled,
      status: state.status,
    };
  }

  /**
   * Reset metrics for a connector
   * @param {string} connectorId - Connector ID
   * @returns {Object} - Result
   */
  resetConnectorMetrics(connectorId) {
    const state = this._getConnectorState(connectorId);
    if (!state) {
      return { success: false, error: 'Connector not registered' };
    }

    state.metrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      partialSyncs: 0,
      documentsProcessed: 0,
      documentsFailed: 0,
      totalBytesProcessed: 0,
      averageSyncDuration: 0,
      totalSyncDuration: 0,
    };

    state.errorWindow.clear();
    state.errorHistory = [];
    state.lastError = null;
    state._updateStatus();

    log.info({ connectorId }, 'Connector metrics reset');

    return {
      success: true,
      connectorId,
      status: state.status,
    };
  }

  /**
   * Get configuration
   * @returns {Object}
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration updates
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };

    // Update all connector states with new config
    for (const [, state] of this.connectors) {
      state.config = this.config;
      state.errorWindow = new ActivityWindow(this.config.errorWindowMs);
    }

    log.info({ updates }, 'Connector health config updated');
  }

  /**
   * Get connector state (internal)
   * @private
   */
  _getConnectorState(connectorId) {
    return this.connectors.get(connectorId);
  }

  /**
   * Classify error severity
   * @private
   */
  _classifyErrorSeverity(error) {
    if (error.severity) {
      return error.severity;
    }

    const message = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();

    // Critical errors
    if (
      message.includes('authentication failed') ||
      message.includes('unauthorized') ||
      code.includes('auth')
    ) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity
    if (
      message.includes('connection refused') ||
      message.includes('not found') ||
      message.includes('permission denied')
    ) {
      return ErrorSeverity.HIGH;
    }

    // Low severity
    if (
      message.includes('retry') ||
      message.includes('rate limit') ||
      message.includes('throttl')
    ) {
      return ErrorSeverity.LOW;
    }

    return ErrorSeverity.MEDIUM;
  }

  /**
   * Add entry to sync history
   * @private
   */
  _addToSyncHistory(entry) {
    this.syncHistory.push(entry);

    // Cap history size
    while (this.syncHistory.length > this.config.historySize) {
      this.syncHistory.shift();
    }
  }

  /**
   * Update sync history entry
   * @private
   */
  _updateSyncHistory(syncId, updates) {
    const entry = this.syncHistory.find((h) => h.syncId === syncId);
    if (entry) {
      Object.assign(entry, updates);
    }
  }

  /**
   * Check and notify status change
   * @private
   */
  _checkAndNotifyStatusChange(state) {
    const statusChange = state._updateStatus();
    if (statusChange.changed) {
      this._notifyStatusChange(state.connectorId, statusChange.oldStatus, statusChange.newStatus);
    }
  }

  /**
   * Notify listeners of status change
   * @private
   */
  _notifyStatusChange(connectorId, oldStatus, newStatus) {
    log.info({ connectorId, oldStatus, newStatus }, 'Connector status changed');

    trackEvent('connector_status_changed', {
      connectorId,
      oldStatus,
      newStatus,
    });

    for (const listener of this.listeners) {
      try {
        listener(connectorId, oldStatus, newStatus);
      } catch (error) {
        log.warn({ error: error.message }, 'Connector status listener error');
      }
    }
  }

  /**
   * Reset service (for testing)
   */
  reset() {
    this.connectors.clear();
    this.listeners.clear();
    this.syncHistory = [];
    this.config = { ...DEFAULT_CONFIG };

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton ConnectorHealthService instance
 * @returns {ConnectorHealthService}
 */
function getConnectorHealthService() {
  if (!instance) {
    instance = new ConnectorHealthService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
function resetConnectorHealthService() {
  if (instance) {
    instance.reset();
  }
  instance = null;
}

module.exports = {
  ConnectorHealthService,
  getConnectorHealthService,
  resetConnectorHealthService,
  ConnectorStatus,
  SyncStatus,
  ConnectorType,
  ErrorSeverity,
};
