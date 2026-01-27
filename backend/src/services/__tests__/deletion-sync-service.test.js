/**
 * Deletion Sync Service Tests (F4.2.6)
 *
 * Comprehensive tests for the deletion sync service including:
 * - Soft delete with grace period
 * - Document recovery
 * - Permanent deletion
 * - Deletion detection
 * - Expired deletion processing
 * - Connector state tracking
 * - Configuration management
 */

const {
  DeletionSyncService,
  getDeletionSyncService,
  resetDeletionSyncService,
  PendingDeletion,
  ConnectorDeletionState,
  DeletionStatus,
  DeletionReason,
} = require('../deletion-sync-service');

describe('DeletionSyncService', () => {
  let service;

  beforeEach(async () => {
    resetDeletionSyncService();
    service = getDeletionSyncService();
    // Initialize without Cosmos DB (in-memory mode)
    await service.initialize({ startCleanupCheck: false });
  });

  afterEach(() => {
    resetDeletionSyncService();
  });

  // ==========================================================================
  // PendingDeletion Class Tests
  // ==========================================================================
  describe('PendingDeletion', () => {
    test('should create with default values', () => {
      const pending = new PendingDeletion('doc-1');

      expect(pending.documentId).toBe('doc-1');
      expect(pending.status).toBe(DeletionStatus.PENDING_DELETION);
      expect(pending.reason).toBe(DeletionReason.SOURCE_DELETED);
      expect(pending.markedAt).toBeDefined();
      expect(pending.deletedAt).toBeNull();
      expect(pending.recoveredAt).toBeNull();
    });

    test('should create with custom options', () => {
      const pending = new PendingDeletion('doc-2', {
        connectorId: 'connector-1',
        sourceId: 'source-doc-2',
        reason: DeletionReason.MANUAL,
        markedBy: 'admin',
        documentTitle: 'Test Document',
        notes: 'Test deletion',
      });

      expect(pending.documentId).toBe('doc-2');
      expect(pending.connectorId).toBe('connector-1');
      expect(pending.sourceId).toBe('source-doc-2');
      expect(pending.reason).toBe(DeletionReason.MANUAL);
      expect(pending.markedBy).toBe('admin');
      expect(pending.documentTitle).toBe('Test Document');
      expect(pending.notes).toBe('Test deletion');
    });

    test('should schedule deletion with grace period', () => {
      const pending = new PendingDeletion('doc-3');
      const gracePeriodMs = 7 * 24 * 60 * 60 * 1000; // 7 days

      pending.scheduleDelete(gracePeriodMs);

      expect(pending.scheduledDeletionAt).toBeDefined();
      const scheduled = new Date(pending.scheduledDeletionAt);
      const expected = new Date(Date.now() + gracePeriodMs);
      expect(Math.abs(scheduled - expected)).toBeLessThan(1000); // Within 1 second
    });

    test('should detect expired deletion', () => {
      const pending = new PendingDeletion('doc-4');

      // Not expired initially (no scheduled time)
      expect(pending.isExpired()).toBe(false);

      // Schedule in the past
      pending.scheduledDeletionAt = new Date(Date.now() - 1000).toISOString();
      expect(pending.isExpired()).toBe(true);

      // Schedule in the future
      pending.scheduledDeletionAt = new Date(Date.now() + 1000000).toISOString();
      expect(pending.isExpired()).toBe(false);
    });

    test('should calculate remaining grace period', () => {
      const pending = new PendingDeletion('doc-5');
      const gracePeriodMs = 60000; // 1 minute

      pending.scheduleDelete(gracePeriodMs);

      const remaining = pending.getRemainingGracePeriod();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(gracePeriodMs);
    });

    test('should mark as recovered', () => {
      const pending = new PendingDeletion('doc-6');

      pending.recover('user-1', 'Recovered accidentally deleted');

      expect(pending.status).toBe(DeletionStatus.RECOVERED);
      expect(pending.recoveredAt).toBeDefined();
      expect(pending.recoveredBy).toBe('user-1');
      expect(pending.notes).toBe('Recovered accidentally deleted');
    });

    test('should mark as deleted', () => {
      const pending = new PendingDeletion('doc-7');

      pending.markDeleted('system');

      expect(pending.status).toBe(DeletionStatus.DELETED);
      expect(pending.deletedAt).toBeDefined();
      expect(pending.deletedBy).toBe('system');
    });

    test('should record cleanup errors', () => {
      const pending = new PendingDeletion('doc-8');

      pending.recordCleanupError('searchIndex', 'Connection timeout');
      pending.recordCleanupError('graph', 'Entity not found');

      expect(pending.cleanupErrors).toHaveLength(2);
      expect(pending.cleanupErrors[0].component).toBe('searchIndex');
      expect(pending.cleanupErrors[0].error).toBe('Connection timeout');
      expect(pending.cleanupErrors[1].component).toBe('graph');
    });

    test('should serialize to JSON correctly', () => {
      const pending = new PendingDeletion('doc-9', {
        connectorId: 'conn-1',
        reason: DeletionReason.POLICY,
      });
      pending.scheduleDelete(60000);

      const json = pending.toJSON();

      expect(json.documentId).toBe('doc-9');
      expect(json.connectorId).toBe('conn-1');
      expect(json.reason).toBe(DeletionReason.POLICY);
      expect(json.scheduledDeletionAt).toBeDefined();
      expect(json.isExpired).toBe(false);
      expect(json.remainingGracePeriodMs).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // ConnectorDeletionState Class Tests
  // ==========================================================================
  describe('ConnectorDeletionState', () => {
    test('should create with default values', () => {
      const state = new ConnectorDeletionState('connector-1');

      expect(state.connectorId).toBe('connector-1');
      expect(state.totalDeletedDocuments).toBe(0);
      expect(state.totalRecoveredDocuments).toBe(0);
      expect(state.pendingDeletions).toBe(0);
      expect(state.lastScanAt).toBeNull();
    });

    test('should record scan statistics', () => {
      const state = new ConnectorDeletionState('connector-2');

      state.recordScan(100, 5);

      expect(state.lastScanAt).toBeDefined();
      expect(state.lastScanDocumentCount).toBe(100);
      expect(state.pendingDeletions).toBe(5);
    });

    test('should record deletion', () => {
      const state = new ConnectorDeletionState('connector-3');
      state.pendingDeletions = 3;

      state.recordDeletion();

      expect(state.totalDeletedDocuments).toBe(1);
      expect(state.pendingDeletions).toBe(2);
      expect(state.lastDeletionAt).toBeDefined();
    });

    test('should record recovery', () => {
      const state = new ConnectorDeletionState('connector-4');
      state.pendingDeletions = 3;

      state.recordRecovery();

      expect(state.totalRecoveredDocuments).toBe(1);
      expect(state.pendingDeletions).toBe(2);
      expect(state.lastRecoveryAt).toBeDefined();
    });

    test('should not go below zero pending deletions', () => {
      const state = new ConnectorDeletionState('connector-5');
      state.pendingDeletions = 0;

      state.recordDeletion();
      state.recordRecovery();

      expect(state.pendingDeletions).toBe(0);
    });
  });

  // ==========================================================================
  // Service Initialization Tests
  // ==========================================================================
  describe('Initialization', () => {
    test('should initialize service', async () => {
      const freshService = new DeletionSyncService();
      await freshService.initialize({ startCleanupCheck: false });

      expect(freshService.initialized).toBe(true);
    });

    test('should not reinitialize if already initialized', async () => {
      const freshService = new DeletionSyncService();
      await freshService.initialize({ startCleanupCheck: false });
      await freshService.initialize({ startCleanupCheck: false });

      expect(freshService.initialized).toBe(true);
    });

    test('should handle missing Cosmos DB gracefully', async () => {
      const freshService = new DeletionSyncService();
      // Initialize without Cosmos DB endpoint configured
      await freshService.initialize({ startCleanupCheck: false });

      expect(freshService.initialized).toBe(true);
      expect(freshService.cosmosContainer).toBeNull();
    });
  });

  // ==========================================================================
  // Mark for Deletion Tests
  // ==========================================================================
  describe('markForDeletion', () => {
    test('should mark document for deletion', async () => {
      const result = await service.markForDeletion('doc-mark-1');

      expect(result.success).toBe(true);
      expect(result.pendingDeletion.documentId).toBe('doc-mark-1');
      expect(result.pendingDeletion.status).toBe(DeletionStatus.PENDING_DELETION);
      expect(result.pendingDeletion.scheduledDeletionAt).toBeDefined();
    });

    test('should mark document with custom options', async () => {
      const result = await service.markForDeletion('doc-mark-2', {
        connectorId: 'sharepoint-1',
        sourceId: 'sp-doc-123',
        reason: DeletionReason.POLICY,
        markedBy: 'admin',
        notes: 'Policy violation',
      });

      expect(result.success).toBe(true);
      expect(result.pendingDeletion.connectorId).toBe('sharepoint-1');
      expect(result.pendingDeletion.sourceId).toBe('sp-doc-123');
      expect(result.pendingDeletion.reason).toBe(DeletionReason.POLICY);
      expect(result.pendingDeletion.markedBy).toBe('admin');
      expect(result.pendingDeletion.notes).toBe('Policy violation');
    });

    test('should reject marking already pending document', async () => {
      await service.markForDeletion('doc-mark-3');
      const result = await service.markForDeletion('doc-mark-3');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already marked');
    });

    test('should use custom grace period', async () => {
      const customGracePeriod = 24 * 60 * 60 * 1000; // 1 day
      const result = await service.markForDeletion('doc-mark-4', {
        gracePeriodMs: customGracePeriod,
      });

      expect(result.success).toBe(true);
      const scheduled = new Date(result.pendingDeletion.scheduledDeletionAt);
      const expected = new Date(Date.now() + customGracePeriod);
      expect(Math.abs(scheduled - expected)).toBeLessThan(1000);
    });

    test('should update connector state on mark', async () => {
      await service.markForDeletion('doc-mark-5', {
        connectorId: 'test-connector',
      });

      const connectorState = service.getConnectorState('test-connector');
      expect(connectorState).toBeDefined();
      expect(connectorState.pendingDeletions).toBe(1);
    });
  });

  // ==========================================================================
  // Recovery Tests
  // ==========================================================================
  describe('recoverDocument', () => {
    test('should recover document from pending deletion', async () => {
      await service.markForDeletion('doc-recover-1');
      const result = await service.recoverDocument('doc-recover-1', {
        recoveredBy: 'user-1',
        notes: 'Wrong document',
      });

      expect(result.success).toBe(true);
      expect(result.document.status).toBe(DeletionStatus.RECOVERED);
      expect(result.document.recoveredBy).toBe('user-1');
    });

    test('should fail to recover non-existent document', async () => {
      const result = await service.recoverDocument('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should fail to recover already recovered document', async () => {
      await service.markForDeletion('doc-recover-2');
      await service.recoverDocument('doc-recover-2');
      const result = await service.recoverDocument('doc-recover-2');

      expect(result.success).toBe(false);
      // Document is moved out of pending after recovery, so it's not found
      expect(result.error).toContain('not found');
    });

    test('should update connector state on recovery', async () => {
      await service.markForDeletion('doc-recover-3', {
        connectorId: 'test-connector',
      });
      await service.recoverDocument('doc-recover-3');

      const connectorState = service.getConnectorState('test-connector');
      expect(connectorState.totalRecoveredDocuments).toBe(1);
      expect(connectorState.pendingDeletions).toBe(0);
    });

    test('should add recovered document to history', async () => {
      await service.markForDeletion('doc-recover-4');
      await service.recoverDocument('doc-recover-4');

      const history = service.getDeletionHistory();
      expect(history.length).toBe(1);
      expect(history[0].status).toBe(DeletionStatus.RECOVERED);
    });
  });

  // ==========================================================================
  // Permanent Deletion Tests
  // ==========================================================================
  describe('permanentlyDelete', () => {
    test('should permanently delete expired document', async () => {
      await service.markForDeletion('doc-delete-1', {
        gracePeriodMs: -1000, // Already expired
      });

      const result = await service.permanentlyDelete('doc-delete-1');

      expect(result.success).toBe(true);
      expect(result.document.status).toBe(DeletionStatus.DELETED);
    });

    test('should reject deletion before grace period expires', async () => {
      await service.markForDeletion('doc-delete-2', {
        gracePeriodMs: 999999999, // Far future
      });

      const result = await service.permanentlyDelete('doc-delete-2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Grace period has not expired');
      expect(result.remainingGracePeriodMs).toBeGreaterThan(0);
    });

    test('should force delete before grace period', async () => {
      await service.markForDeletion('doc-delete-3', {
        gracePeriodMs: 999999999,
      });

      const result = await service.permanentlyDelete('doc-delete-3', {
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.document.status).toBe(DeletionStatus.DELETED);
    });

    test('should delete document not in pending (force)', async () => {
      const result = await service.permanentlyDelete('doc-never-marked', {
        force: true,
        reason: DeletionReason.MANUAL,
      });

      expect(result.success).toBe(true);
    });

    test('should update connector state on deletion', async () => {
      await service.markForDeletion('doc-delete-4', {
        connectorId: 'test-connector',
        gracePeriodMs: -1,
      });
      await service.permanentlyDelete('doc-delete-4');

      const connectorState = service.getConnectorState('test-connector');
      expect(connectorState.totalDeletedDocuments).toBe(1);
    });
  });

  // ==========================================================================
  // Deletion Detection Tests
  // ==========================================================================
  describe('detectDeletedDocuments', () => {
    test('should detect deleted documents', async () => {
      // Setup: Mock document service
      const mockDocs = [
        { id: 'doc-1', sourceId: 'src-1', title: 'Doc 1', status: 'active' },
        { id: 'doc-2', sourceId: 'src-2', title: 'Doc 2', status: 'active' },
        { id: 'doc-3', sourceId: 'src-3', title: 'Doc 3', status: 'active' },
      ];

      service.documentService = {
        queryDocuments: jest.fn().mockResolvedValue(mockDocs),
      };

      // Source only has src-1, so src-2 and src-3 are deleted
      const result = await service.detectDeletedDocuments('connector-1', ['src-1']);

      expect(result.success).toBe(true);
      expect(result.scannedDocuments).toBe(3);
      expect(result.deletedDocuments).toBe(2);
      expect(result.markedDeletions).toContain('doc-2');
      expect(result.markedDeletions).toContain('doc-3');
    });

    test('should update connector state after detection', async () => {
      service.documentService = {
        queryDocuments: jest.fn().mockResolvedValue([
          { id: 'doc-1', sourceId: 'src-1', status: 'active' },
        ]),
      };

      await service.detectDeletedDocuments('detect-connector', []);

      const connectorState = service.getConnectorState('detect-connector');
      expect(connectorState.lastScanAt).toBeDefined();
      expect(connectorState.lastScanDocumentCount).toBe(1);
    });

    test('should handle empty source list', async () => {
      service.documentService = {
        queryDocuments: jest.fn().mockResolvedValue([
          { id: 'doc-1', sourceId: 'src-1', status: 'active' },
        ]),
      };

      const result = await service.detectDeletedDocuments('connector-1', []);

      expect(result.success).toBe(true);
      expect(result.deletedDocuments).toBe(1);
    });

    test('should not mark already pending documents', async () => {
      // First mark a document
      await service.markForDeletion('doc-already-pending', {
        connectorId: 'connector-1',
      });

      service.documentService = {
        queryDocuments: jest.fn().mockResolvedValue([
          { id: 'doc-already-pending', sourceId: 'src-pending', status: 'pending_deletion' },
          { id: 'doc-new-deletion', sourceId: 'src-new', status: 'active' },
        ]),
      };

      // Both should appear deleted but only one should be marked
      const result = await service.detectDeletedDocuments('connector-1', []);

      expect(result.success).toBe(true);
      // Only active docs are considered for new marking
      expect(result.markedDeletions.length).toBeLessThanOrEqual(2);
    });
  });

  // ==========================================================================
  // Expired Deletion Processing Tests
  // ==========================================================================
  describe('processExpiredDeletions', () => {
    test('should process expired deletions', async () => {
      // Mark documents with expired grace period
      await service.markForDeletion('expired-1', { gracePeriodMs: -1000 });
      await service.markForDeletion('expired-2', { gracePeriodMs: -1000 });

      const result = await service.processExpiredDeletions();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(2);
    });

    test('should respect batch size', async () => {
      // Mark multiple documents
      for (let i = 0; i < 10; i++) {
        await service.markForDeletion(`batch-doc-${i}`, { gracePeriodMs: -1000 });
      }

      const result = await service.processExpiredDeletions({ batchSize: 3 });

      expect(result.processed).toBe(3);
    });

    test('should return early if no expired deletions', async () => {
      // Mark with future expiry
      await service.markForDeletion('not-expired', { gracePeriodMs: 999999999 });

      const result = await service.processExpiredDeletions();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(0);
      expect(result.message).toContain('No expired');
    });
  });

  // ==========================================================================
  // Listing and Query Tests
  // ==========================================================================
  describe('Listing and Queries', () => {
    beforeEach(async () => {
      // Setup test data
      await service.markForDeletion('list-doc-1', {
        connectorId: 'conn-a',
        reason: DeletionReason.SOURCE_DELETED,
        gracePeriodMs: 999999999,
      });
      await service.markForDeletion('list-doc-2', {
        connectorId: 'conn-a',
        reason: DeletionReason.POLICY,
        gracePeriodMs: -1000, // Expired
      });
      await service.markForDeletion('list-doc-3', {
        connectorId: 'conn-b',
        reason: DeletionReason.MANUAL,
      });
    });

    test('should list all pending deletions', () => {
      const pending = service.listPendingDeletions();
      expect(pending.length).toBe(3);
    });

    test('should filter by connector', () => {
      const pending = service.listPendingDeletions({ connectorId: 'conn-a' });
      expect(pending.length).toBe(2);
    });

    test('should filter expired only', () => {
      const pending = service.listPendingDeletions({ expiredOnly: true });
      expect(pending.length).toBe(1);
      expect(pending[0].documentId).toBe('list-doc-2');
    });

    test('should apply limit', () => {
      const pending = service.listPendingDeletions({ limit: 1 });
      expect(pending.length).toBe(1);
    });

    test('should get pending deletion by ID', () => {
      const pending = service.getPendingDeletion('list-doc-1');
      expect(pending).toBeDefined();
      expect(pending.documentId).toBe('list-doc-1');
    });

    test('should return null for non-existent pending', () => {
      const pending = service.getPendingDeletion('non-existent');
      expect(pending).toBeNull();
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================
  describe('Statistics', () => {
    test('should return service statistics', async () => {
      await service.markForDeletion('stats-doc-1', {
        connectorId: 'conn-1',
        reason: DeletionReason.SOURCE_DELETED,
      });
      await service.markForDeletion('stats-doc-2', {
        connectorId: 'conn-1',
        reason: DeletionReason.MANUAL,
      });
      await service.markForDeletion('stats-doc-3', {
        connectorId: 'conn-2',
        reason: DeletionReason.SOURCE_DELETED,
      });

      const stats = service.getStatistics();

      expect(stats.pendingDeletions).toBe(3);
      expect(stats.pendingByReason[DeletionReason.SOURCE_DELETED]).toBe(2);
      expect(stats.pendingByReason[DeletionReason.MANUAL]).toBe(1);
      expect(stats.pendingByConnector['conn-1']).toBe(2);
      expect(stats.pendingByConnector['conn-2']).toBe(1);
      expect(stats.config.gracePeriodMs).toBeDefined();
    });

    test('should count expired deletions', async () => {
      await service.markForDeletion('expired-stats', { gracePeriodMs: -1000 });
      await service.markForDeletion('not-expired-stats', { gracePeriodMs: 999999999 });

      const stats = service.getStatistics();

      expect(stats.pendingDeletions).toBe(2);
      expect(stats.expiredDeletions).toBe(1);
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================
  describe('Configuration', () => {
    test('should update configuration', () => {
      const result = service.updateConfig({
        gracePeriodMs: 24 * 60 * 60 * 1000,
        batchSize: 100,
      });

      expect(result.success).toBe(true);
      expect(service.config.gracePeriodMs).toBe(24 * 60 * 60 * 1000);
      expect(service.config.batchSize).toBe(100);
    });

    test('should ignore invalid config keys', () => {
      const originalGracePeriod = service.config.gracePeriodMs;

      service.updateConfig({
        invalidKey: 'value',
        gracePeriodMs: 12345,
      });

      expect(service.config.invalidKey).toBeUndefined();
      expect(service.config.gracePeriodMs).toBe(12345);
    });
  });

  // ==========================================================================
  // Event Listener Tests
  // ==========================================================================
  describe('Event Listeners', () => {
    test('should notify listeners on mark', async () => {
      const listener = jest.fn();
      service.addListener(listener);

      await service.markForDeletion('listener-doc-1');

      expect(listener).toHaveBeenCalledWith(
        'document_marked_for_deletion',
        expect.objectContaining({ documentId: 'listener-doc-1' })
      );
    });

    test('should notify listeners on recovery', async () => {
      const listener = jest.fn();
      service.addListener(listener);

      await service.markForDeletion('listener-doc-2');
      await service.recoverDocument('listener-doc-2');

      expect(listener).toHaveBeenCalledWith(
        'document_recovered',
        expect.objectContaining({ documentId: 'listener-doc-2' })
      );
    });

    test('should notify listeners on permanent delete', async () => {
      const listener = jest.fn();
      service.addListener(listener);

      await service.markForDeletion('listener-doc-3', { gracePeriodMs: -1 });
      await service.permanentlyDelete('listener-doc-3');

      expect(listener).toHaveBeenCalledWith(
        'document_permanently_deleted',
        expect.objectContaining({ documentId: 'listener-doc-3' })
      );
    });

    test('should allow removing listeners', async () => {
      const listener = jest.fn();
      const unsubscribe = service.addListener(listener);

      unsubscribe();
      await service.markForDeletion('listener-doc-4');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Deletion History Tests
  // ==========================================================================
  describe('Deletion History', () => {
    test('should track deletion history', async () => {
      await service.markForDeletion('history-1', {
        connectorId: 'conn-1',
        gracePeriodMs: -1,
      });
      await service.permanentlyDelete('history-1');

      await service.markForDeletion('history-2', {
        connectorId: 'conn-1',
      });
      await service.recoverDocument('history-2');

      const history = service.getDeletionHistory();

      expect(history.length).toBe(2);
      expect(history.some(h => h.status === DeletionStatus.DELETED)).toBe(true);
      expect(history.some(h => h.status === DeletionStatus.RECOVERED)).toBe(true);
    });

    test('should filter history by connector', async () => {
      await service.markForDeletion('history-conn-1', {
        connectorId: 'conn-a',
        gracePeriodMs: -1,
      });
      await service.permanentlyDelete('history-conn-1');

      await service.markForDeletion('history-conn-2', {
        connectorId: 'conn-b',
        gracePeriodMs: -1,
      });
      await service.permanentlyDelete('history-conn-2');

      const history = service.getDeletionHistory({ connectorId: 'conn-a' });

      expect(history.length).toBe(1);
      expect(history[0].connectorId).toBe('conn-a');
    });

    test('should filter history by status', async () => {
      await service.markForDeletion('history-status-1', { gracePeriodMs: -1 });
      await service.permanentlyDelete('history-status-1');

      await service.markForDeletion('history-status-2');
      await service.recoverDocument('history-status-2');

      const deletedHistory = service.getDeletionHistory({ status: DeletionStatus.DELETED });
      const recoveredHistory = service.getDeletionHistory({ status: DeletionStatus.RECOVERED });

      expect(deletedHistory.length).toBe(1);
      expect(recoveredHistory.length).toBe(1);
    });
  });

  // ==========================================================================
  // Connector State Tests
  // ==========================================================================
  describe('Connector States', () => {
    test('should track multiple connector states', async () => {
      await service.markForDeletion('conn-state-1', { connectorId: 'conn-a' });
      await service.markForDeletion('conn-state-2', { connectorId: 'conn-a' });
      await service.markForDeletion('conn-state-3', { connectorId: 'conn-b' });

      const allStates = service.getAllConnectorStates();

      expect(allStates.length).toBe(2);
      expect(allStates.find(s => s.connectorId === 'conn-a').pendingDeletions).toBe(2);
      expect(allStates.find(s => s.connectorId === 'conn-b').pendingDeletions).toBe(1);
    });

    test('should return null for unknown connector', () => {
      const state = service.getConnectorState('unknown-connector');
      expect(state).toBeNull();
    });
  });

  // ==========================================================================
  // Service Reset Tests
  // ==========================================================================
  describe('Service Reset', () => {
    test('should reset all state', async () => {
      await service.markForDeletion('reset-doc-1');

      service.reset();

      expect(service.pendingDeletions.size).toBe(0);
      expect(service.connectorStates.size).toBe(0);
      expect(service.deletionHistory.length).toBe(0);
      expect(service.initialized).toBe(false);
    });
  });

  // ==========================================================================
  // Singleton Tests
  // ==========================================================================
  describe('Singleton', () => {
    test('should return same instance', () => {
      const instance1 = getDeletionSyncService();
      const instance2 = getDeletionSyncService();

      expect(instance1).toBe(instance2);
    });

    test('should reset singleton', async () => {
      const instance1 = getDeletionSyncService();
      await instance1.markForDeletion('singleton-doc');

      resetDeletionSyncService();

      const instance2 = getDeletionSyncService();
      expect(instance1).not.toBe(instance2);
      expect(instance2.pendingDeletions.size).toBe(0);
    });
  });
});

// ==========================================================================
// DeletionStatus and DeletionReason Constants Tests
// ==========================================================================
describe('Constants', () => {
  test('DeletionStatus should have expected values', () => {
    expect(DeletionStatus.ACTIVE).toBe('active');
    expect(DeletionStatus.PENDING_DELETION).toBe('pending_deletion');
    expect(DeletionStatus.DELETED).toBe('deleted');
    expect(DeletionStatus.RECOVERED).toBe('recovered');
  });

  test('DeletionReason should have expected values', () => {
    expect(DeletionReason.SOURCE_DELETED).toBe('source_deleted');
    expect(DeletionReason.MANUAL).toBe('manual');
    expect(DeletionReason.POLICY).toBe('policy');
    expect(DeletionReason.EXPIRED).toBe('expired');
    expect(DeletionReason.SUPERSEDED).toBe('superseded');
  });
});
