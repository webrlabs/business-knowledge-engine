/**
 * Audit Persistence Service
 *
 * Provides persistent storage for audit logs and access denials.
 * Uses Azure Cosmos DB for scalable, reliable storage.
 *
 * Features:
 * - F5.1.1: Audit Log Cosmos Container
 * - F5.1.2: Audit Persistence Service
 * - F5.1.3: Denial Log Persistence
 * - F5.1.4: Audit Log Retention Policy
 */

const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');
const { log } = require('../utils/logger');
const { getConfig, getConfigurationService } = require('./configuration-service');

/**
 * Configuration for audit storage
 */
const CONFIG = {
  // Container settings
  CONTAINER_ID: process.env.COSMOS_DB_AUDIT_CONTAINER || 'audit-logs',
  DATABASE_ID: process.env.COSMOS_DB_DATABASE || 'knowledge-platform',

  // Partition strategy: Use entityType as originally defined
  // This groups audits by what kind of thing they are about (document, user, system)
  PARTITION_KEY_PATH: '/entityType',
};

let client = null;
let database = null;
let container = null;
let retentionScheduler = null;

/**
 * Get or create the Cosmos client
 */
function getClient() {
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const key = process.env.COSMOS_DB_KEY;

  if (!endpoint) {
    throw new Error('COSMOS_DB_ENDPOINT is required for audit storage');
  }

  if (client) {
    return client;
  }

  if (key) {
    client = new CosmosClient({ endpoint, key });
  } else {
    client = new CosmosClient({
      endpoint,
      aadCredentials: new DefaultAzureCredential(),
    });
  }

  return client;
}

/**
 * Initialize the audit container
 */
async function initContainer() {
  if (container) {
    return container;
  }

  try {
    const cosmosClient = getClient();

    // Create or get database
    const { database: db } = await cosmosClient.databases.createIfNotExists({
      id: CONFIG.DATABASE_ID,
    });
    database = db;

    // Get retention days from centralized config
    const retentionDays = getConfig('AUDIT_LOG_RETENTION_DAYS') || 90;
    const defaultTtl = retentionDays * 24 * 60 * 60; // Convert to seconds

    // Create or get audit container
    const { container: cont, resource: containerDef } = await database.containers.createIfNotExists({
      id: CONFIG.CONTAINER_ID,
      partitionKey: {
        paths: [CONFIG.PARTITION_KEY_PATH],
      },
      // Set default TTL at container level
      defaultTtl: defaultTtl,
    });
    container = cont;

    // Check if TTL needs update (if container already existed with different TTL)
    if (containerDef && containerDef.defaultTtl !== defaultTtl) {
      log.info(`Updating audit container TTL from ${containerDef.defaultTtl} to ${defaultTtl} seconds`);
      try {
        await container.replace({
          id: CONFIG.CONTAINER_ID,
          partitionKey: { paths: [CONFIG.PARTITION_KEY_PATH] },
          defaultTtl: defaultTtl,
        });
      } catch (err) {
        log.warn('Failed to update container TTL, continuing with existing setting', err);
      }
    }

    log.info('Audit storage container initialized', {
      containerId: CONFIG.CONTAINER_ID,
      databaseId: CONFIG.DATABASE_ID,
      retentionDays,
      defaultTtl,
    });

    return container;
  } catch (error) {
    log.errorWithStack('Failed to initialize audit storage container', error);
    throw error;
  }
}

/**
 * Audit Persistence Service
 */
