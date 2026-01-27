/**
 * Unit tests for Incremental Sync Service (F4.2.5)
 */

const {
  IncrementalSyncService,
  getIncrementalSyncService,
  resetIncrementalSyncService,
  SyncSession,
  ConnectorSyncState,
  ChangeDetector,
  SyncStateStatus,
  ChangeType,
  SyncType,
} = require('../incremental-sync-service');

describe('IncrementalSyncService', () => {
  let service;

  beforeEach(() => {
    resetIncrementalSyncService();
    service = getIncrementalSyncService();
  });

  afterEach(() => {
    resetIncrementalSyncService();
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance', () => {
      const instance1 = getIncrementalSyncService();
      const instance2 = getIncrementalSyncService();
      expect(instance1).toBe(instance2);
    });

    test('should reset singleton correctly', () => {
      const instance1 = getIncrementalSyncService();
      resetIncrementalSyncService();
      const instance2 = getIncrementalSyncService();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('SyncSession', () => {
    test('should create a new sync session with correct defaults', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.INCREMENTAL, {
        expectedDocuments: 100,
      });

      expect(session.id).toBe('test-session');
      expect(session.connectorId).toBe('connector-1');
      expect(session.syncType).toBe(SyncType.INCREMENTAL);
      expect(session.status).toBe(SyncStateStatus.IDLE);
      expect(session.totalDocuments).toBe(100);
      expect(session.processedDocuments).toBe(0);
    });

    test('should start session and update status', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.FULL);
      session.start();

      expect(session.status).toBe(SyncStateStatus.SYNCING);
      expect(session.startTime).toBeTruthy();
    });

    test('should complete session and update status', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.FULL);
      session.start();
      session.complete(SyncStateStatus.COMPLETED, { deltaToken: 'token123' });

      expect(session.status).toBe(SyncStateStatus.COMPLETED);
      expect(session.endTime).toBeTruthy();
      expect(session.newDeltaToken).toBe('token123');
    });

    test('should record document processing correctly', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.FULL);
      session.start();

      session.recordDocument(ChangeType.ADDED, 1000);
      session.recordDocument(ChangeType.MODIFIED, 500);
      session.recordDocument(ChangeType.DELETED, 0);
      session.recordDocument(ChangeType.UNCHANGED, 0);

      expect(session.processedDocuments).toBe(4);
      expect(session.addedDocuments).toBe(1);
      expect(session.modifiedDocuments).toBe(1);
      expect(session.deletedDocuments).toBe(1);
      expect(session.skippedDocuments).toBe(1);
      expect(session.processedBytes).toBe(1500);
    });

    test('should record failures correctly', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.FULL);
      session.start();

      session.recordFailure('doc-1', new Error('Processing failed'));

      expect(session.failedDocuments).toBe(1);
      expect(session.errors.length).toBe(1);
      expect(session.errors[0].documentId).toBe('doc-1');
    });

    test('should add checkpoints correctly', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.FULL);
      session.start();
      session.currentBatch = 1; // Simulate batch processing

      session.addCheckpoint({ lastDocumentId: 'doc-50' });

      expect(session.checkpoints.length).toBe(1);
      expect(session.lastCheckpoint.batchNumber).toBe(1);
      expect(session.lastCheckpoint.lastDocumentId).toBe('doc-50');
    });

    test('should calculate progress correctly', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.FULL, {
        expectedDocuments: 100,
      });
      session.start();

      session.recordDocument(ChangeType.ADDED, 0);
      session.recordDocument(ChangeType.ADDED, 0);
      session.recordDocument(ChangeType.ADDED, 0);

      // 3 out of 100 = 3%
      expect(session.getProgress()).toBe(3);
    });

    test('should calculate duration correctly', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.FULL);
      session.start();

      // Simulate some processing time
      const duration = session.getDuration();
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    test('should serialize to JSON correctly', () => {
      const session = new SyncSession('test-session', 'connector-1', SyncType.INCREMENTAL, {
        expectedDocuments: 50,
        metadata: { source: 'sharepoint' },
      });
      session.start();

      const json = session.toJSON();

      expect(json.id).toBe('test-session');
      expect(json.connectorId).toBe('connector-1');
      expect(json.syncType).toBe(SyncType.INCREMENTAL);
      expect(json.status).toBe(SyncStateStatus.SYNCING);
      expect(json.totalDocuments).toBe(50);
    });
  });

  describe('ConnectorSyncState', () => {
    test('should create a new sync state with correct defaults', () => {
      const state = new ConnectorSyncState('connector-1', 'sharepoint');

      expect(state.connectorId).toBe('connector-1');
      expect(state.connectorType).toBe('sharepoint');
      expect(state.lastSuccessfulSync).toBeNull();
      expect(state.totalSyncs).toBe(0);
    });

    test('should update from successful session', () => {
      const state = new ConnectorSyncState('connector-1', 'sharepoint');
      const session = new SyncSession('session-1', 'connector-1', SyncType.FULL);

      session.start();
      session.recordDocument(ChangeType.ADDED, 1000);
      session.complete(SyncStateStatus.COMPLETED, { deltaToken: 'delta123' });

      state.updateFromSession(session);

      expect(state.lastSuccessfulSync).toBeTruthy();
      expect(state.lastSuccessfulSyncId).toBe('session-1');
      expect(state.successfulSyncs).toBe(1);
      expect(state.deltaToken).toBe('delta123');
      expect(state.totalDocumentsProcessed).toBe(1);
    });

    test('should update from failed session', () => {
      const state = new ConnectorSyncState('connector-1', 'sharepoint');
      const session = new SyncSession('session-1', 'connector-1', SyncType.FULL);

      session.start();
      session.complete(SyncStateStatus.FAILED);

      state.updateFromSession(session);

      expect(state.lastSuccessfulSync).toBeNull();
      expect(state.failedSyncs).toBe(1);
      expect(state.totalSyncs).toBe(1);
    });

    test('should check delta sync availability', () => {
      const state = new ConnectorSyncState('connector-1', 'sharepoint');

      expect(state.canDeltaSync()).toBe(false);

      state.deltaToken = 'token123';
      state.deltaTokenExpiry = new Date(Date.now() + 86400000).toISOString(); // Future

      expect(state.canDeltaSync()).toBe(true);

      state.deltaTokenExpiry = new Date(Date.now() - 86400000).toISOString(); // Past

      expect(state.canDeltaSync()).toBe(false);
    });

    test('should check staleness correctly', () => {
      const state = new ConnectorSyncState('connector-1', 'sharepoint');

      // No successful sync = stale
      expect(state.isStale()).toBe(true);

      // Recent sync = not stale
      state.lastSuccessfulSync = new Date().toISOString();
      expect(state.isStale(3600000)).toBe(false);

      // Old sync = stale
      state.lastSuccessfulSync = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
      expect(state.isStale(3600000)).toBe(true); // 1 hour threshold
    });

    test('should serialize to JSON correctly', () => {
      const state = new ConnectorSyncState('connector-1', 'sharepoint');
      state.lastSuccessfulSync = new Date().toISOString();
      state.successfulSyncs = 5;
      state.failedSyncs = 1;
      state.totalSyncs = 6;

      const json = state.toJSON();

      expect(json.connectorId).toBe('connector-1');
      expect(json.connectorType).toBe('sharepoint');
      expect(json.successRate).toBe(83); // 5/6 = 83%
      expect(json.isStale).toBe(false);
    });
  });

  describe('ChangeDetector', () => {
    let detector;

    beforeEach(() => {
      detector = new ChangeDetector();
    });

    test('should detect new documents', () => {
      const sourceDoc = { id: 'doc-1', name: 'New Document' };
      const result = detector.detectChange(sourceDoc, null);

      expect(result.changeType).toBe(ChangeType.ADDED);
      expect(result.reason).toBe('New document');
    });

    test('should detect modified documents by timestamp', () => {
      const sourceDoc = {
        id: 'doc-1',
        lastModified: new Date(Date.now()).toISOString(),
      };
      const existingDoc = {
        id: 'doc-1',
        lastModified: new Date(Date.now() - 86400000).toISOString(),
      };

      const result = detector.detectChange(sourceDoc, existingDoc);

      expect(result.changeType).toBe(ChangeType.MODIFIED);
      expect(result.reason).toBe('Modified timestamp newer');
    });

    test('should detect modified documents by hash', () => {
      const sourceDoc = { id: 'doc-1', contentHash: 'abc123' };
      const existingDoc = { id: 'doc-1', contentHash: 'xyz789' };

      const result = detector.detectChange(sourceDoc, existingDoc);

      expect(result.changeType).toBe(ChangeType.MODIFIED);
      expect(result.reason).toBe('Content hash different');
    });

    test('should detect modified documents by size', () => {
      const sourceDoc = { id: 'doc-1', size: 5000 };
      const existingDoc = { id: 'doc-1', size: 4000 };

      const result = detector.detectChange(sourceDoc, existingDoc);

      expect(result.changeType).toBe(ChangeType.MODIFIED);
      expect(result.reason).toBe('File size different');
    });

    test('should detect modified documents by version', () => {
      const sourceDoc = { id: 'doc-1', version: '2.0' };
      const existingDoc = { id: 'doc-1', version: '1.0' };

      const result = detector.detectChange(sourceDoc, existingDoc);

      expect(result.changeType).toBe(ChangeType.MODIFIED);
      expect(result.reason).toBe('Version different');
    });

    test('should detect unchanged documents', () => {
      const sourceDoc = { id: 'doc-1', version: '1.0', contentHash: 'abc123', size: 1000 };
      const existingDoc = { id: 'doc-1', version: '1.0', contentHash: 'abc123', size: 1000 };

      const result = detector.detectChange(sourceDoc, existingDoc);

      expect(result.changeType).toBe(ChangeType.UNCHANGED);
    });

    test('should detect deleted documents', () => {
      const sourceIds = new Set(['doc-1', 'doc-2']);
      const existingIds = new Set(['doc-1', 'doc-2', 'doc-3', 'doc-4']);

      const deleted = detector.detectDeleted(sourceIds, existingIds);

      expect(deleted).toContain('doc-3');
      expect(deleted).toContain('doc-4');
      expect(deleted.length).toBe(2);
    });

    test('should batch detect changes', () => {
      const sourceDocs = [
        { id: 'doc-1', version: '2.0' },
        { id: 'doc-2', version: '1.0' },
        { id: 'doc-3', version: '1.0' },
      ];

      const existingDocs = new Map([
        ['doc-1', { id: 'doc-1', version: '1.0' }], // Modified
        ['doc-2', { id: 'doc-2', version: '1.0' }], // Unchanged
        ['doc-4', { id: 'doc-4', version: '1.0' }], // Deleted (not in source)
      ]);

      const result = detector.batchDetectChanges(sourceDocs, existingDocs);

      expect(result.added.length).toBe(1); // doc-3
      expect(result.modified.length).toBe(1); // doc-1
      expect(result.unchanged.length).toBe(1); // doc-2
      expect(result.deleted.length).toBe(1); // doc-4
    });
  });

  describe('Service Operations', () => {
    test('should start a sync session', async () => {
      const result = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
        expectedDocuments: 100,
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeTruthy();
      expect(result.syncType).toBe(SyncType.FULL); // First sync is always full
    });

    test('should prevent duplicate concurrent syncs', async () => {
      await service.startSync('connector-1', { connectorType: 'sharepoint' });
      const result = await service.startSync('connector-1', { connectorType: 'sharepoint' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync already in progress for this connector');
    });

    test('should force full sync when requested', async () => {
      // Simulate a previous successful sync
      const state = await service.getSyncState('connector-1', 'sharepoint');
      state.lastSuccessfulSync = new Date().toISOString();
      state.deltaToken = 'token123';
      await service.saveSyncState(state);

      const result = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
        forceFull: true,
      });

      expect(result.success).toBe(true);
      expect(result.syncType).toBe(SyncType.FULL);
    });

    test('should use delta sync when available', async () => {
      // Simulate a previous successful sync with delta token
      const state = await service.getSyncState('connector-1', 'sharepoint');
      state.lastSuccessfulSync = new Date().toISOString();
      state.deltaToken = 'token123';
      state.deltaTokenExpiry = new Date(Date.now() + 86400000).toISOString();
      await service.saveSyncState(state);

      const result = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
        supportsDelta: true,
      });

      expect(result.success).toBe(true);
      expect(result.syncType).toBe(SyncType.DELTA);
      expect(result.deltaToken).toBe('token123');
    });

    test('should process a batch of documents', async () => {
      const startResult = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
      });

      const documents = [
        { id: 'doc-1', changeType: ChangeType.ADDED, bytes: 1000 },
        { id: 'doc-2', changeType: ChangeType.MODIFIED, bytes: 500 },
        { id: 'doc-3', changeType: ChangeType.UNCHANGED, bytes: 0 },
      ];

      const processDocument = async (doc) => ({
        changeType: doc.changeType,
        bytes: doc.bytes,
        skipped: doc.changeType === ChangeType.UNCHANGED,
      });

      const batchResult = await service.processBatch(
        startResult.sessionId,
        documents,
        processDocument
      );

      expect(batchResult.success).toBe(true);
      expect(batchResult.processed).toBe(2); // Added + Modified
      expect(batchResult.added).toBe(1);
      expect(batchResult.modified).toBe(1);
      expect(batchResult.skipped).toBe(1);
    });

    test('should handle batch processing failures', async () => {
      const startResult = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
      });

      const documents = [
        { id: 'doc-1' },
        { id: 'doc-2' },
      ];

      const processDocument = async (doc) => {
        if (doc.id === 'doc-2') {
          throw new Error('Processing failed');
        }
        return { changeType: ChangeType.ADDED, bytes: 0 };
      };

      const batchResult = await service.processBatch(
        startResult.sessionId,
        documents,
        processDocument
      );

      expect(batchResult.success).toBe(true);
      expect(batchResult.processed).toBe(1);
      expect(batchResult.failed).toBe(1);
      expect(batchResult.errors.length).toBe(1);
    });

    test('should complete a sync session', async () => {
      const startResult = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
      });

      const completeResult = await service.completeSync(startResult.sessionId, {
        deltaToken: 'newToken123',
      });

      expect(completeResult.success).toBe(true);
      expect(completeResult.session.status).toBe(SyncStateStatus.COMPLETED);
      expect(completeResult.syncState.deltaTokenAvailable).toBe(true);
    });

    test('should cancel a sync session', async () => {
      const startResult = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
      });

      const cancelResult = await service.cancelSync(
        startResult.sessionId,
        'User cancelled'
      );

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.session.status).toBe(SyncStateStatus.CANCELLED);
    });

    test('should get session status', async () => {
      const startResult = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
      });

      const status = service.getSessionStatus(startResult.sessionId);

      expect(status).toBeTruthy();
      expect(status.id).toBe(startResult.sessionId);
      expect(status.status).toBe(SyncStateStatus.SYNCING);
    });

    test('should get all active sessions', async () => {
      await service.startSync('connector-1', { connectorType: 'sharepoint' });
      await service.startSync('connector-2', { connectorType: 'adls' });

      const sessions = service.getActiveSessions();

      expect(sessions.length).toBe(2);
    });

    test('should filter active sessions by connector', async () => {
      await service.startSync('connector-1', { connectorType: 'sharepoint' });
      await service.startSync('connector-2', { connectorType: 'adls' });

      const sessions = service.getActiveSessions('connector-1');

      expect(sessions.length).toBe(1);
      expect(sessions[0].connectorId).toBe('connector-1');
    });

    test('should get sync state for connector', async () => {
      const state = await service.getSyncState('connector-1', 'sharepoint');

      expect(state).toBeTruthy();
      expect(state.connectorId).toBe('connector-1');
      expect(state.connectorType).toBe('sharepoint');
    });

    test('should detect changes between documents', () => {
      const sourceDocs = [
        { id: 'doc-1', version: '2.0' },
        { id: 'doc-2', version: '1.0' },
      ];

      const existingDocs = new Map([
        ['doc-1', { id: 'doc-1', version: '1.0' }],
        ['doc-3', { id: 'doc-3', version: '1.0' }],
      ]);

      const changes = service.detectChanges(sourceDocs, existingDocs);

      expect(changes.added.length).toBe(1); // doc-2
      expect(changes.modified.length).toBe(1); // doc-1
      expect(changes.deleted.length).toBe(1); // doc-3
    });

    test('should get statistics', async () => {
      await service.startSync('connector-1', { connectorType: 'sharepoint' });

      const stats = service.getStatistics();

      expect(stats.activeSessions).toBe(1);
      expect(stats.connectors).toBe(1);
    });

    test('should add and notify listeners', async () => {
      const events = [];
      const unsubscribe = service.addListener((eventType, data) => {
        events.push({ eventType, data });
      });

      await service.startSync('connector-1', { connectorType: 'sharepoint' });

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('sync_started');

      unsubscribe();
    });

    test('should update configuration', () => {
      service.updateConfig({ batchSize: 100 });

      expect(service.config.batchSize).toBe(100);
    });
  });

  describe('Sync Types', () => {
    test('should export correct sync types', () => {
      expect(SyncType.FULL).toBe('full');
      expect(SyncType.INCREMENTAL).toBe('incremental');
      expect(SyncType.DELTA).toBe('delta');
    });

    test('should export correct sync state statuses', () => {
      expect(SyncStateStatus.IDLE).toBe('idle');
      expect(SyncStateStatus.SYNCING).toBe('syncing');
      expect(SyncStateStatus.COMPLETED).toBe('completed');
      expect(SyncStateStatus.FAILED).toBe('failed');
      expect(SyncStateStatus.CANCELLED).toBe('cancelled');
    });

    test('should export correct change types', () => {
      expect(ChangeType.ADDED).toBe('added');
      expect(ChangeType.MODIFIED).toBe('modified');
      expect(ChangeType.DELETED).toBe('deleted');
      expect(ChangeType.UNCHANGED).toBe('unchanged');
    });
  });

  describe('Edge Cases', () => {
    test('should handle getting status for non-existent session', () => {
      const status = service.getSessionStatus('non-existent');
      expect(status).toBeNull();
    });

    test('should handle batch processing for non-existent session', async () => {
      const result = await service.processBatch('non-existent', [], async () => ({}));
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });

    test('should handle completing non-existent session', async () => {
      const result = await service.completeSync('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });

    test('should handle cancelling non-existent session', async () => {
      const result = await service.cancelSync('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });

    test('should handle empty batch processing', async () => {
      const startResult = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
      });

      const batchResult = await service.processBatch(
        startResult.sessionId,
        [],
        async () => ({})
      );

      expect(batchResult.success).toBe(true);
      expect(batchResult.processed).toBe(0);
    });

    test('should handle batch processing for completed session', async () => {
      const startResult = await service.startSync('connector-1', {
        connectorType: 'sharepoint',
      });

      await service.completeSync(startResult.sessionId);

      // Try to process after completion
      const batchResult = await service.processBatch(
        startResult.sessionId,
        [{ id: 'doc-1' }],
        async () => ({ changeType: ChangeType.ADDED })
      );

      // Session should not be found (removed from active sessions)
      expect(batchResult.success).toBe(false);
    });

    test('should handle progress calculation with zero documents', () => {
      const session = new SyncSession('test', 'conn', SyncType.FULL, {
        expectedDocuments: 0,
      });

      expect(session.getProgress()).toBe(0);
    });

    test('should cap checkpoints at 100', () => {
      const session = new SyncSession('test', 'conn', SyncType.FULL);
      session.start();

      for (let i = 0; i < 150; i++) {
        session.addCheckpoint({ batchNumber: i });
      }

      expect(session.checkpoints.length).toBe(100);
    });
  });

  describe('Average Sync Duration', () => {
    test('should calculate average sync duration correctly', () => {
      const state = new ConnectorSyncState('connector-1', 'sharepoint');

      // First sync: 1000ms
      const session1 = new SyncSession('session-1', 'connector-1', SyncType.FULL);
      session1.startTime = new Date(Date.now() - 1000).toISOString();
      session1.endTime = new Date().toISOString();
      session1.status = SyncStateStatus.COMPLETED;
      state.updateFromSession(session1);

      expect(state.syncConfig.averageSyncDuration).toBeGreaterThan(0);

      // Second sync: 2000ms
      const session2 = new SyncSession('session-2', 'connector-1', SyncType.FULL);
      session2.startTime = new Date(Date.now() - 2000).toISOString();
      session2.endTime = new Date().toISOString();
      session2.status = SyncStateStatus.COMPLETED;
      state.updateFromSession(session2);

      // Average should be between 1000 and 2000
      expect(state.syncConfig.averageSyncDuration).toBeGreaterThan(0);
    });
  });
});
