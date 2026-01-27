/**
 * Unit tests for Connector Health Monitoring Service (F4.2.7)
 */

const {
  ConnectorHealthService,
  getConnectorHealthService,
  resetConnectorHealthService,
  ConnectorStatus,
  SyncStatus,
  ConnectorType,
  ErrorSeverity,
} = require('../connector-health-service');

describe('ConnectorHealthService', () => {
  let service;

  beforeEach(() => {
    resetConnectorHealthService();
    service = getConnectorHealthService();
  });

  afterEach(() => {
    resetConnectorHealthService();
  });

  describe('Singleton pattern', () => {
    it('should return the same instance', () => {
      const service1 = getConnectorHealthService();
      const service2 = getConnectorHealthService();
      expect(service1).toBe(service2);
    });

    it('should reset singleton correctly', () => {
      const service1 = getConnectorHealthService();
      service1.registerConnector('test-1', ConnectorType.SHAREPOINT);
      expect(service1.getAllConnectorsStatus().length).toBe(1);

      resetConnectorHealthService();
      const service2 = getConnectorHealthService();
      expect(service2.getAllConnectorsStatus().length).toBe(0);
    });
  });

  describe('Connector registration', () => {
    it('should register a connector', () => {
      const result = service.registerConnector('sp-site-1', ConnectorType.SHAREPOINT);

      expect(result.connectorId).toBe('sp-site-1');
      expect(result.connectorType).toBe(ConnectorType.SHAREPOINT);
      expect(result.status).toBe(ConnectorStatus.UNKNOWN);
      expect(result.syncStatus).toBe(SyncStatus.IDLE);
      expect(result.isEnabled).toBe(true);
    });

    it('should register with custom options', () => {
      const result = service.registerConnector('adls-1', ConnectorType.ADLS, {
        connectionConfig: { accountName: 'myaccount' },
        isEnabled: false,
      });

      expect(result.connectorId).toBe('adls-1');
      expect(result.isEnabled).toBe(false);
    });

    it('should update existing connector when re-registering', () => {
      service.registerConnector('sp-1', ConnectorType.SHAREPOINT, { isEnabled: true });
      service.registerConnector('sp-1', ConnectorType.SHAREPOINT, { isEnabled: false });

      const status = service.getConnectorStatus('sp-1');
      expect(status.isEnabled).toBe(false);
    });

    it('should unregister a connector', () => {
      service.registerConnector('sp-1', ConnectorType.SHAREPOINT);
      expect(service.getAllConnectorsStatus().length).toBe(1);

      const removed = service.unregisterConnector('sp-1');
      expect(removed).toBe(true);
      expect(service.getAllConnectorsStatus().length).toBe(0);
    });

    it('should return false when unregistering non-existent connector', () => {
      const removed = service.unregisterConnector('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('Status tracking', () => {
    beforeEach(() => {
      service.registerConnector('test-connector', ConnectorType.SHAREPOINT);
    });

    it('should return null for non-existent connector', () => {
      const status = service.getConnectorStatus('non-existent');
      expect(status).toBeNull();
    });

    it('should get connector status', () => {
      const status = service.getConnectorStatus('test-connector');

      expect(status).not.toBeNull();
      expect(status.connectorId).toBe('test-connector');
      expect(status.connectorType).toBe(ConnectorType.SHAREPOINT);
    });

    it('should list all connectors', () => {
      service.registerConnector('conn-2', ConnectorType.ADLS);
      service.registerConnector('conn-3', ConnectorType.BLOB_STORAGE);

      const connectors = service.getAllConnectorsStatus();
      expect(connectors.length).toBe(3);
    });
  });

  describe('Sync tracking', () => {
    beforeEach(() => {
      service.registerConnector('sync-test', ConnectorType.SHAREPOINT);
    });

    it('should track sync start', () => {
      const result = service.trackSyncStart('sync-test', {
        syncType: 'full',
        expectedDocuments: 100,
      });

      expect(result.success).toBe(true);
      expect(result.syncId).toBeDefined();

      const status = service.getConnectorStatus('sync-test');
      expect(status.syncStatus).toBe(SyncStatus.RUNNING);
    });

    it('should fail for non-registered connector', () => {
      const result = service.trackSyncStart('non-existent', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connector not registered');
    });

    it('should track sync completion with success', () => {
      service.trackSyncStart('sync-test', { syncType: 'full' });

      const result = service.trackSyncComplete('sync-test', {
        status: SyncStatus.SUCCESS,
        documentsProcessed: 50,
        documentsFailed: 0,
        bytesProcessed: 1024000,
      });

      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      const status = service.getConnectorStatus('sync-test');
      expect(status.syncStatus).toBe(SyncStatus.SUCCESS);
      expect(status.metrics.totalSyncs).toBe(1);
      expect(status.metrics.successfulSyncs).toBe(1);
      expect(status.metrics.documentsProcessed).toBe(50);
    });

    it('should track partial sync', () => {
      service.trackSyncStart('sync-test', { syncType: 'full' });

      service.trackSyncComplete('sync-test', {
        status: SyncStatus.PARTIAL,
        documentsProcessed: 45,
        documentsFailed: 5,
      });

      const status = service.getConnectorStatus('sync-test');
      expect(status.syncStatus).toBe(SyncStatus.PARTIAL);
      expect(status.metrics.partialSyncs).toBe(1);
      expect(status.metrics.documentsFailed).toBe(5);
    });

    it('should track failed sync', () => {
      service.trackSyncStart('sync-test', { syncType: 'full' });

      service.trackSyncComplete('sync-test', {
        status: SyncStatus.FAILURE,
        documentsProcessed: 0,
        documentsFailed: 100,
      });

      const status = service.getConnectorStatus('sync-test');
      expect(status.syncStatus).toBe(SyncStatus.FAILURE);
      expect(status.metrics.failedSyncs).toBe(1);
    });

    it('should calculate average sync duration', () => {
      // First sync
      service.trackSyncStart('sync-test', {});
      service.trackSyncComplete('sync-test', { status: SyncStatus.SUCCESS });

      // Second sync
      service.trackSyncStart('sync-test', {});
      service.trackSyncComplete('sync-test', { status: SyncStatus.SUCCESS });

      const status = service.getConnectorStatus('sync-test');
      expect(status.metrics.totalSyncs).toBe(2);
      expect(status.metrics.averageSyncDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error tracking', () => {
    beforeEach(() => {
      service.registerConnector('error-test', ConnectorType.SHAREPOINT);
    });

    it('should track sync errors', () => {
      const result = service.trackSyncError('error-test', {
        type: 'connection_error',
        message: 'Failed to connect to SharePoint',
        code: 'ERR_CONNECTION',
      });

      expect(result.success).toBe(true);
      expect(result.errorCount).toBe(1);

      const status = service.getConnectorStatus('error-test');
      expect(status.errorCount).toBe(1);
      expect(status.lastError).not.toBeNull();
      expect(status.lastError.type).toBe('connection_error');
    });

    it('should classify error severity', () => {
      // Authentication error - should be critical
      service.trackSyncError('error-test', {
        message: 'Authentication failed for user',
      });

      let status = service.getConnectorStatus('error-test');
      expect(status.lastError.severity).toBe(ErrorSeverity.CRITICAL);

      // Connection refused - should be high
      service.trackSyncError('error-test', {
        message: 'Connection refused by server',
      });

      status = service.getConnectorStatus('error-test');
      expect(status.lastError.severity).toBe(ErrorSeverity.HIGH);

      // Rate limit - should be low
      service.trackSyncError('error-test', {
        message: 'Request throttled, please retry',
      });

      status = service.getConnectorStatus('error-test');
      expect(status.lastError.severity).toBe(ErrorSeverity.LOW);
    });

    it('should change status based on error count', () => {
      let status = service.getConnectorStatus('error-test');
      expect(status.status).toBe(ConnectorStatus.UNKNOWN);

      // Add errors to trigger degraded status (default threshold: 2)
      service.trackSyncError('error-test', { message: 'Error 1' });
      service.trackSyncError('error-test', { message: 'Error 2' });

      status = service.getConnectorStatus('error-test');
      expect(status.status).toBe(ConnectorStatus.DEGRADED);

      // Add more errors to trigger unhealthy status (default threshold: 5)
      service.trackSyncError('error-test', { message: 'Error 3' });
      service.trackSyncError('error-test', { message: 'Error 4' });
      service.trackSyncError('error-test', { message: 'Error 5' });

      status = service.getConnectorStatus('error-test');
      expect(status.status).toBe(ConnectorStatus.UNHEALTHY);
    });

    it('should return error for non-registered connector', () => {
      const result = service.trackSyncError('non-existent', {
        message: 'Some error',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connector not registered');
    });

    it('should get error history', () => {
      service.trackSyncError('error-test', { message: 'Error 1' });
      service.trackSyncError('error-test', { message: 'Error 2' });
      service.trackSyncError('error-test', { message: 'Error 3' });

      const errors = service.getErrorHistory('error-test', 10);
      expect(errors.length).toBe(3);
      // History should be reverse chronological
      expect(errors[0].message).toBe('Error 3');
      expect(errors[2].message).toBe('Error 1');
    });

    it('should return empty array for non-existent connector', () => {
      const errors = service.getErrorHistory('non-existent', 10);
      expect(errors).toEqual([]);
    });
  });

  describe('Error pattern analysis', () => {
    beforeEach(() => {
      service.registerConnector('analysis-test', ConnectorType.SHAREPOINT);
    });

    it('should analyze error patterns', () => {
      service.trackSyncError('analysis-test', { type: 'auth_error', message: 'Auth failed' });
      service.trackSyncError('analysis-test', { type: 'auth_error', message: 'Auth failed again' });
      service.trackSyncError('analysis-test', { type: 'timeout', message: 'Request timeout' });
      service.trackSyncError('analysis-test', { type: 'auth_error', message: 'Auth failed once more' });

      const analysis = service.analyzeErrorPatterns('analysis-test');

      expect(analysis.totalErrors).toBe(4);
      expect(analysis.byType['auth_error'].count).toBe(3);
      expect(analysis.byType['timeout'].count).toBe(1);
      expect(analysis.trending[0].type).toBe('auth_error');
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });

    it('should provide recommendations for auth errors', () => {
      service.trackSyncError('analysis-test', { type: 'auth_error', message: 'Auth failed' });
      service.trackSyncError('analysis-test', { type: 'auth_error', message: 'Auth failed' });
      service.trackSyncError('analysis-test', { type: 'auth_error', message: 'Auth failed' });

      const analysis = service.analyzeErrorPatterns('analysis-test');

      const authRecommendation = analysis.recommendations.find(
        (r) => r.action.includes('authentication')
      );
      expect(authRecommendation).toBeDefined();
    });

    it('should return null for non-existent connector', () => {
      const analysis = service.analyzeErrorPatterns('non-existent');
      expect(analysis).toBeNull();
    });
  });

  describe('Health summary', () => {
    it('should return empty summary with no connectors', () => {
      const summary = service.getHealthSummary();

      expect(summary.totalConnectors).toBe(0);
      expect(summary.overallStatus).toBe(ConnectorStatus.UNKNOWN);
    });

    it('should calculate overall healthy status', () => {
      service.registerConnector('conn-1', ConnectorType.SHAREPOINT);
      service.registerConnector('conn-2', ConnectorType.ADLS);

      // Simulate successful syncs to make them healthy
      service.trackSyncStart('conn-1', {});
      service.trackSyncComplete('conn-1', { status: SyncStatus.SUCCESS });

      service.trackSyncStart('conn-2', {});
      service.trackSyncComplete('conn-2', { status: SyncStatus.SUCCESS });

      const summary = service.getHealthSummary();

      expect(summary.totalConnectors).toBe(2);
      expect(summary.byStatus.healthy).toBe(2);
      expect(summary.overallStatus).toBe(ConnectorStatus.HEALTHY);
      expect(summary.issues.length).toBe(0);
    });

    it('should detect unhealthy connectors', () => {
      service.registerConnector('unhealthy-conn', ConnectorType.SHAREPOINT);

      // Add enough errors to make it unhealthy
      for (let i = 0; i < 5; i++) {
        service.trackSyncError('unhealthy-conn', { message: `Error ${i}` });
      }

      const summary = service.getHealthSummary();

      expect(summary.byStatus.unhealthy).toBe(1);
      expect(summary.overallStatus).toBe(ConnectorStatus.UNHEALTHY);
      expect(summary.issues.length).toBe(1);
      expect(summary.issues[0].severity).toBe('critical');
    });

    it('should detect degraded connectors', () => {
      service.registerConnector('degraded-conn', ConnectorType.SHAREPOINT);

      // Add enough errors to make it degraded but not unhealthy
      service.trackSyncError('degraded-conn', { message: 'Error 1' });
      service.trackSyncError('degraded-conn', { message: 'Error 2' });

      const summary = service.getHealthSummary();

      expect(summary.byStatus.degraded).toBe(1);
      expect(summary.overallStatus).toBe(ConnectorStatus.DEGRADED);
      expect(summary.issues.length).toBe(1);
      expect(summary.issues[0].severity).toBe('warning');
    });

    it('should track active syncs', () => {
      service.registerConnector('sync-1', ConnectorType.SHAREPOINT);
      service.registerConnector('sync-2', ConnectorType.ADLS);

      service.trackSyncStart('sync-1', {});
      service.trackSyncStart('sync-2', {});

      const summary = service.getHealthSummary();
      expect(summary.activeSyncs).toBe(2);
      expect(summary.bySyncStatus.running).toBe(2);
    });
  });

  describe('Metrics', () => {
    beforeEach(() => {
      service.registerConnector('metrics-test', ConnectorType.SHAREPOINT);
    });

    it('should get connector metrics', () => {
      service.trackSyncStart('metrics-test', {});
      service.trackSyncComplete('metrics-test', {
        status: SyncStatus.SUCCESS,
        documentsProcessed: 100,
      });

      const metrics = service.getConnectorMetrics('metrics-test');

      expect(metrics.connectorId).toBe('metrics-test');
      expect(metrics.connectorType).toBe(ConnectorType.SHAREPOINT);
      expect(metrics.totalSyncs).toBe(1);
      expect(metrics.documentsProcessed).toBe(100);
      expect(metrics.successRate).toBe(100);
      expect(metrics.errorRate).toBe(0);
    });

    it('should calculate error rate', () => {
      // 2 successful, 2 failed
      service.trackSyncStart('metrics-test', {});
      service.trackSyncComplete('metrics-test', { status: SyncStatus.SUCCESS });

      service.trackSyncStart('metrics-test', {});
      service.trackSyncComplete('metrics-test', { status: SyncStatus.SUCCESS });

      service.trackSyncStart('metrics-test', {});
      service.trackSyncComplete('metrics-test', { status: SyncStatus.FAILURE });

      service.trackSyncStart('metrics-test', {});
      service.trackSyncComplete('metrics-test', { status: SyncStatus.FAILURE });

      const metrics = service.getConnectorMetrics('metrics-test');

      expect(metrics.totalSyncs).toBe(4);
      expect(metrics.successRate).toBe(50);
      expect(metrics.errorRate).toBe(50);
    });

    it('should reset metrics', () => {
      service.trackSyncStart('metrics-test', {});
      service.trackSyncComplete('metrics-test', {
        status: SyncStatus.SUCCESS,
        documentsProcessed: 100,
      });

      service.trackSyncError('metrics-test', { message: 'Test error' });

      let metrics = service.getConnectorMetrics('metrics-test');
      expect(metrics.totalSyncs).toBe(1);
      expect(metrics.currentErrorsInWindow).toBe(1);

      const result = service.resetConnectorMetrics('metrics-test');
      expect(result.success).toBe(true);

      metrics = service.getConnectorMetrics('metrics-test');
      expect(metrics.totalSyncs).toBe(0);
      expect(metrics.currentErrorsInWindow).toBe(0);
    });

    it('should return null for non-existent connector', () => {
      const metrics = service.getConnectorMetrics('non-existent');
      expect(metrics).toBeNull();
    });
  });

  describe('Sync history', () => {
    beforeEach(() => {
      service.registerConnector('history-test-1', ConnectorType.SHAREPOINT);
      service.registerConnector('history-test-2', ConnectorType.ADLS);
    });

    it('should track sync history', () => {
      service.trackSyncStart('history-test-1', { syncType: 'full' });
      service.trackSyncComplete('history-test-1', { status: SyncStatus.SUCCESS });

      const history = service.getSyncHistory(null, 10);
      expect(history.length).toBe(1);
      expect(history[0].connectorId).toBe('history-test-1');
      expect(history[0].syncType).toBe('full');
    });

    it('should filter history by connector', () => {
      service.trackSyncStart('history-test-1', {});
      service.trackSyncComplete('history-test-1', { status: SyncStatus.SUCCESS });

      service.trackSyncStart('history-test-2', {});
      service.trackSyncComplete('history-test-2', { status: SyncStatus.SUCCESS });

      const history = service.getSyncHistory('history-test-1', 10);
      expect(history.length).toBe(1);
      expect(history[0].connectorId).toBe('history-test-1');
    });

    it('should limit history entries', () => {
      for (let i = 0; i < 10; i++) {
        service.trackSyncStart('history-test-1', {});
        service.trackSyncComplete('history-test-1', { status: SyncStatus.SUCCESS });
      }

      const history = service.getSyncHistory('history-test-1', 5);
      expect(history.length).toBe(5);
    });
  });

  describe('Enable/disable connector', () => {
    beforeEach(() => {
      service.registerConnector('enable-test', ConnectorType.SHAREPOINT);
    });

    it('should disable a connector', () => {
      const result = service.setConnectorEnabled('enable-test', false);

      expect(result.success).toBe(true);
      expect(result.enabled).toBe(false);
      expect(result.status).toBe(ConnectorStatus.DISCONNECTED);
    });

    it('should re-enable a connector', () => {
      service.setConnectorEnabled('enable-test', false);
      const result = service.setConnectorEnabled('enable-test', true);

      expect(result.success).toBe(true);
      expect(result.enabled).toBe(true);
    });

    it('should fail for non-existent connector', () => {
      const result = service.setConnectorEnabled('non-existent', true);
      expect(result.success).toBe(false);
    });
  });

  describe('Dashboard widget', () => {
    it('should generate dashboard widget data', () => {
      service.registerConnector('dash-1', ConnectorType.SHAREPOINT);
      service.registerConnector('dash-2', ConnectorType.ADLS);

      service.trackSyncStart('dash-1', {});
      service.trackSyncComplete('dash-1', { status: SyncStatus.SUCCESS });

      service.trackSyncError('dash-2', { message: 'Error' });
      service.trackSyncError('dash-2', { message: 'Error' });

      const widget = service.getDashboardWidget();

      expect(widget.summary.totalConnectors).toBe(2);
      expect(widget.connectors.length).toBe(2);
      expect(widget.recentActivity).toBeDefined();
      expect(widget.issues).toBeDefined();
      expect(widget.lastUpdated).toBeDefined();
    });
  });

  describe('Status change listeners', () => {
    it('should notify listeners on status change', (done) => {
      service.registerConnector('listener-test', ConnectorType.SHAREPOINT);

      const listener = (connectorId, oldStatus, newStatus) => {
        expect(connectorId).toBe('listener-test');
        expect(oldStatus).toBe(ConnectorStatus.UNKNOWN);
        expect(newStatus).toBe(ConnectorStatus.DEGRADED);
        done();
      };

      service.addStatusChangeListener(listener);

      // Add errors to trigger status change
      service.trackSyncError('listener-test', { message: 'Error 1' });
      service.trackSyncError('listener-test', { message: 'Error 2' });
    });

    it('should remove listeners', () => {
      service.registerConnector('listener-test-2', ConnectorType.SHAREPOINT);

      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      service.addStatusChangeListener(listener);
      service.removeStatusChangeListener(listener);

      service.trackSyncError('listener-test-2', { message: 'Error 1' });
      service.trackSyncError('listener-test-2', { message: 'Error 2' });

      expect(callCount).toBe(0);
    });
  });

  describe('Health check', () => {
    beforeEach(() => {
      service.registerConnector('healthcheck-test', ConnectorType.SHAREPOINT);
    });

    it('should perform health check successfully', async () => {
      const checkFn = async () => ({
        healthy: true,
        message: 'Connection successful',
      });

      const result = await service.performHealthCheck('healthcheck-test', checkFn);

      expect(result.success).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.connectorStatus).toBe(ConnectorStatus.HEALTHY);
    });

    it('should handle failed health check', async () => {
      const checkFn = async () => ({
        healthy: false,
        message: 'Connection failed',
      });

      const result = await service.performHealthCheck('healthcheck-test', checkFn);

      expect(result.success).toBe(true);
      expect(result.healthy).toBe(false);
    });

    it('should handle health check errors', async () => {
      const checkFn = async () => {
        throw new Error('Network error');
      };

      const result = await service.performHealthCheck('healthcheck-test', checkFn);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Network error');
    });

    it('should return error for non-existent connector', async () => {
      const checkFn = async () => ({ healthy: true });
      const result = await service.performHealthCheck('non-existent', checkFn);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connector not registered');
    });
  });

  describe('Configuration', () => {
    it('should get configuration', () => {
      const config = service.getConfig();

      expect(config.errorWindowMs).toBeDefined();
      expect(config.unhealthyThreshold).toBeDefined();
      expect(config.degradedThreshold).toBeDefined();
    });

    it('should update configuration', () => {
      service.updateConfig({
        unhealthyThreshold: 10,
        degradedThreshold: 5,
      });

      const config = service.getConfig();
      expect(config.unhealthyThreshold).toBe(10);
      expect(config.degradedThreshold).toBe(5);
    });
  });

  describe('Constants export', () => {
    it('should export ConnectorStatus', () => {
      expect(ConnectorStatus.HEALTHY).toBe('healthy');
      expect(ConnectorStatus.DEGRADED).toBe('degraded');
      expect(ConnectorStatus.UNHEALTHY).toBe('unhealthy');
      expect(ConnectorStatus.UNKNOWN).toBe('unknown');
      expect(ConnectorStatus.DISCONNECTED).toBe('disconnected');
    });

    it('should export SyncStatus', () => {
      expect(SyncStatus.IDLE).toBe('idle');
      expect(SyncStatus.RUNNING).toBe('running');
      expect(SyncStatus.SUCCESS).toBe('success');
      expect(SyncStatus.PARTIAL).toBe('partial');
      expect(SyncStatus.FAILURE).toBe('failure');
    });

    it('should export ConnectorType', () => {
      expect(ConnectorType.SHAREPOINT).toBe('sharepoint');
      expect(ConnectorType.ADLS).toBe('adls');
      expect(ConnectorType.BLOB_STORAGE).toBe('blob_storage');
      expect(ConnectorType.LOCAL_FILE).toBe('local_file');
      expect(ConnectorType.CUSTOM).toBe('custom');
    });

    it('should export ErrorSeverity', () => {
      expect(ErrorSeverity.LOW).toBe('low');
      expect(ErrorSeverity.MEDIUM).toBe('medium');
      expect(ErrorSeverity.HIGH).toBe('high');
      expect(ErrorSeverity.CRITICAL).toBe('critical');
    });
  });
});
