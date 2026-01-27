/**
 * Incremental Sync Service (F4.2.5)
 *
 * Provides incremental document synchronization capabilities for external connectors.
 * Tracks sync state, detects changes, and enables efficient delta syncing.
 *
 * Features:
 * - Sync state persistence in Cosmos DB
 * - Last sync timestamp tracking per connector
 * - Change detection (new, modified, deleted documents)
 * - Delta token support for APIs that provide them
 * - Checkpoint-based resumability
 * - Integration with Connector Health Service
 * - Batch processing with progress tracking
 *
 * @module services/incremental-sync-service
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');

// Sync state status
const SyncStateStatus = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// Change types
const ChangeType = {
  ADDED: 'added',
  MODIFIED: 'modified',
  DELETED: 'deleted',
  UNCHANGED: 'unchanged',
};

// Sync types
const SyncType = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
  DELTA: 'delta',
};

// Default configuration
const DEFAULT_CONFIG = {
  batchSize: parseInt(process.env.INCREMENTAL_SYNC_BATCH_SIZE) || 50,
  checkpointIntervalMs: parseInt(process.env.INCREMENTAL_SYNC_CHECKPOINT_INTERVAL_MS) || 30000,
  maxRetries: parseInt(process.env.INCREMENTAL_SYNC_MAX_RETRIES) || 3,
  retryDelayMs: parseInt(process.env.INCREMENTAL_SYNC_RETRY_DELAY_MS) || 5000,
  staleThresholdMs: parseInt(process.env.INCREMENTAL_SYNC_STALE_THRESHOLD_MS) || 3600000, // 1 hour
  historyRetentionDays: parseInt(process.env.INCREMENTAL_SYNC_HISTORY_RETENTION_DAYS) || 30,
  maxConcurrentSyncs: parseInt(process.env.INCREMENTAL_SYNC_MAX_CONCURRENT) || 3,
};

/**
 * Sync session state
 */
