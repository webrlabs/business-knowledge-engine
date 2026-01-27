/**
 * Deletion Sync Service (F4.2.6)
 *
 * Provides soft delete functionality with configurable grace period for documents
 * deleted from external source connectors. Allows recovery within the grace period
 * and handles permanent deletion after expiration.
 *
 * Features:
 * - Soft delete with configurable grace period
 * - Grace period recovery (undelete)
 * - Automatic permanent deletion after grace period
 * - Per-connector deletion tracking
 * - Batch deletion detection and processing
 * - Integration with search index and graph cleanup
 * - Audit logging for all deletion operations
 *
 * @module services/deletion-sync-service
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');

// Deletion status constants
const DeletionStatus = {
  ACTIVE: 'active',
  PENDING_DELETION: 'pending_deletion',
  DELETED: 'deleted',
  RECOVERED: 'recovered',
};

// Deletion reason constants
const DeletionReason = {
  SOURCE_DELETED: 'source_deleted',
  MANUAL: 'manual',
  POLICY: 'policy',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
};

// Default configuration
const DEFAULT_CONFIG = {
  gracePeriodMs: parseInt(process.env.DELETION_GRACE_PERIOD_MS) || 7 * 24 * 60 * 60 * 1000, // 7 days
  checkIntervalMs: parseInt(process.env.DELETION_CHECK_INTERVAL_MS) || 60 * 60 * 1000, // 1 hour
  batchSize: parseInt(process.env.DELETION_BATCH_SIZE) || 50,
  maxPendingAge: parseInt(process.env.DELETION_MAX_PENDING_AGE_MS) || 30 * 24 * 60 * 60 * 1000, // 30 days max
  retainMetadata: process.env.DELETION_RETAIN_METADATA === 'true', // Keep metadata after deletion
  cleanupGraphEntities: process.env.DELETION_CLEANUP_GRAPH !== 'false', // Default true
  cleanupSearchIndex: process.env.DELETION_CLEANUP_SEARCH !== 'false', // Default true
  notifyOnDeletion: process.env.DELETION_NOTIFY === 'true',
  auditDeletions: process.env.DELETION_AUDIT !== 'false', // Default true
};

/**
 * Pending deletion record
 */