class AuditPersistenceService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Ensure the container is initialized
   */
  async _ensureInitialized() {
    if (!this.initialized) {
      await initContainer();
      this.initialized = true;
    }
  }

  /**
   * Create an audit log entry
   *
   * @param {Object} entry - Audit log entry
   * @param {string} entry.action - Action performed (create, update, delete, view, etc.)
   * @param {string} entry.entityType - Type of entity (document, user, system)
   * @param {string} entry.entityId - ID of the entity
   * @param {Object} entry.user - User performing the action
   * @param {Object} [entry.details] - Additional details
   * @returns {Promise<Object>} Created audit log
   */
  async createLog(entry) {
    await this._ensureInitialized();

    const { action, entityType, entityId, user, details = {} } = entry;

    if (!action || !entityType || !entityId) {
      throw new Error('Audit log requires action, entityType, and entityId');
    }

    // Support pre-calculated user fields (from legacy helpers) or extract from user object
    const userId = entry.userId || user?.id || user?.oid || user?.sub || user?.email || 'system';
    const userEmail = entry.userEmail || user?.email || user?.upn || user?.preferred_username;
    const userName = entry.userName || user?.name || user?.preferred_username;

    const logEntry = {
      // Cosmos DB requires an 'id'
      id: entry.id || `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      action,
      entityType, // Partition key
      entityId,
      userId,
      userEmail,
      userName,
      timestamp: entry.timestamp || new Date().toISOString(),
      details,
      // Helper for TTL if we want to override per-document, otherwise uses container default
    };

    try {
      const { resource } = await container.items.create(logEntry);
      return resource;
    } catch (error) {
      // We log error but don't re-throw to prevent audit failure from blocking business logic?
      // Actually, for security audits, we might WANT to fail if audit fails.
      // But standard practice often tries to be best-effort unless strict compliance mode.
      // I'll re-throw because the caller should decide.
      log.errorWithStack('Failed to create audit log', error);
      throw error;
    }
  }

  /**
   * Log an access denial (F5.1.3)
   *
   * @param {Object} denial - Denial details
   * @param {Object} user - User attempting access
   * @returns {Promise<Object>} Created audit log
   */
  async logDenial(denial, user) {
    return this.createLog({
      action: 'ACCESS_DENIED',
      entityType: 'security', // or 'document' if we want to partition by document type?
      // If we use 'security' as entityType, all denials go to one partition.
      // If we use the document's type, we need to know it.
      // Let's use 'security_denial' as entityType for clustering.
      // Or better: use the entityType of the target if available, or 'security'.
      // For now, consistent partition key is better for 'Show me all denials'.
      // If we partition by 'security', we can query all denials efficiently.
      entityId: denial.documentId || denial.id || 'unknown',
      user,
      details: {
        reason: denial.reason,
        requiredPermission: denial.requiredPermission,
        resourceName: denial.name,
      },
    });
  }

  /**
   * Query audit logs with filtering (legacy - returns array only)
   *
   * @param {Object} filters - Query filters
   * @param {string} [filters.entityId] - Filter by entity ID
   * @param {string} [filters.entityType] - Filter by entity type
   * @param {string} [filters.action] - Filter by action
   * @param {string} [filters.userId] - Filter by user ID
   * @param {Date} [filters.startDate] - Filter by start date
   * @param {Date} [filters.endDate] - Filter by end date
   * @param {number} [filters.limit] - Max logs to return
   * @returns {Promise<Array>} List of audit logs
   */
  async queryLogs(filters = {}) {
    // Delegate to paginated version for backward compatibility
    const result = await this.queryLogsPaginated(filters);
    return result.items;
  }

  /**
   * Query audit logs with cursor-based pagination (F5.2.4)
   *
   * @param {Object} filters - Query filters
   * @param {string} [filters.entityId] - Filter by entity ID
   * @param {string} [filters.entityType] - Filter by entity type
   * @param {string} [filters.action] - Filter by action
   * @param {string} [filters.userId] - Filter by user ID
   * @param {Date} [filters.startDate] - Filter by start date
   * @param {Date} [filters.endDate] - Filter by end date
   * @param {string} [filters.cursor] - Pagination cursor
   * @param {number} [filters.pageSize] - Page size (default 20, max 100)
   * @param {number} [filters.limit] - Alias for pageSize (legacy support)
   * @returns {Promise<Object>} Paginated response { items, pagination }
   */
  async queryLogsPaginated(filters = {}) {
    await this._ensureInitialized();

    const {
      buildPaginatedCosmosQuery,
      processPaginatedResults,
      parsePaginationParams,
    } = require('./pagination-service');

    const {
      entityId,
      entityType,
      action,
      userId,
      startDate,
      endDate,
    } = filters;

    // Parse pagination params
    const { cursor, pageSize } = parsePaginationParams({
      cursor: filters.cursor,
      pageSize: filters.pageSize || filters.limit,
    });

    const conditions = [];
    const parameters = [];

    // Build filter conditions
    if (entityType) {
      conditions.push('c.entityType = @entityType');
      parameters.push({ name: '@entityType', value: entityType });
    }

    if (entityId) {
      conditions.push('c.entityId = @entityId');
      parameters.push({ name: '@entityId', value: entityId });
    }

    if (action) {
      conditions.push('c.action = @action');
      parameters.push({ name: '@action', value: action });
    }

    if (userId) {
      conditions.push('c.userId = @userId');
      parameters.push({ name: '@userId', value: userId });
    }

    if (startDate) {
      conditions.push('c.timestamp >= @startDate');
      parameters.push({ name: '@startDate', value: new Date(startDate).toISOString() });
    }

    if (endDate) {
      conditions.push('c.timestamp <= @endDate');
      parameters.push({ name: '@endDate', value: new Date(endDate).toISOString() });
    }

    let baseQuery = 'SELECT * FROM c';
    if (conditions.length > 0) {
      baseQuery += ` WHERE ${conditions.join(' AND ')}`;
    }

    // Build paginated query with keyset pagination
    const { query, parameters: paginatedParams } = buildPaginatedCosmosQuery(
      baseQuery,
      { cursor, pageSize, sortField: 'timestamp', sortOrder: 'DESC' }
    );

    // Merge parameters
    const finalParams = [...parameters, ...paginatedParams];

    try {
      const { resources } = await container.items
        .query({ query, parameters: finalParams })
        .fetchAll();

      return processPaginatedResults(resources, { pageSize, sortField: 'timestamp' });
    } catch (error) {
      log.errorWithStack('Failed to query audit logs', error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this._ensureInitialized();
      const { resources } = await container.items
        .query({
          query: 'SELECT VALUE 1',
          parameters: [],
        })
        .fetchAll();
      return {
        healthy: true,
        containerId: CONFIG.CONTAINER_ID,
        databaseId: CONFIG.DATABASE_ID,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  }

  /**
   * Update retention policy
   * @param {number} days - Number of days to retain logs
   * @returns {Promise<Object>} - Updated policy status
   */
  async updateRetentionPolicy(days) {
    await this._ensureInitialized();

    if (!Number.isInteger(days) || days < 1) {
      throw new Error('Retention days must be a positive integer');
    }

    const ttlSeconds = days * 24 * 60 * 60;

    try {
      // 1. Update Cosmos DB Container TTL
      await container.replace({
        id: CONFIG.CONTAINER_ID,
        partitionKey: { paths: [CONFIG.PARTITION_KEY_PATH] },
        defaultTtl: ttlSeconds,
      });

      // 2. Update Configuration Service (Runtime override)
      const configService = getConfigurationService();
      configService.setOverride('AUDIT_LOG_RETENTION_DAYS', days);

      log.info(`Audit log retention policy updated to ${days} days (${ttlSeconds} seconds)`);

      return {
        success: true,
        retentionDays: days,
        ttlSeconds,
        message: `Retention policy updated to ${days} days`,
      };
    } catch (error) {
      log.errorWithStack('Failed to update audit retention policy', error);
      throw error;
    }
  }

  /**
   * Archive old logs (Placeholder for F5.1.5)
   * Currently retrieves logs older than X days.
   * @param {number} olderThanDays - Archive logs older than this
   * @returns {Promise<Object>} - Archival result
   */
  async archiveOldLogs(olderThanDays) {
    await this._ensureInitialized();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const query = `SELECT * FROM c WHERE c.timestamp < @cutoffDate`;
    const parameters = [{ name: '@cutoffDate', value: cutoffDate.toISOString() }];

    try {
      const { resources } = await container.items.query({ query, parameters }).fetchAll();
      
      log.info(`Found ${resources.length} audit logs older than ${olderThanDays} days for archiving`);
      
      // In a real implementation (F5.1.5), this would write to blob storage or file.
      // For now, we return them to the caller or just log count.
      return {
        count: resources.length,
        cutoffDate: cutoffDate.toISOString(),
        logs: resources, // Warning: could be large
      };
    } catch (error) {
      log.errorWithStack('Failed to archive old audit logs', error);
      throw error;
    }
  }

  /**
   * Run a retention sweep to archive/delete expired audit logs.
   *
   * @param {Object} [options]
   * @param {number} [options.retentionSeconds] - Override retention in seconds
   * @param {boolean} [options.archiveEnabled] - Whether to archive before deletion
   * @param {string} [options.archiveDir] - Directory for archives
   * @param {boolean} [options.dryRun] - If true, do not delete/archive
   * @param {number} [options.batchSize] - Query batch size
   * @param {boolean} [options.ensurePolicy] - If true, ensure container TTL matches retention
   * @returns {Promise<Object>} Sweep result summary
   */
  async runRetentionSweep(options = {}) {
    await this._ensureInitialized();

    const retentionDays = getConfig('AUDIT_LOG_RETENTION_DAYS') || 90;
    const retentionSeconds = Number.isFinite(options.retentionSeconds)
      ? options.retentionSeconds
      : retentionDays * 24 * 60 * 60;
    const archiveEnabled = options.archiveEnabled ?? getConfig('AUDIT_LOG_ARCHIVE_ENABLED') ?? false;
    const archiveDir = options.archiveDir || getConfig('AUDIT_LOG_ARCHIVE_DIR') || 'audit-archives';
    const dryRun = Boolean(options.dryRun);
    const batchSize = options.batchSize || 100;
    const ensurePolicy = options.ensurePolicy !== undefined ? options.ensurePolicy : true;

    if (ensurePolicy) {
      try {
        await this.updateRetentionPolicy(Math.max(1, Math.round(retentionSeconds / 86400)));
      } catch (error) {
        log.warn('Failed to ensure audit retention policy before sweep', { error: error.message });
      }
    }

    const cutoffDate = new Date(Date.now() - retentionSeconds * 1000);
    const query = 'SELECT * FROM c WHERE c.timestamp < @cutoffDate';
    const parameters = [{ name: '@cutoffDate', value: cutoffDate.toISOString() }];
    const iterator = container.items.query({
      query,
      parameters,
      maxItemCount: batchSize,
    });

    let scanned = 0;
    let deleted = 0;
    let archived = 0;
    let archivePath = null;
    const archiveLines = [];

    while (iterator.hasMoreResults()) {
      const { resources } = await iterator.fetchNext();
      if (!resources || resources.length === 0) {
        break;
      }

      for (const item of resources) {
        scanned += 1;

        if (!dryRun && archiveEnabled) {
          archiveLines.push(JSON.stringify(item));
          archived += 1;
        }

        if (!dryRun) {
          const partitionKey = item.entityType || 'unknown';
          await container.item(item.id, partitionKey).delete();
          deleted += 1;
        }
      }
    }

    if (!dryRun && archiveEnabled && archiveLines.length > 0) {
      fs.mkdirSync(archiveDir, { recursive: true });
      archivePath = path.join(archiveDir, `audit-archive-${Date.now()}.jsonl`);
      fs.writeFileSync(archivePath, `${archiveLines.join('\n')}\n`, 'utf8');
    }

    return {
      scanned,
      deleted,
      archived: dryRun ? 0 : archived,
      archivePath: dryRun ? null : archivePath,
      retentionSeconds,
      cutoffDate: cutoffDate.toISOString(),
      dryRun,
    };
  }
}

// Singleton instance
let instance = null;

function getAuditPersistenceService() {
  if (!instance) {
    instance = new AuditPersistenceService();
  }
  return instance;
}

function startAuditRetentionScheduler(options = {}) {
  if (retentionScheduler) {
    return retentionScheduler;
  }

  const sweepHours = options.sweepHours || getConfig('AUDIT_LOG_RETENTION_SWEEP_HOURS') || 24;
  const intervalMs = sweepHours * 60 * 60 * 1000;
  const service = getAuditPersistenceService();

  const runSweep = async () => {
    try {
      await service.runRetentionSweep();
    } catch (error) {
      log.errorWithStack('Audit retention sweep failed', error);
    }
  };

  // Run once at startup, then on interval.
  runSweep();
  retentionScheduler = setInterval(runSweep, intervalMs);
  if (typeof retentionScheduler.unref === 'function') {
    retentionScheduler.unref();
  }

  log.info('Audit retention scheduler started', { sweepHours });
  return retentionScheduler;
}

function __setAuditContainerForTesting(testContainer) {
  container = testContainer;
}

function __resetAuditContainerForTesting() {
  container = null;
  client = null;
  database = null;
  if (retentionScheduler) {
    clearInterval(retentionScheduler);
    retentionScheduler = null;
  }
}

module.exports = {
  AuditPersistenceService,
  getAuditPersistenceService,
  startAuditRetentionScheduler,
  CONFIG,
  __setAuditContainerForTesting,
  __resetAuditContainerForTesting,
};