class SyncSession {
  constructor(sessionId, connectorId, syncType, options = {}) {
    this.id = sessionId;
    this.connectorId = connectorId;
    this.syncType = syncType;
    this.status = SyncStateStatus.IDLE;

    // Timing
    this.startTime = null;
    this.endTime = null;
    this.lastCheckpoint = null;

    // Progress tracking
    this.totalDocuments = options.expectedDocuments || 0;
    this.processedDocuments = 0;
    this.addedDocuments = 0;
    this.modifiedDocuments = 0;
    this.deletedDocuments = 0;
    this.failedDocuments = 0;
    this.skippedDocuments = 0;

    // Bytes tracking
    this.totalBytes = 0;
    this.processedBytes = 0;

    // Batches
    this.currentBatch = 0;
    this.totalBatches = 0;

    // Checkpoints for resumability
    this.checkpoints = [];
    this.lastProcessedId = null;
    this.lastProcessedTimestamp = null;

    // Delta token (for APIs that support it)
    this.previousDeltaToken = options.deltaToken || null;
    this.newDeltaToken = null;

    // Errors
    this.errors = [];
    this.warningsCount = 0;

    // Metadata
    this.metadata = options.metadata || {};
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Start the sync session
   */
  start() {
    this.status = SyncStateStatus.SYNCING;
    this.startTime = new Date().toISOString();
    this.updatedAt = this.startTime;
  }

  /**
   * Complete the sync session
   * @param {string} status - Final status
   * @param {Object} result - Completion result
   */
  complete(status = SyncStateStatus.COMPLETED, result = {}) {
    this.status = status;
    this.endTime = new Date().toISOString();
    this.updatedAt = this.endTime;

    if (result.deltaToken) {
      this.newDeltaToken = result.deltaToken;
    }
    if (result.errors) {
      this.errors = this.errors.concat(result.errors);
    }
  }

  /**
   * Add a checkpoint
   * @param {Object} checkpoint - Checkpoint data
   */
  addCheckpoint(checkpoint) {
    this.checkpoints.push({
      ...checkpoint,
      timestamp: new Date().toISOString(),
      batchNumber: this.currentBatch,
      processedCount: this.processedDocuments,
    });
    this.lastCheckpoint = this.checkpoints[this.checkpoints.length - 1];
    this.updatedAt = new Date().toISOString();

    // Keep last 100 checkpoints
    if (this.checkpoints.length > 100) {
      this.checkpoints = this.checkpoints.slice(-100);
    }
  }

  /**
   * Record document processing
   * @param {string} changeType - Type of change (added, modified, deleted)
   * @param {number} bytes - Bytes processed
   */
  recordDocument(changeType, bytes = 0) {
    this.processedDocuments++;
    this.processedBytes += bytes;

    switch (changeType) {
      case ChangeType.ADDED:
        this.addedDocuments++;
        break;
      case ChangeType.MODIFIED:
        this.modifiedDocuments++;
        break;
      case ChangeType.DELETED:
        this.deletedDocuments++;
        break;
      case ChangeType.UNCHANGED:
        this.skippedDocuments++;
        break;
    }

    this.updatedAt = new Date().toISOString();
  }

  /**
   * Record a failed document
   * @param {string} documentId - Document ID
   * @param {Error} error - Error
   */
  recordFailure(documentId, error) {
    this.failedDocuments++;
    this.errors.push({
      documentId,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Get progress percentage
   * @returns {number}
   */
  getProgress() {
    if (this.totalDocuments === 0) {
      return 0;
    }
    return Math.round((this.processedDocuments / this.totalDocuments) * 100);
  }

  /**
   * Get duration in milliseconds
   * @returns {number}
   */
  getDuration() {
    if (!this.startTime) {
      return 0;
    }
    const end = this.endTime ? new Date(this.endTime) : new Date();
    return end - new Date(this.startTime);
  }

  /**
   * Convert to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      connectorId: this.connectorId,
      syncType: this.syncType,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.getDuration(),
      progress: this.getProgress(),
      totalDocuments: this.totalDocuments,
      processedDocuments: this.processedDocuments,
      addedDocuments: this.addedDocuments,
      modifiedDocuments: this.modifiedDocuments,
      deletedDocuments: this.deletedDocuments,
      failedDocuments: this.failedDocuments,
      skippedDocuments: this.skippedDocuments,
      totalBytes: this.totalBytes,
      processedBytes: this.processedBytes,
      currentBatch: this.currentBatch,
      totalBatches: this.totalBatches,
      lastCheckpoint: this.lastCheckpoint,
      lastProcessedId: this.lastProcessedId,
      previousDeltaToken: this.previousDeltaToken,
      newDeltaToken: this.newDeltaToken,
      errorCount: this.errors.length,
      warningsCount: this.warningsCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Connector sync state (persisted)
 */
class ConnectorSyncState {
  constructor(connectorId, connectorType) {
    this.id = `sync-state-${connectorId}`;
    this.connectorId = connectorId;
    this.connectorType = connectorType;
    this.documentType = 'sync-state'; // Partition key

    // Last successful sync
    this.lastSuccessfulSync = null;
    this.lastSuccessfulSyncId = null;
    this.lastSuccessfulSyncType = null;

    // Last sync attempt
    this.lastSyncAttempt = null;
    this.lastSyncAttemptId = null;
    this.lastSyncStatus = null;

    // Delta token for incremental sync
    this.deltaToken = null;
    this.deltaTokenExpiry = null;

    // Document tracking
    this.totalDocumentsSynced = 0;
    this.lastDocumentId = null;
    this.lastDocumentTimestamp = null;

    // Sync statistics
    this.totalSyncs = 0;
    this.successfulSyncs = 0;
    this.failedSyncs = 0;
    this.totalDocumentsProcessed = 0;
    this.totalBytesProcessed = 0;

    // Configuration
    this.syncConfig = {
      batchSize: DEFAULT_CONFIG.batchSize,
      syncIntervalMs: null, // null means on-demand
      lastSyncDuration: null,
      averageSyncDuration: null,
    };

    // Metadata
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Update after sync completion
   * @param {SyncSession} session - Completed session
   */
  updateFromSession(session) {
    this.lastSyncAttempt = session.endTime || session.startTime;
    this.lastSyncAttemptId = session.id;
    this.lastSyncStatus = session.status;

    if (session.status === SyncStateStatus.COMPLETED) {
      this.lastSuccessfulSync = session.endTime;
      this.lastSuccessfulSyncId = session.id;
      this.lastSuccessfulSyncType = session.syncType;
      this.successfulSyncs++;

      if (session.newDeltaToken) {
        this.deltaToken = session.newDeltaToken;
        // Delta tokens typically expire after a set period
        this.deltaTokenExpiry = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString(); // 7 days
      }

      this.totalDocumentsSynced += session.processedDocuments;
      this.lastDocumentId = session.lastProcessedId;
      this.lastDocumentTimestamp = session.lastProcessedTimestamp;

      this.syncConfig.lastSyncDuration = session.getDuration();
      this.syncConfig.averageSyncDuration = this.totalSyncs > 0
        ? Math.round(
            (this.syncConfig.averageSyncDuration * (this.totalSyncs - 1) +
              session.getDuration()) /
              this.totalSyncs
          )
        : session.getDuration();
    } else if (session.status === SyncStateStatus.FAILED) {
      this.failedSyncs++;
    }

    this.totalSyncs++;
    this.totalDocumentsProcessed += session.processedDocuments;
    this.totalBytesProcessed += session.processedBytes;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Check if delta sync is available
   * @returns {boolean}
   */
  canDeltaSync() {
    if (!this.deltaToken) {
      return false;
    }
    if (this.deltaTokenExpiry && new Date(this.deltaTokenExpiry) < new Date()) {
      return false;
    }
    return true;
  }

  /**
   * Check if sync is stale and needs refresh
   * @param {number} staleThresholdMs - Threshold in milliseconds
   * @returns {boolean}
   */
  isStale(staleThresholdMs = DEFAULT_CONFIG.staleThresholdMs) {
    if (!this.lastSuccessfulSync) {
      return true;
    }
    const lastSync = new Date(this.lastSuccessfulSync);
    return Date.now() - lastSync.getTime() > staleThresholdMs;
  }

  /**
   * Convert to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      connectorId: this.connectorId,
      connectorType: this.connectorType,
      lastSuccessfulSync: this.lastSuccessfulSync,
      lastSuccessfulSyncId: this.lastSuccessfulSyncId,
      lastSuccessfulSyncType: this.lastSuccessfulSyncType,
      lastSyncAttempt: this.lastSyncAttempt,
      lastSyncAttemptId: this.lastSyncAttemptId,
      lastSyncStatus: this.lastSyncStatus,
      deltaTokenAvailable: this.canDeltaSync(),
      isStale: this.isStale(),
      totalDocumentsSynced: this.totalDocumentsSynced,
      totalSyncs: this.totalSyncs,
      successfulSyncs: this.successfulSyncs,
      failedSyncs: this.failedSyncs,
      successRate:
        this.totalSyncs > 0
          ? Math.round((this.successfulSyncs / this.totalSyncs) * 100)
          : 0,
      syncConfig: this.syncConfig,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Change detector for determining document differences
 */
class ChangeDetector {
  constructor(options = {}) {
    this.hashCache = new Map();
    this.maxCacheSize = options.maxCacheSize || 10000;
  }

  /**
   * Detect change type for a document
   * @param {Object} sourceDoc - Document from source
   * @param {Object} existingDoc - Existing document in system (or null)
   * @returns {Object} - { changeType, reason }
   */
  detectChange(sourceDoc, existingDoc) {
    if (!existingDoc) {
      return { changeType: ChangeType.ADDED, reason: 'New document' };
    }

    // Check if document was modified
    const sourceModified = this._getModifiedTime(sourceDoc);
    const existingModified = this._getModifiedTime(existingDoc);

    if (sourceModified && existingModified) {
      if (new Date(sourceModified) > new Date(existingModified)) {
        return { changeType: ChangeType.MODIFIED, reason: 'Modified timestamp newer' };
      }
    }

    // Check content hash if available
    const sourceHash = this._getContentHash(sourceDoc);
    const existingHash = this._getContentHash(existingDoc);

    if (sourceHash && existingHash) {
      if (sourceHash !== existingHash) {
        return { changeType: ChangeType.MODIFIED, reason: 'Content hash different' };
      }
    }

    // Check file size
    const sourceSize = sourceDoc.size || sourceDoc.fileSize || sourceDoc.contentLength;
    const existingSize = existingDoc.size || existingDoc.fileSize || existingDoc.contentLength;

    if (sourceSize && existingSize && sourceSize !== existingSize) {
      return { changeType: ChangeType.MODIFIED, reason: 'File size different' };
    }

    // Check version if available
    if (sourceDoc.version && existingDoc.version) {
      if (sourceDoc.version !== existingDoc.version) {
        return { changeType: ChangeType.MODIFIED, reason: 'Version different' };
      }
    }

    return { changeType: ChangeType.UNCHANGED, reason: 'No changes detected' };
  }

  /**
   * Detect deleted documents
   * @param {Set<string>} sourceIds - IDs from source
   * @param {Set<string>} existingIds - IDs in system
   * @returns {string[]} - List of deleted document IDs
   */
  detectDeleted(sourceIds, existingIds) {
    const deleted = [];
    for (const id of existingIds) {
      if (!sourceIds.has(id)) {
        deleted.push(id);
      }
    }
    return deleted;
  }

  /**
   * Batch detect changes
   * @param {Object[]} sourceDocs - Documents from source
   * @param {Map<string, Object>} existingDocs - Map of existing documents by ID
   * @returns {Object} - { added: [], modified: [], unchanged: [], deleted: [] }
   */
  batchDetectChanges(sourceDocs, existingDocs) {
    const result = {
      added: [],
      modified: [],
      unchanged: [],
      deleted: [],
    };

    const sourceIds = new Set();

    for (const sourceDoc of sourceDocs) {
      const id = sourceDoc.id || sourceDoc.sourceId;
      sourceIds.add(id);

      const existingDoc = existingDocs.get(id);
      const { changeType, reason } = this.detectChange(sourceDoc, existingDoc);

      switch (changeType) {
        case ChangeType.ADDED:
          result.added.push({ document: sourceDoc, reason });
          break;
        case ChangeType.MODIFIED:
          result.modified.push({ document: sourceDoc, existingDocument: existingDoc, reason });
          break;
        case ChangeType.UNCHANGED:
          result.unchanged.push({ document: sourceDoc, reason });
          break;
      }
    }

    // Detect deletions
    const deletedIds = this.detectDeleted(sourceIds, new Set(existingDocs.keys()));
    for (const id of deletedIds) {
      result.deleted.push({ id, document: existingDocs.get(id) });
    }

    return result;
  }

  /**
   * Get modified time from document
   * @private
   */
  _getModifiedTime(doc) {
    return (
      doc.lastModified ||
      doc.modifiedAt ||
      doc.updatedAt ||
      doc.lastModifiedDateTime ||
      doc.modified
    );
  }

  /**
   * Get content hash from document
   * @private
   */
  _getContentHash(doc) {
    return doc.contentHash || doc.hash || doc.eTag || doc.etag || doc.checksum;
  }

  /**
   * Clear the hash cache
   */
  clearCache() {
    this.hashCache.clear();
  }
}

/**
 * Incremental Sync Service
 */
class IncrementalSyncService {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.activeSessions = new Map(); // sessionId -> SyncSession
    this.syncStates = new Map(); // connectorId -> ConnectorSyncState (cache)
    this.changeDetector = new ChangeDetector();
    this.listeners = new Set();
    this.cosmosContainer = null;
    this.initialized = false;
  }

  /**
   * Initialize the service with Cosmos DB connection
   * @param {Object} cosmosContainer - Cosmos DB container for sync state
   */
  async initialize(cosmosContainer = null) {
    if (this.initialized) {
      return;
    }

    if (cosmosContainer) {
      this.cosmosContainer = cosmosContainer;
    } else {
      // Try to create/get the container
      try {
        const { CosmosClient } = require('@azure/cosmos');
        const { DefaultAzureCredential } = require('@azure/identity');

        const endpoint = process.env.COSMOS_DB_ENDPOINT;
        const key = process.env.COSMOS_DB_KEY;
        const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';

        if (endpoint) {
          let client;
          if (key) {
            client = new CosmosClient({ endpoint, key });
          } else {
            client = new CosmosClient({
              endpoint,
              aadCredentials: new DefaultAzureCredential(),
            });
          }

          const { database } = await client.databases.createIfNotExists({ id: databaseId });
          const { container } = await database.containers.createIfNotExists({
            id: 'sync-state',
            partitionKey: { paths: ['/documentType'] },
          });
          this.cosmosContainer = container;
        }
      } catch (error) {
        log.warn({ error: error.message }, 'Failed to initialize Cosmos DB for sync state, using in-memory storage');
      }
    }

    this.initialized = true;
    log.info('Incremental sync service initialized', {
      cosmosEnabled: !!this.cosmosContainer,
    });
  }

  /**
   * Get or create sync state for a connector
   * @param {string} connectorId - Connector ID
   * @param {string} connectorType - Connector type
   * @returns {Promise<ConnectorSyncState>}
   */
  async getSyncState(connectorId, connectorType = 'unknown') {
    await this.initialize();

    // Check cache
    if (this.syncStates.has(connectorId)) {
      return this.syncStates.get(connectorId);
    }

    // Try to load from Cosmos DB
    if (this.cosmosContainer) {
      try {
        const { resource } = await this.cosmosContainer
          .item(`sync-state-${connectorId}`, 'sync-state')
          .read();

        if (resource) {
          const state = Object.assign(new ConnectorSyncState(connectorId, connectorType), resource);
          this.syncStates.set(connectorId, state);
          return state;
        }
      } catch (error) {
        if (error.code !== 404) {
          log.warn({ connectorId, error: error.message }, 'Error loading sync state');
        }
      }
    }

    // Create new state
    const state = new ConnectorSyncState(connectorId, connectorType);
    this.syncStates.set(connectorId, state);
    return state;
  }

  /**
   * Save sync state
   * @param {ConnectorSyncState} state - State to save
   */
  async saveSyncState(state) {
    if (this.cosmosContainer) {
      try {
        await this.cosmosContainer.items.upsert({
          ...state,
          documentType: 'sync-state',
        });
      } catch (error) {
        log.error({ connectorId: state.connectorId, error: error.message }, 'Error saving sync state');
      }
    }
    this.syncStates.set(state.connectorId, state);
  }

  /**
   * Start a new sync session
   * @param {string} connectorId - Connector ID
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} - { sessionId, session, syncType, syncState }
   */
  async startSync(connectorId, options = {}) {
    await this.initialize();

    // Check concurrent sync limit
    const activeSyncsForConnector = Array.from(this.activeSessions.values()).filter(
      (s) => s.connectorId === connectorId && s.status === SyncStateStatus.SYNCING
    );

    if (activeSyncsForConnector.length > 0) {
      return {
        success: false,
        error: 'Sync already in progress for this connector',
        activeSessionId: activeSyncsForConnector[0].id,
      };
    }

    // Get sync state
    const syncState = await this.getSyncState(connectorId, options.connectorType);

    // Determine sync type
    let syncType = options.syncType || SyncType.INCREMENTAL;

    // Force full sync if requested or no previous successful sync
    if (options.forceFull || !syncState.lastSuccessfulSync) {
      syncType = SyncType.FULL;
    }

    // Use delta sync if available and supported
    if (syncType === SyncType.INCREMENTAL && syncState.canDeltaSync() && options.supportsDelta) {
      syncType = SyncType.DELTA;
    }

    // Create session
    const sessionId = `sync-${connectorId}-${Date.now()}`;
    const session = new SyncSession(sessionId, connectorId, syncType, {
      expectedDocuments: options.expectedDocuments,
      deltaToken: syncType === SyncType.DELTA ? syncState.deltaToken : null,
      metadata: options.metadata,
    });

    session.start();
    this.activeSessions.set(sessionId, session);

    // Track telemetry
    trackEvent('incremental_sync_started', {
      connectorId,
      syncType,
      sessionId,
    });

    log.info({ connectorId, sessionId, syncType }, 'Sync session started');

    // Notify listeners
    this._notifyListeners('sync_started', { sessionId, connectorId, syncType });

    return {
      success: true,
      sessionId,
      session: session.toJSON(),
      syncType,
      syncState: syncState.toJSON(),
      lastSuccessfulSync: syncState.lastSuccessfulSync,
      deltaToken: syncType === SyncType.DELTA ? syncState.deltaToken : null,
    };
  }

  /**
   * Process a batch of documents
   * @param {string} sessionId - Session ID
   * @param {Object[]} documents - Documents to process
   * @param {Function} processDocument - Async function to process a single document
   * @returns {Promise<Object>} - Batch result
   */
  async processBatch(sessionId, documents, processDocument) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.status !== SyncStateStatus.SYNCING) {
      return { success: false, error: `Session is ${session.status}` };
    }

    session.currentBatch++;
    session.totalBatches = Math.max(session.totalBatches, session.currentBatch);

    const results = {
      processed: 0,
      added: 0,
      modified: 0,
      deleted: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    for (const doc of documents) {
      try {
        const result = await processDocument(doc);

        if (result.skipped) {
          session.recordDocument(ChangeType.UNCHANGED, 0);
          results.skipped++;
        } else {
          session.recordDocument(result.changeType, result.bytes || 0);
          results.processed++;

          switch (result.changeType) {
            case ChangeType.ADDED:
              results.added++;
              break;
            case ChangeType.MODIFIED:
              results.modified++;
              break;
            case ChangeType.DELETED:
              results.deleted++;
              break;
          }
        }

        session.lastProcessedId = doc.id || doc.sourceId;
        session.lastProcessedTimestamp = new Date().toISOString();
      } catch (error) {
        session.recordFailure(doc.id || doc.sourceId, error);
        results.failed++;
        results.errors.push({
          documentId: doc.id || doc.sourceId,
          error: error.message,
        });
      }
    }

    // Add checkpoint
    session.addCheckpoint({
      batchNumber: session.currentBatch,
      processedInBatch: documents.length,
      lastDocumentId: session.lastProcessedId,
    });

    // Track metrics
    trackMetric('incremental_sync.batch.processed', results.processed, {
      connectorId: session.connectorId,
    });

    return {
      success: true,
      batchNumber: session.currentBatch,
      ...results,
      sessionProgress: session.getProgress(),
    };
  }

  /**
   * Complete a sync session
   * @param {string} sessionId - Session ID
   * @param {Object} result - Completion result
   * @returns {Promise<Object>}
   */
  async completeSync(sessionId, result = {}) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const status =
      result.status ||
      (session.failedDocuments > 0
        ? session.processedDocuments > 0
          ? SyncStateStatus.COMPLETED // Partial success
          : SyncStateStatus.FAILED
        : SyncStateStatus.COMPLETED);

    session.complete(status, result);

    // Update sync state
    const syncState = await this.getSyncState(session.connectorId);
    syncState.updateFromSession(session);
    await this.saveSyncState(syncState);

    // Save session to history
    await this._saveSessionHistory(session);

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Track telemetry
    trackEvent('incremental_sync_completed', {
      connectorId: session.connectorId,
      syncType: session.syncType,
      status,
      processedDocuments: session.processedDocuments,
      duration: session.getDuration(),
    });

    trackMetric('incremental_sync.duration', session.getDuration(), {
      connectorId: session.connectorId,
      syncType: session.syncType,
    });

    trackMetric('incremental_sync.documents', session.processedDocuments, {
      connectorId: session.connectorId,
      changeType: 'total',
    });

    log.info(
      {
        connectorId: session.connectorId,
        sessionId,
        status,
        processedDocuments: session.processedDocuments,
        duration: session.getDuration(),
      },
      'Sync session completed'
    );

    // Notify listeners
    this._notifyListeners('sync_completed', {
      sessionId,
      connectorId: session.connectorId,
      status,
      session: session.toJSON(),
    });

    return {
      success: true,
      session: session.toJSON(),
      syncState: syncState.toJSON(),
    };
  }

  /**
   * Cancel a sync session
   * @param {string} sessionId - Session ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>}
   */
  async cancelSync(sessionId, reason = 'User requested') {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    session.complete(SyncStateStatus.CANCELLED, { errors: [{ message: reason }] });
    this.activeSessions.delete(sessionId);

    log.info({ sessionId, reason }, 'Sync session cancelled');

    trackEvent('incremental_sync_cancelled', {
      connectorId: session.connectorId,
      sessionId,
      reason,
    });

    return {
      success: true,
      session: session.toJSON(),
    };
  }

  /**
   * Get session status
   * @param {string} sessionId - Session ID
   * @returns {Object|null}
   */
  getSessionStatus(sessionId) {
    const session = this.activeSessions.get(sessionId);
    return session ? session.toJSON() : null;
  }

  /**
   * Get all active sessions
   * @param {string} connectorId - Optional connector filter
   * @returns {Object[]}
   */
  getActiveSessions(connectorId = null) {
    const sessions = [];
    for (const session of this.activeSessions.values()) {
      if (!connectorId || session.connectorId === connectorId) {
        sessions.push(session.toJSON());
      }
    }
    return sessions;
  }

  /**
   * Get sync history
   * @param {string} connectorId - Connector ID
   * @param {number} limit - Max entries
   * @returns {Promise<Object[]>}
   */
  async getSyncHistory(connectorId, limit = 20) {
    if (!this.cosmosContainer) {
      return [];
    }

    try {
      const query = {
        query: `SELECT * FROM c WHERE c.documentType = 'sync-history'
                AND c.connectorId = @connectorId
                ORDER BY c.endTime DESC
                OFFSET 0 LIMIT @limit`,
        parameters: [
          { name: '@connectorId', value: connectorId },
          { name: '@limit', value: limit },
        ],
      };

      const { resources } = await this.cosmosContainer.items.query(query).fetchAll();
      return resources;
    } catch (error) {
      log.warn({ connectorId, error: error.message }, 'Error loading sync history');
      return [];
    }
  }

  /**
   * Get all connector sync states
   * @returns {Promise<Object[]>}
   */
  async getAllSyncStates() {
    if (!this.cosmosContainer) {
      return Array.from(this.syncStates.values()).map((s) => s.toJSON());
    }

    try {
      const query = {
        query: "SELECT * FROM c WHERE c.documentType = 'sync-state'",
      };

      const { resources } = await this.cosmosContainer.items.query(query).fetchAll();
      return resources.map((r) => {
        const state = Object.assign(
          new ConnectorSyncState(r.connectorId, r.connectorType),
          r
        );
        return state.toJSON();
      });
    } catch (error) {
      log.warn({ error: error.message }, 'Error loading sync states');
      return Array.from(this.syncStates.values()).map((s) => s.toJSON());
    }
  }

  /**
   * Detect changes between source and existing documents
   * @param {Object[]} sourceDocs - Documents from source
   * @param {Map<string, Object>} existingDocs - Existing documents
   * @returns {Object}
   */
  detectChanges(sourceDocs, existingDocs) {
    return this.changeDetector.batchDetectChanges(sourceDocs, existingDocs);
  }

  /**
   * Add a sync event listener
   * @param {Function} listener - Callback(eventType, data)
   * @returns {Function} - Unsubscribe function
   */
  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get service statistics
   * @returns {Object}
   */
  getStatistics() {
    const activeSessions = this.getActiveSessions();
    const syncStates = Array.from(this.syncStates.values());

    return {
      activeSessions: activeSessions.length,
      connectors: syncStates.length,
      totalSyncs: syncStates.reduce((sum, s) => sum + s.totalSyncs, 0),
      successfulSyncs: syncStates.reduce((sum, s) => sum + s.successfulSyncs, 0),
      failedSyncs: syncStates.reduce((sum, s) => sum + s.failedSyncs, 0),
      totalDocumentsProcessed: syncStates.reduce((sum, s) => sum + s.totalDocumentsProcessed, 0),
      staleConnectors: syncStates.filter((s) => s.isStale()).length,
      deltaEnabledConnectors: syncStates.filter((s) => s.canDeltaSync()).length,
      config: this.config,
    };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration updates
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    log.info({ updates }, 'Incremental sync config updated');
  }

  /**
   * Save session to history
   * @private
   */
  async _saveSessionHistory(session) {
    if (!this.cosmosContainer) {
      return;
    }

    try {
      await this.cosmosContainer.items.create({
        id: `history-${session.id}`,
        documentType: 'sync-history',
        connectorId: session.connectorId,
        ...session.toJSON(),
      });
    } catch (error) {
      log.warn({ sessionId: session.id, error: error.message }, 'Error saving sync history');
    }
  }

  /**
   * Notify listeners
   * @private
   */
  _notifyListeners(eventType, data) {
    for (const listener of this.listeners) {
      try {
        listener(eventType, data);
      } catch (error) {
        log.warn({ eventType, error: error.message }, 'Error in sync listener');
      }
    }
  }

  /**
   * Reset service (for testing)
   */
  reset() {
    this.activeSessions.clear();
    this.syncStates.clear();
    this.listeners.clear();
    this.changeDetector.clearCache();
    this.config = { ...DEFAULT_CONFIG };
    this.initialized = false;
    this.cosmosContainer = null;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton IncrementalSyncService instance
 * @returns {IncrementalSyncService}
 */
function getIncrementalSyncService() {
  if (!instance) {
    instance = new IncrementalSyncService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
function resetIncrementalSyncService() {
  if (instance) {
    instance.reset();
  }
  instance = null;
}

module.exports = {
  IncrementalSyncService,
  getIncrementalSyncService,
  resetIncrementalSyncService,
  SyncSession,
  ConnectorSyncState,
  ChangeDetector,
  SyncStateStatus,
  ChangeType,
  SyncType,
};