class PendingDeletion {
  constructor(documentId, options = {}) {
    this.documentId = documentId;
    this.connectorId = options.connectorId || null;
    this.sourceId = options.sourceId || null;
    this.reason = options.reason || DeletionReason.SOURCE_DELETED;
    this.status = DeletionStatus.PENDING_DELETION;

    // Timing
    this.markedAt = new Date().toISOString();
    this.scheduledDeletionAt = options.scheduledDeletionAt || null;
    this.deletedAt = null;
    this.recoveredAt = null;

    // Metadata
    this.documentTitle = options.documentTitle || null;
    this.documentType = options.documentType || null;
    this.fileSize = options.fileSize || null;
    this.lastModified = options.lastModified || null;

    // Context
    this.markedBy = options.markedBy || 'system';
    this.recoveredBy = null;
    this.deletedBy = null;
    this.notes = options.notes || null;

    // Related entities (for cleanup)
    this.relatedEntities = options.relatedEntities || [];
    this.searchIndexId = options.searchIndexId || null;
    this.blobPath = options.blobPath || null;

    // Processing
    this.cleanupCompleted = false;
    this.cleanupErrors = [];

    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Calculate scheduled deletion time
   * @param {number} gracePeriodMs - Grace period in milliseconds
   */
  scheduleDelete(gracePeriodMs) {
    const scheduled = new Date(Date.now() + gracePeriodMs);
    this.scheduledDeletionAt = scheduled.toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Check if grace period has expired
   * @returns {boolean}
   */
  isExpired() {
    if (!this.scheduledDeletionAt) {
      return false;
    }
    return new Date() >= new Date(this.scheduledDeletionAt);
  }

  /**
   * Get remaining grace period in milliseconds
   * @returns {number}
   */
  getRemainingGracePeriod() {
    if (!this.scheduledDeletionAt) {
      return 0;
    }
    const remaining = new Date(this.scheduledDeletionAt) - new Date();
    return Math.max(0, remaining);
  }

  /**
   * Mark as recovered
   * @param {string} recoveredBy - Who recovered the document
   * @param {string} notes - Recovery notes
   */
  recover(recoveredBy = 'system', notes = null) {
    this.status = DeletionStatus.RECOVERED;
    this.recoveredAt = new Date().toISOString();
    this.recoveredBy = recoveredBy;
    if (notes) {
      this.notes = notes;
    }
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Mark as permanently deleted
   * @param {string} deletedBy - Who performed the deletion
   */
  markDeleted(deletedBy = 'system') {
    this.status = DeletionStatus.DELETED;
    this.deletedAt = new Date().toISOString();
    this.deletedBy = deletedBy;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Record cleanup error
   * @param {string} component - Component that failed
   * @param {string} error - Error message
   */
  recordCleanupError(component, error) {
    this.cleanupErrors.push({
      component,
      error,
      timestamp: new Date().toISOString(),
    });
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Convert to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      documentId: this.documentId,
      connectorId: this.connectorId,
      sourceId: this.sourceId,
      reason: this.reason,
      status: this.status,
      markedAt: this.markedAt,
      scheduledDeletionAt: this.scheduledDeletionAt,
      deletedAt: this.deletedAt,
      recoveredAt: this.recoveredAt,
      remainingGracePeriodMs: this.getRemainingGracePeriod(),
      isExpired: this.isExpired(),
      documentTitle: this.documentTitle,
      documentType: this.documentType,
      fileSize: this.fileSize,
      lastModified: this.lastModified,
      markedBy: this.markedBy,
      recoveredBy: this.recoveredBy,
      deletedBy: this.deletedBy,
      notes: this.notes,
      relatedEntities: this.relatedEntities,
      cleanupCompleted: this.cleanupCompleted,
      cleanupErrorCount: this.cleanupErrors.length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Connector deletion state
 */
class ConnectorDeletionState {
  constructor(connectorId) {
    this.connectorId = connectorId;
    this.lastScanAt = null;
    this.lastScanDocumentCount = 0;
    this.totalDeletedDocuments = 0;
    this.totalRecoveredDocuments = 0;
    this.pendingDeletions = 0;
    this.lastDeletionAt = null;
    this.lastRecoveryAt = null;
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Update scan statistics
   * @param {number} documentCount - Documents scanned
   * @param {number} deletedCount - Documents marked for deletion
   */
  recordScan(documentCount, deletedCount = 0) {
    this.lastScanAt = new Date().toISOString();
    this.lastScanDocumentCount = documentCount;
    this.pendingDeletions += deletedCount;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Record a permanent deletion
   */
  recordDeletion() {
    this.totalDeletedDocuments++;
    this.pendingDeletions = Math.max(0, this.pendingDeletions - 1);
    this.lastDeletionAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Record a recovery
   */
  recordRecovery() {
    this.totalRecoveredDocuments++;
    this.pendingDeletions = Math.max(0, this.pendingDeletions - 1);
    this.lastRecoveryAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Convert to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      connectorId: this.connectorId,
      lastScanAt: this.lastScanAt,
      lastScanDocumentCount: this.lastScanDocumentCount,
      totalDeletedDocuments: this.totalDeletedDocuments,
      totalRecoveredDocuments: this.totalRecoveredDocuments,
      pendingDeletions: this.pendingDeletions,
      lastDeletionAt: this.lastDeletionAt,
      lastRecoveryAt: this.lastRecoveryAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * Deletion Sync Service
 */
class DeletionSyncService {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.pendingDeletions = new Map(); // documentId -> PendingDeletion
    this.connectorStates = new Map(); // connectorId -> ConnectorDeletionState
    this.deletionHistory = []; // Recent deletion records (for audit)
    this.listeners = new Set(); // Event listeners
    this.checkInterval = null;
    this.cosmosContainer = null;
    this.initialized = false;

    // Service dependencies (injected)
    this.documentService = null;
    this.searchService = null;
    this.graphService = null;
    this.auditService = null;
  }

  /**
   * Initialize the service
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    if (this.initialized) {
      return;
    }

    // Store service dependencies
    if (options.documentService) {
      this.documentService = options.documentService;
    }
    if (options.searchService) {
      this.searchService = options.searchService;
    }
    if (options.graphService) {
      this.graphService = options.graphService;
    }
    if (options.auditService) {
      this.auditService = options.auditService;
    }

    // Initialize Cosmos DB container for persistence
    if (options.cosmosContainer) {
      this.cosmosContainer = options.cosmosContainer;
    } else {
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
            id: 'deletion-sync',
            partitionKey: { paths: ['/documentType'] },
          });
          this.cosmosContainer = container;
        }
      } catch (error) {
        log.warn({ error: error.message }, 'Failed to initialize Cosmos DB for deletion sync, using in-memory storage');
      }
    }

    // Load existing pending deletions from storage
    await this._loadPendingDeletions();

    // Start automatic cleanup check
    if (options.startCleanupCheck !== false) {
      this._startCleanupCheck();
    }

    this.initialized = true;
    log.info('Deletion sync service initialized', {
      cosmosEnabled: !!this.cosmosContainer,
      gracePeriodMs: this.config.gracePeriodMs,
    });
  }

  /**
   * Mark a document for soft deletion
   * @param {string} documentId - Document ID to mark for deletion
   * @param {Object} options - Deletion options
   * @returns {Promise<Object>} - Result with pending deletion info
   */
  async markForDeletion(documentId, options = {}) {
    await this.initialize();

    // Check if already pending
    if (this.pendingDeletions.has(documentId)) {
      const existing = this.pendingDeletions.get(documentId);
      if (existing.status === DeletionStatus.PENDING_DELETION) {
        return {
          success: false,
          error: 'Document already marked for deletion',
          pendingDeletion: existing.toJSON(),
        };
      }
    }

    // Get document info if available
    let documentInfo = {};
    if (this.documentService && typeof this.documentService.getDocumentById === 'function') {
      try {
        const doc = await this.documentService.getDocumentById(documentId);
        if (doc) {
          documentInfo = {
            documentTitle: doc.title || doc.name,
            documentType: doc.type || doc.documentType,
            fileSize: doc.size || doc.fileSize,
            lastModified: doc.lastModified || doc.updatedAt,
            searchIndexId: doc.searchIndexId,
            blobPath: doc.blobPath || doc.storagePath,
          };
        }
      } catch (error) {
        log.warn({ documentId, error: error.message }, 'Failed to get document info for deletion');
      }
    }

    // Create pending deletion record
    const pendingDeletion = new PendingDeletion(documentId, {
      connectorId: options.connectorId,
      sourceId: options.sourceId,
      reason: options.reason || DeletionReason.SOURCE_DELETED,
      markedBy: options.markedBy || 'system',
      notes: options.notes,
      relatedEntities: options.relatedEntities || [],
      ...documentInfo,
    });

    // Calculate scheduled deletion time
    const gracePeriod = options.gracePeriodMs || this.config.gracePeriodMs;
    pendingDeletion.scheduleDelete(gracePeriod);

    // Update document status if service available
    if (this.documentService && typeof this.documentService.updateDocument === 'function') {
      try {
        await this.documentService.updateDocument(documentId, {
          status: DeletionStatus.PENDING_DELETION,
          deletionScheduledAt: pendingDeletion.scheduledDeletionAt,
          deletionReason: pendingDeletion.reason,
          deletionMarkedAt: pendingDeletion.markedAt,
          deletionMarkedBy: pendingDeletion.markedBy,
        });
      } catch (error) {
        log.warn({ documentId, error: error.message }, 'Failed to update document status');
      }
    }

    // Store pending deletion
    this.pendingDeletions.set(documentId, pendingDeletion);
    await this._savePendingDeletion(pendingDeletion);

    // Update connector state
    if (options.connectorId) {
      const connectorState = this._getOrCreateConnectorState(options.connectorId);
      connectorState.pendingDeletions++;
      connectorState.updatedAt = new Date().toISOString();
    }

    // Audit log
    if (this.config.auditDeletions) {
      await this._auditLog('document_marked_for_deletion', {
        documentId,
        reason: pendingDeletion.reason,
        scheduledDeletionAt: pendingDeletion.scheduledDeletionAt,
        markedBy: pendingDeletion.markedBy,
      });
    }

    // Track telemetry
    trackEvent('deletion_sync.document_marked', {
      documentId,
      connectorId: options.connectorId,
      reason: pendingDeletion.reason,
      gracePeriodMs: gracePeriod,
    });

    trackMetric('deletion_sync.marked', 1, {
      connectorId: options.connectorId || 'unknown',
      reason: pendingDeletion.reason,
    });

    // Notify listeners
    this._notifyListeners('document_marked_for_deletion', pendingDeletion.toJSON());

    log.info({
      documentId,
      connectorId: options.connectorId,
      scheduledDeletionAt: pendingDeletion.scheduledDeletionAt,
    }, 'Document marked for deletion');

    return {
      success: true,
      pendingDeletion: pendingDeletion.toJSON(),
    };
  }

  /**
   * Recover a document from pending deletion
   * @param {string} documentId - Document ID to recover
   * @param {Object} options - Recovery options
   * @returns {Promise<Object>} - Result
   */
  async recoverDocument(documentId, options = {}) {
    await this.initialize();

    const pendingDeletion = this.pendingDeletions.get(documentId);
    if (!pendingDeletion) {
      return {
        success: false,
        error: 'Document not found in pending deletions',
      };
    }

    if (pendingDeletion.status !== DeletionStatus.PENDING_DELETION) {
      return {
        success: false,
        error: `Cannot recover document with status: ${pendingDeletion.status}`,
      };
    }

    // Mark as recovered
    pendingDeletion.recover(options.recoveredBy || 'user', options.notes);

    // Update document status if service available
    if (this.documentService && typeof this.documentService.updateDocument === 'function') {
      try {
        await this.documentService.updateDocument(documentId, {
          status: DeletionStatus.ACTIVE,
          deletionScheduledAt: null,
          deletionReason: null,
          deletionMarkedAt: null,
          deletionMarkedBy: null,
          recoveredAt: pendingDeletion.recoveredAt,
          recoveredBy: pendingDeletion.recoveredBy,
        });
      } catch (error) {
        log.warn({ documentId, error: error.message }, 'Failed to update document status after recovery');
      }
    }

    // Save updated state
    await this._savePendingDeletion(pendingDeletion);

    // Update connector state
    if (pendingDeletion.connectorId) {
      const connectorState = this._getOrCreateConnectorState(pendingDeletion.connectorId);
      connectorState.recordRecovery();
    }

    // Move to history and remove from pending
    this._addToHistory(pendingDeletion);
    this.pendingDeletions.delete(documentId);

    // Audit log
    if (this.config.auditDeletions) {
      await this._auditLog('document_recovered', {
        documentId,
        recoveredBy: pendingDeletion.recoveredBy,
        originalReason: pendingDeletion.reason,
      });
    }

    // Track telemetry
    trackEvent('deletion_sync.document_recovered', {
      documentId,
      connectorId: pendingDeletion.connectorId,
    });

    trackMetric('deletion_sync.recovered', 1, {
      connectorId: pendingDeletion.connectorId || 'unknown',
    });

    // Notify listeners
    this._notifyListeners('document_recovered', pendingDeletion.toJSON());

    log.info({
      documentId,
      recoveredBy: pendingDeletion.recoveredBy,
    }, 'Document recovered from deletion');

    return {
      success: true,
      document: pendingDeletion.toJSON(),
    };
  }

  /**
   * Permanently delete a document (immediately or after grace period)
   * @param {string} documentId - Document ID to delete
   * @param {Object} options - Deletion options
   * @returns {Promise<Object>} - Result
   */
  async permanentlyDelete(documentId, options = {}) {
    await this.initialize();

    let pendingDeletion = this.pendingDeletions.get(documentId);

    // If not in pending, create a record for tracking
    if (!pendingDeletion) {
      pendingDeletion = new PendingDeletion(documentId, {
        reason: options.reason || DeletionReason.MANUAL,
        markedBy: options.deletedBy || 'system',
      });
    }

    // Check if forced or expired
    if (!options.force && pendingDeletion.status === DeletionStatus.PENDING_DELETION && !pendingDeletion.isExpired()) {
      return {
        success: false,
        error: 'Grace period has not expired. Use force=true to delete immediately.',
        remainingGracePeriodMs: pendingDeletion.getRemainingGracePeriod(),
      };
    }

    // Perform cleanup
    const cleanupResults = {
      document: false,
      searchIndex: false,
      graph: false,
      blob: false,
    };

    // Delete from document store
    if (this.documentService && typeof this.documentService.deleteDocument === 'function') {
      try {
        await this.documentService.deleteDocument(documentId);
        cleanupResults.document = true;
      } catch (error) {
        pendingDeletion.recordCleanupError('document', error.message);
        log.error({ documentId, error: error.message }, 'Failed to delete document');
      }
    } else {
      // Fallback to cosmos direct
      try {
        const cosmos = require('../storage/cosmos');
        await cosmos.deleteDocument(documentId);
        cleanupResults.document = true;
      } catch (error) {
        pendingDeletion.recordCleanupError('document', error.message);
        log.error({ documentId, error: error.message }, 'Failed to delete document from Cosmos');
      }
    }

    // Remove from search index
    if (this.config.cleanupSearchIndex && this.searchService) {
      try {
        if (typeof this.searchService.deleteDocument === 'function') {
          await this.searchService.deleteDocument(pendingDeletion.searchIndexId || documentId);
          cleanupResults.searchIndex = true;
        }
      } catch (error) {
        pendingDeletion.recordCleanupError('searchIndex', error.message);
        log.warn({ documentId, error: error.message }, 'Failed to remove from search index');
      }
    }

    // Clean up related graph entities
    if (this.config.cleanupGraphEntities && this.graphService && pendingDeletion.relatedEntities.length > 0) {
      try {
        for (const entityId of pendingDeletion.relatedEntities) {
          if (typeof this.graphService.deleteVertex === 'function') {
            await this.graphService.deleteVertex(entityId);
          }
        }
        cleanupResults.graph = true;
      } catch (error) {
        pendingDeletion.recordCleanupError('graph', error.message);
        log.warn({ documentId, error: error.message }, 'Failed to clean up graph entities');
      }
    }

    // Delete blob storage
    if (pendingDeletion.blobPath && this.documentService?.deleteBlobContent) {
      try {
        await this.documentService.deleteBlobContent(pendingDeletion.blobPath);
        cleanupResults.blob = true;
      } catch (error) {
        pendingDeletion.recordCleanupError('blob', error.message);
        log.warn({ documentId, error: error.message }, 'Failed to delete blob content');
      }
    }

    // Mark as deleted
    pendingDeletion.markDeleted(options.deletedBy || 'system');
    pendingDeletion.cleanupCompleted = Object.values(cleanupResults).some(r => r);

    // Save final state
    await this._savePendingDeletion(pendingDeletion);

    // Update connector state
    if (pendingDeletion.connectorId) {
      const connectorState = this._getOrCreateConnectorState(pendingDeletion.connectorId);
      connectorState.recordDeletion();
    }

    // Move to history and remove from pending
    this._addToHistory(pendingDeletion);
    this.pendingDeletions.delete(documentId);

    // Optionally remove metadata record
    if (!this.config.retainMetadata) {
      await this._deletePendingDeletionRecord(documentId);
    }

    // Audit log
    if (this.config.auditDeletions) {
      await this._auditLog('document_permanently_deleted', {
        documentId,
        deletedBy: pendingDeletion.deletedBy,
        reason: pendingDeletion.reason,
        cleanupResults,
      });
    }

    // Track telemetry
    trackEvent('deletion_sync.document_deleted', {
      documentId,
      connectorId: pendingDeletion.connectorId,
      reason: pendingDeletion.reason,
      cleanupResults,
    });

    trackMetric('deletion_sync.deleted', 1, {
      connectorId: pendingDeletion.connectorId || 'unknown',
      reason: pendingDeletion.reason,
    });

    // Notify listeners
    this._notifyListeners('document_permanently_deleted', pendingDeletion.toJSON());

    log.info({
      documentId,
      cleanupResults,
    }, 'Document permanently deleted');

    return {
      success: true,
      document: pendingDeletion.toJSON(),
      cleanupResults,
    };
  }

  /**
   * Detect deleted documents by comparing source IDs with existing documents
   * @param {string} connectorId - Connector ID
   * @param {Set<string>|Array<string>} currentSourceIds - IDs currently in source
   * @param {Object} options - Detection options
   * @returns {Promise<Object>} - Detection result
   */
  async detectDeletedDocuments(connectorId, currentSourceIds, options = {}) {
    await this.initialize();

    const sourceIdSet = currentSourceIds instanceof Set
      ? currentSourceIds
      : new Set(currentSourceIds);

    // Get existing documents for this connector
    let existingDocuments = [];
    if (this.documentService && typeof this.documentService.queryDocuments === 'function') {
      try {
        existingDocuments = await this.documentService.queryDocuments({
          query: 'SELECT c.id, c.sourceId, c.title, c.status FROM c WHERE c.connectorId = @connectorId AND c.status != @deletedStatus',
          parameters: [
            { name: '@connectorId', value: connectorId },
            { name: '@deletedStatus', value: DeletionStatus.DELETED },
          ],
        });
      } catch (error) {
        log.error({ connectorId, error: error.message }, 'Failed to query existing documents');
        return { success: false, error: error.message };
      }
    } else {
      // Fallback to cosmos direct
      try {
        const cosmos = require('../storage/cosmos');
        existingDocuments = await cosmos.queryDocuments({
          query: 'SELECT c.id, c.sourceId, c.title, c.status FROM c WHERE c.connectorId = @connectorId AND c.status != @deletedStatus',
          parameters: [
            { name: '@connectorId', value: connectorId },
            { name: '@deletedStatus', value: DeletionStatus.DELETED },
          ],
        });
      } catch (error) {
        log.error({ connectorId, error: error.message }, 'Failed to query documents from Cosmos');
        return { success: false, error: error.message };
      }
    }

    // Find documents not in source (deleted from source)
    const deletedDocuments = [];
    const stillPresentDocuments = [];

    for (const doc of existingDocuments) {
      const sourceId = doc.sourceId || doc.id;

      if (!sourceIdSet.has(sourceId)) {
        // Document no longer in source - mark for deletion
        if (doc.status !== DeletionStatus.PENDING_DELETION) {
          deletedDocuments.push({
            documentId: doc.id,
            sourceId,
            title: doc.title,
          });
        }
      } else {
        stillPresentDocuments.push(doc.id);
      }
    }

    // Mark detected deletions
    const markedDeletions = [];
    const markErrors = [];

    for (const doc of deletedDocuments) {
      try {
        const result = await this.markForDeletion(doc.documentId, {
          connectorId,
          sourceId: doc.sourceId,
          reason: DeletionReason.SOURCE_DELETED,
          markedBy: 'deletion_detection',
          notes: `Auto-detected: document no longer exists in source connector ${connectorId}`,
        });

        if (result.success) {
          markedDeletions.push(doc);
        } else {
          // Already marked or other non-error case
          if (result.error !== 'Document already marked for deletion') {
            markErrors.push({ documentId: doc.documentId, error: result.error });
          }
        }
      } catch (error) {
        markErrors.push({ documentId: doc.documentId, error: error.message });
      }
    }

    // Update connector state
    const connectorState = this._getOrCreateConnectorState(connectorId);
    connectorState.recordScan(existingDocuments.length, markedDeletions.length);

    // Track telemetry
    trackEvent('deletion_sync.detection_complete', {
      connectorId,
      scannedDocuments: existingDocuments.length,
      deletedDocuments: deletedDocuments.length,
      markedDeletions: markedDeletions.length,
      errors: markErrors.length,
    });

    trackMetric('deletion_sync.detected', deletedDocuments.length, { connectorId });

    log.info({
      connectorId,
      scannedDocuments: existingDocuments.length,
      deletedDocuments: deletedDocuments.length,
      markedDeletions: markedDeletions.length,
    }, 'Deletion detection complete');

    return {
      success: true,
      connectorId,
      scannedDocuments: existingDocuments.length,
      deletedDocuments: deletedDocuments.length,
      markedDeletions: markedDeletions.map(d => d.documentId),
      stillPresent: stillPresentDocuments.length,
      errors: markErrors,
      connectorState: connectorState.toJSON(),
    };
  }

  /**
   * Process expired deletions (automatic cleanup)
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing result
   */
  async processExpiredDeletions(options = {}) {
    await this.initialize();

    const batchSize = options.batchSize || this.config.batchSize;
    const expiredDeletions = [];

    // Find expired pending deletions
    for (const [documentId, pendingDeletion] of this.pendingDeletions) {
      if (pendingDeletion.status === DeletionStatus.PENDING_DELETION && pendingDeletion.isExpired()) {
        expiredDeletions.push(documentId);
        if (expiredDeletions.length >= batchSize) {
          break;
        }
      }
    }

    if (expiredDeletions.length === 0) {
      return {
        success: true,
        processed: 0,
        message: 'No expired deletions to process',
      };
    }

    // Process deletions
    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (const documentId of expiredDeletions) {
      results.processed++;

      try {
        const result = await this.permanentlyDelete(documentId, {
          deletedBy: 'auto_cleanup',
        });

        if (result.success) {
          results.succeeded++;
        } else {
          results.failed++;
          results.errors.push({ documentId, error: result.error });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ documentId, error: error.message });
      }
    }

    trackMetric('deletion_sync.auto_cleanup.processed', results.processed);
    trackMetric('deletion_sync.auto_cleanup.succeeded', results.succeeded);
    trackMetric('deletion_sync.auto_cleanup.failed', results.failed);

    log.info(results, 'Expired deletions processed');

    return {
      success: true,
      ...results,
    };
  }

  /**
   * Get pending deletion by document ID
   * @param {string} documentId - Document ID
   * @returns {Object|null}
   */
  getPendingDeletion(documentId) {
    const pending = this.pendingDeletions.get(documentId);
    return pending ? pending.toJSON() : null;
  }

  /**
   * List all pending deletions
   * @param {Object} options - Filter options
   * @returns {Object[]}
   */
  listPendingDeletions(options = {}) {
    const results = [];

    for (const [, pendingDeletion] of this.pendingDeletions) {
      // Filter by status
      if (options.status && pendingDeletion.status !== options.status) {
        continue;
      }

      // Filter by connector
      if (options.connectorId && pendingDeletion.connectorId !== options.connectorId) {
        continue;
      }

      // Filter by expired
      if (options.expiredOnly && !pendingDeletion.isExpired()) {
        continue;
      }

      results.push(pendingDeletion.toJSON());
    }

    // Sort by scheduled deletion time (earliest first)
    results.sort((a, b) => {
      const aTime = new Date(a.scheduledDeletionAt || 0);
      const bTime = new Date(b.scheduledDeletionAt || 0);
      return aTime - bTime;
    });

    // Apply limit
    if (options.limit) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get deletion history
   * @param {Object} options - Filter options
   * @returns {Object[]}
   */
  getDeletionHistory(options = {}) {
    let history = [...this.deletionHistory];

    // Filter by connector
    if (options.connectorId) {
      history = history.filter(h => h.connectorId === options.connectorId);
    }

    // Filter by status
    if (options.status) {
      history = history.filter(h => h.status === options.status);
    }

    // Apply limit
    if (options.limit) {
      history = history.slice(-options.limit);
    }

    return history.reverse();
  }

  /**
   * Get connector deletion state
   * @param {string} connectorId - Connector ID
   * @returns {Object|null}
   */
  getConnectorState(connectorId) {
    const state = this.connectorStates.get(connectorId);
    return state ? state.toJSON() : null;
  }

  /**
   * Get all connector deletion states
   * @returns {Object[]}
   */
  getAllConnectorStates() {
    const states = [];
    for (const [, state] of this.connectorStates) {
      states.push(state.toJSON());
    }
    return states;
  }

  /**
   * Get service statistics
   * @returns {Object}
   */
  getStatistics() {
    const pendingByReason = {};
    const pendingByConnector = {};
    let totalPending = 0;
    let expiredCount = 0;

    for (const [, pending] of this.pendingDeletions) {
      if (pending.status === DeletionStatus.PENDING_DELETION) {
        totalPending++;

        // By reason
        pendingByReason[pending.reason] = (pendingByReason[pending.reason] || 0) + 1;

        // By connector
        const connId = pending.connectorId || 'unknown';
        pendingByConnector[connId] = (pendingByConnector[connId] || 0) + 1;

        // Expired
        if (pending.isExpired()) {
          expiredCount++;
        }
      }
    }

    return {
      pendingDeletions: totalPending,
      expiredDeletions: expiredCount,
      pendingByReason,
      pendingByConnector,
      connectorCount: this.connectorStates.size,
      historySize: this.deletionHistory.length,
      config: {
        gracePeriodMs: this.config.gracePeriodMs,
        gracePeriodDays: Math.round(this.config.gracePeriodMs / (24 * 60 * 60 * 1000)),
        checkIntervalMs: this.config.checkIntervalMs,
        cleanupGraphEntities: this.config.cleanupGraphEntities,
        cleanupSearchIndex: this.config.cleanupSearchIndex,
      },
    };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration updates
   */
  updateConfig(updates) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    const filteredUpdates = {};

    for (const [key, value] of Object.entries(updates)) {
      if (validKeys.includes(key)) {
        filteredUpdates[key] = value;
      }
    }

    this.config = { ...this.config, ...filteredUpdates };

    // Restart cleanup check with new interval
    if (filteredUpdates.checkIntervalMs !== undefined) {
      this._startCleanupCheck();
    }

    log.info({ updates: filteredUpdates }, 'Deletion sync config updated');

    return { success: true, config: this.config };
  }

  /**
   * Add event listener
   * @param {Function} listener - Callback(eventType, data)
   * @returns {Function} - Unsubscribe function
   */
  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Reset service (for testing)
   */
  reset() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.pendingDeletions.clear();
    this.connectorStates.clear();
    this.deletionHistory = [];
    this.listeners.clear();
    this.config = { ...DEFAULT_CONFIG };
    this.initialized = false;
    this.cosmosContainer = null;
    this.documentService = null;
    this.searchService = null;
    this.graphService = null;
    this.auditService = null;
  }

  // Private methods

  /**
   * Get or create connector state
   * @private
   */
  _getOrCreateConnectorState(connectorId) {
    if (!this.connectorStates.has(connectorId)) {
      this.connectorStates.set(connectorId, new ConnectorDeletionState(connectorId));
    }
    return this.connectorStates.get(connectorId);
  }

  /**
   * Load pending deletions from storage
   * @private
   */
  async _loadPendingDeletions() {
    if (!this.cosmosContainer) {
      return;
    }

    try {
      const query = {
        query: "SELECT * FROM c WHERE c.documentType = 'pending-deletion' AND c.status = @status",
        parameters: [{ name: '@status', value: DeletionStatus.PENDING_DELETION }],
      };

      const { resources } = await this.cosmosContainer.items.query(query).fetchAll();

      for (const resource of resources) {
        const pendingDeletion = Object.assign(
          new PendingDeletion(resource.documentId),
          resource
        );
        this.pendingDeletions.set(resource.documentId, pendingDeletion);

        // Update connector state
        if (resource.connectorId) {
          const connectorState = this._getOrCreateConnectorState(resource.connectorId);
          connectorState.pendingDeletions++;
        }
      }

      log.info({ count: resources.length }, 'Loaded pending deletions from storage');
    } catch (error) {
      log.warn({ error: error.message }, 'Failed to load pending deletions');
    }
  }

  /**
   * Save pending deletion to storage
   * @private
   */
  async _savePendingDeletion(pendingDeletion) {
    if (!this.cosmosContainer) {
      return;
    }

    try {
      await this.cosmosContainer.items.upsert({
        id: `deletion-${pendingDeletion.documentId}`,
        documentType: 'pending-deletion',
        ...pendingDeletion,
      });
    } catch (error) {
      log.warn({ documentId: pendingDeletion.documentId, error: error.message }, 'Failed to save pending deletion');
    }
  }

  /**
   * Delete pending deletion record from storage
   * @private
   */
  async _deletePendingDeletionRecord(documentId) {
    if (!this.cosmosContainer) {
      return;
    }

    try {
      await this.cosmosContainer.item(`deletion-${documentId}`, 'pending-deletion').delete();
    } catch (error) {
      if (error.code !== 404) {
        log.warn({ documentId, error: error.message }, 'Failed to delete pending deletion record');
      }
    }
  }

  /**
   * Add entry to deletion history
   * @private
   */
  _addToHistory(pendingDeletion) {
    this.deletionHistory.push(pendingDeletion.toJSON());

    // Cap history size
    const maxHistory = 500;
    while (this.deletionHistory.length > maxHistory) {
      this.deletionHistory.shift();
    }
  }

  /**
   * Start automatic cleanup check
   * @private
   */
  _startCleanupCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.processExpiredDeletions();
      } catch (error) {
        log.error({ error: error.message }, 'Error in automatic deletion cleanup');
      }
    }, this.config.checkIntervalMs);

    log.info({ intervalMs: this.config.checkIntervalMs }, 'Started deletion cleanup check');
  }

  /**
   * Write audit log
   * @private
   */
  async _auditLog(action, details) {
    if (this.auditService && typeof this.auditService.log === 'function') {
      try {
        await this.auditService.log({
          action,
          category: 'deletion_sync',
          ...details,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        log.warn({ action, error: error.message }, 'Failed to write audit log');
      }
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
        log.warn({ eventType, error: error.message }, 'Error in deletion sync listener');
      }
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton DeletionSyncService instance
 * @returns {DeletionSyncService}
 */
function getDeletionSyncService() {
  if (!instance) {
    instance = new DeletionSyncService();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
function resetDeletionSyncService() {
  if (instance) {
    instance.reset();
  }
  instance = null;
}

module.exports = {
  DeletionSyncService,
  getDeletionSyncService,
  resetDeletionSyncService,
  PendingDeletion,
  ConnectorDeletionState,
  DeletionStatus,
  DeletionReason,
};
