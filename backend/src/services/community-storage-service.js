/**
 * Community Storage Service
 *
 * Provides persistent storage for community detection results and summaries.
 * Uses Azure Cosmos DB for scalable, reliable storage.
 *
 * Feature: F3.1.2 - Community Storage
 *
 * Key capabilities:
 * - Store detected communities with membership and metadata
 * - Persist community summaries for fast retrieval
 * - Support incremental updates (lays foundation for F3.1.4)
 * - Track community evolution over time
 *
 * @see https://microsoft.github.io/graphrag/ - Microsoft GraphRAG architecture
 */

const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');
const { log } = require('../utils/logger');

/**
 * Configuration for community storage
 */
const CONFIG = {
  // Container settings
  CONTAINER_ID: process.env.COSMOS_DB_COMMUNITIES_CONTAINER || 'communities',
  DATABASE_ID: process.env.COSMOS_DB_DATABASE || 'knowledge-platform',

  // Partition strategy: Use communityId for efficient single-community queries
  // Also support bulk operations via cross-partition queries
  PARTITION_KEY_PATH: '/communityId',

  // TTL settings (optional - set to -1 to disable)
  DEFAULT_TTL_SECONDS: -1, // -1 = no automatic expiration

  // Query limits
  MAX_COMMUNITIES_PER_QUERY: 100,
  MAX_SUMMARIES_PER_QUERY: 50,

  // Version tracking for schema evolution
  SCHEMA_VERSION: '1.0.0',
};

/**
 * Document types stored in the communities container
 */
const DOC_TYPES = {
  COMMUNITY: 'community',
  SUMMARY: 'summary',
  DETECTION_RUN: 'detection_run',
  COMMUNITY_SNAPSHOT: 'community_snapshot',
};

let client = null;
let database = null;
let container = null;

/**
 * Get or create the Cosmos client
 */
function getClient() {
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const key = process.env.COSMOS_DB_KEY;

  if (!endpoint) {
    throw new Error('COSMOS_DB_ENDPOINT is required for community storage');
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
 * Initialize the communities container
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

    // Create or get communities container
    const { container: cont } = await database.containers.createIfNotExists({
      id: CONFIG.CONTAINER_ID,
      partitionKey: {
        paths: [CONFIG.PARTITION_KEY_PATH],
      },
      // Optional: Set default TTL at container level
      ...(CONFIG.DEFAULT_TTL_SECONDS > 0 && {
        defaultTtl: CONFIG.DEFAULT_TTL_SECONDS,
      }),
    });
    container = cont;

    log.info('Community storage container initialized', {
      containerId: CONFIG.CONTAINER_ID,
      databaseId: CONFIG.DATABASE_ID,
    });

    return container;
  } catch (error) {
    log.errorWithStack('Failed to initialize community storage container', error);
    throw error;
  }
}

/**
 * Community Storage Service
 * Provides persistent storage for community detection results and summaries
 */
class CommunityStorageService {
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

  // ==================== Community Detection Results ====================

  /**
   * Store a community detection run result
   *
   * @param {Object} detectionResult - Result from Louvain/Leiden algorithm
   * @param {Array} detectionResult.communityList - List of detected communities
   * @param {number} detectionResult.modularity - Modularity score
   * @param {Object} detectionResult.metadata - Detection metadata
   * @returns {Promise<Object>} Stored detection run document
   */
  async storeDetectionRun(detectionResult) {
    await this._ensureInitialized();

    const { communityList, modularity, metadata = {} } = detectionResult;
    const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    // Create detection run document
    const runDocument = {
      id: runId,
      docType: DOC_TYPES.DETECTION_RUN,
      communityId: 'detection_runs', // Partition key for run documents
      modularity,
      communityCount: communityList.length,
      totalEntities: communityList.reduce((sum, c) => sum + c.size, 0),
      algorithm: metadata.algorithm || 'louvain',
      resolution: metadata.resolution || 1.0,
      hierarchyLevels: metadata.hierarchyLevels || 1,
      createdAt: timestamp,
      schemaVersion: CONFIG.SCHEMA_VERSION,
      metadata,
    };

    try {
      const { resource: savedRun } = await container.items.create(runDocument);
      log.info('Community detection run stored', { runId, communityCount: communityList.length });

      // Store individual communities
      const storedCommunities = await this._storeCommunities(runId, communityList, timestamp);

      return {
        runId,
        run: savedRun,
        storedCommunityCount: storedCommunities.length,
      };
    } catch (error) {
      log.errorWithStack('Failed to store detection run', error);
      throw error;
    }
  }

  /**
   * Store individual communities from a detection run
   */
  async _storeCommunities(runId, communityList, timestamp) {
    const storedCommunities = [];

    for (const community of communityList) {
      const communityDoc = {
        id: `community_${runId}_${community.id}`,
        docType: DOC_TYPES.COMMUNITY,
        communityId: String(community.id),
        runId,
        size: community.size,
        members: community.members,
        typeCounts: community.typeCounts || {},
        dominantType: community.dominantType || 'Unknown',
        createdAt: timestamp,
        schemaVersion: CONFIG.SCHEMA_VERSION,
      };

      try {
        const { resource } = await container.items.create(communityDoc);
        storedCommunities.push(resource);
      } catch (error) {
        // Log but continue - partial storage is better than none
        log.warn('Failed to store community', {
          communityId: community.id,
          error: error.message,
        });
      }
    }

    return storedCommunities;
  }

  /**
   * Get the latest detection run
   *
   * @returns {Promise<Object|null>} Latest detection run or null
   */
  async getLatestDetectionRun() {
    await this._ensureInitialized();

    const query = {
      query: `
        SELECT * FROM c
        WHERE c.docType = @docType AND c.communityId = @partitionKey
        ORDER BY c.createdAt DESC
        OFFSET 0 LIMIT 1
      `,
      parameters: [
        { name: '@docType', value: DOC_TYPES.DETECTION_RUN },
        { name: '@partitionKey', value: 'detection_runs' },
      ],
    };

    try {
      const { resources } = await container.items.query(query).fetchAll();
      return resources.length > 0 ? resources[0] : null;
    } catch (error) {
      log.errorWithStack('Failed to get latest detection run', error);
      throw error;
    }
  }

  /**
   * Get all communities from a specific detection run
   *
   * @param {string} runId - Detection run ID
   * @returns {Promise<Array>} List of communities
   */
  async getCommunitiesByRunId(runId) {
    await this._ensureInitialized();

    const query = {
      query: `
        SELECT * FROM c
        WHERE c.docType = @docType AND c.runId = @runId
        ORDER BY c.size DESC
      `,
      parameters: [
        { name: '@docType', value: DOC_TYPES.COMMUNITY },
        { name: '@runId', value: runId },
      ],
    };

    try {
      const { resources } = await container.items.query(query).fetchAll();
      return resources;
    } catch (error) {
      log.errorWithStack('Failed to get communities by run ID', error);
      throw error;
    }
  }

  // ==================== Community Summaries ====================

  /**
   * Store a community summary
   *
   * @param {string|number} communityId - Community identifier
   * @param {Object} summary - Summary data
   * @returns {Promise<Object>} Stored summary document
   */
  async storeSummary(communityId, summary) {
    await this._ensureInitialized();

    const summaryDoc = {
      id: `summary_${communityId}`,
      docType: DOC_TYPES.SUMMARY,
      communityId: String(communityId),
      title: summary.title,
      summary: summary.summary,
      memberCount: summary.memberCount,
      dominantType: summary.dominantType,
      typeCounts: summary.typeCounts || {},
      relationshipCount: summary.relationshipCount || 0,
      keyEntities: summary.keyEntities || [],
      fallback: summary.fallback || false,
      generatedAt: summary.generatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: CONFIG.SCHEMA_VERSION,
    };

    try {
      // Upsert to handle updates
      const { resource } = await container.items.upsert(summaryDoc);
      log.debug('Community summary stored', { communityId, title: summary.title });
      return resource;
    } catch (error) {
      log.errorWithStack('Failed to store community summary', error);
      throw error;
    }
  }

  /**
   * Store multiple community summaries in batch
   *
   * @param {Object} summaries - Map of communityId -> summary
   * @returns {Promise<Object>} Batch storage result
   */
  async storeSummariesBatch(summaries) {
    await this._ensureInitialized();

    const results = {
      stored: 0,
      failed: 0,
      errors: [],
    };

    const entries = Object.entries(summaries);

    for (const [communityId, summary] of entries) {
      try {
        await this.storeSummary(communityId, summary);
        results.stored++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          communityId,
          error: error.message,
        });
      }
    }

    log.info('Batch summary storage completed', {
      total: entries.length,
      stored: results.stored,
      failed: results.failed,
    });

    return results;
  }

  /**
   * Get a community summary by ID
   *
   * @param {string|number} communityId - Community identifier
   * @returns {Promise<Object|null>} Summary or null if not found
   */
  async getSummary(communityId) {
    await this._ensureInitialized();

    const id = `summary_${communityId}`;
    const partitionKey = String(communityId);

    try {
      const { resource } = await container.item(id, partitionKey).read();
      return resource;
    } catch (error) {
      if (error.code === 404) {
        return null;
      }
      log.errorWithStack('Failed to get community summary', error);
      throw error;
    }
  }

  /**
   * Get multiple community summaries
   *
   * @param {Array<string|number>} communityIds - List of community IDs
   * @returns {Promise<Object>} Map of communityId -> summary
   */
  async getSummaries(communityIds) {
    await this._ensureInitialized();

    const result = {};

    if (!communityIds || communityIds.length === 0) {
      return result;
    }

    // Build query for multiple summaries
    const ids = communityIds.map((id) => `summary_${id}`);

    const query = {
      query: `
        SELECT * FROM c
        WHERE c.docType = @docType AND ARRAY_CONTAINS(@ids, c.id)
      `,
      parameters: [
        { name: '@docType', value: DOC_TYPES.SUMMARY },
        { name: '@ids', value: ids },
      ],
    };

    try {
      const { resources } = await container.items.query(query).fetchAll();

      for (const summary of resources) {
        result[summary.communityId] = summary;
      }

      return result;
    } catch (error) {
      log.errorWithStack('Failed to get community summaries', error);
      throw error;
    }
  }

  /**
   * Get all stored summaries
   *
   * @param {Object} options - Query options
   * @param {number} options.limit - Max summaries to return
   * @param {boolean} options.sortBySize - Sort by member count
   * @returns {Promise<Object>} Map of communityId -> summary
   */
  async getAllSummaries(options = {}) {
    await this._ensureInitialized();

    const { limit = CONFIG.MAX_SUMMARIES_PER_QUERY, sortBySize = true } = options;

    const query = {
      query: `
        SELECT * FROM c
        WHERE c.docType = @docType
        ORDER BY c.memberCount ${sortBySize ? 'DESC' : 'ASC'}
        OFFSET 0 LIMIT @limit
      `,
      parameters: [
        { name: '@docType', value: DOC_TYPES.SUMMARY },
        { name: '@limit', value: limit },
      ],
    };

    try {
      const { resources } = await container.items.query(query).fetchAll();

      const result = {};
      for (const summary of resources) {
        result[summary.communityId] = summary;
      }

      return result;
    } catch (error) {
      log.errorWithStack('Failed to get all summaries', error);
      throw error;
    }
  }

  /**
   * Delete a community summary
   *
   * @param {string|number} communityId - Community identifier
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteSummary(communityId) {
    await this._ensureInitialized();

    const id = `summary_${communityId}`;
    const partitionKey = String(communityId);

    try {
      await container.item(id, partitionKey).delete();
      log.debug('Community summary deleted', { communityId });
      return true;
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
      log.errorWithStack('Failed to delete community summary', error);
      throw error;
    }
  }

  // ==================== Community Snapshots ====================

  /**
   * Create a snapshot of all communities for historical tracking
   *
   * @param {Object} detectionResult - Full detection result
   * @param {Object} summaries - Community summaries
   * @returns {Promise<Object>} Snapshot document
   */
  async createSnapshot(detectionResult, summaries) {
    await this._ensureInitialized();

    const snapshotId = `snapshot_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const snapshotDoc = {
      id: snapshotId,
      docType: DOC_TYPES.COMMUNITY_SNAPSHOT,
      communityId: 'snapshots', // Partition key for snapshot documents
      modularity: detectionResult.modularity,
      communityCount: detectionResult.communityList?.length || 0,
      summaryCount: Object.keys(summaries).length,
      communities: detectionResult.communityList,
      summaries,
      createdAt: timestamp,
      schemaVersion: CONFIG.SCHEMA_VERSION,
    };

    try {
      const { resource } = await container.items.create(snapshotDoc);
      log.info('Community snapshot created', {
        snapshotId,
        communityCount: snapshotDoc.communityCount,
      });
      return resource;
    } catch (error) {
      log.errorWithStack('Failed to create community snapshot', error);
      throw error;
    }
  }

  /**
   * Get community snapshots for trend analysis
   *
   * @param {Object} options - Query options
   * @param {number} options.limit - Max snapshots to return
   * @returns {Promise<Array>} List of snapshots
   */
  async getSnapshots(options = {}) {
    await this._ensureInitialized();

    const { limit = 10 } = options;

    const query = {
      query: `
        SELECT c.id, c.modularity, c.communityCount, c.summaryCount, c.createdAt
        FROM c
        WHERE c.docType = @docType AND c.communityId = @partitionKey
        ORDER BY c.createdAt DESC
        OFFSET 0 LIMIT @limit
      `,
      parameters: [
        { name: '@docType', value: DOC_TYPES.COMMUNITY_SNAPSHOT },
        { name: '@partitionKey', value: 'snapshots' },
        { name: '@limit', value: limit },
      ],
    };

    try {
      const { resources } = await container.items.query(query).fetchAll();
      return resources;
    } catch (error) {
      log.errorWithStack('Failed to get community snapshots', error);
      throw error;
    }
  }

  // ==================== Utility Methods ====================

  /**
   * Get storage statistics
   *
   * @returns {Promise<Object>} Storage statistics
   */
  async getStats() {
    await this._ensureInitialized();

    const queries = [
      {
        query: 'SELECT VALUE COUNT(1) FROM c WHERE c.docType = @docType',
        parameters: [{ name: '@docType', value: DOC_TYPES.COMMUNITY }],
      },
      {
        query: 'SELECT VALUE COUNT(1) FROM c WHERE c.docType = @docType',
        parameters: [{ name: '@docType', value: DOC_TYPES.SUMMARY }],
      },
      {
        query: 'SELECT VALUE COUNT(1) FROM c WHERE c.docType = @docType',
        parameters: [{ name: '@docType', value: DOC_TYPES.DETECTION_RUN }],
      },
      {
        query: 'SELECT VALUE COUNT(1) FROM c WHERE c.docType = @docType',
        parameters: [{ name: '@docType', value: DOC_TYPES.COMMUNITY_SNAPSHOT }],
      },
    ];

    try {
      const [communities, summaries, detectionRuns, snapshots] = await Promise.all(
        queries.map(async (q) => {
          const { resources } = await container.items.query(q).fetchAll();
          return resources[0] || 0;
        })
      );

      const latestRun = await this.getLatestDetectionRun();

      return {
        communityCount: communities,
        summaryCount: summaries,
        detectionRunCount: detectionRuns,
        snapshotCount: snapshots,
        latestRunId: latestRun?.id || null,
        latestModularity: latestRun?.modularity || null,
        latestRunAt: latestRun?.createdAt || null,
        schemaVersion: CONFIG.SCHEMA_VERSION,
      };
    } catch (error) {
      log.errorWithStack('Failed to get storage stats', error);
      throw error;
    }
  }

  /**
   * Clear all stored communities and summaries
   * WARNING: This is a destructive operation
   *
   * @param {Object} options - Options
   * @param {boolean} options.preserveSnapshots - Keep snapshots
   * @returns {Promise<Object>} Deletion result
   */
  async clearStorage(options = {}) {
    await this._ensureInitialized();

    const { preserveSnapshots = true } = options;

    const docTypesToDelete = [DOC_TYPES.COMMUNITY, DOC_TYPES.SUMMARY, DOC_TYPES.DETECTION_RUN];

    if (!preserveSnapshots) {
      docTypesToDelete.push(DOC_TYPES.COMMUNITY_SNAPSHOT);
    }

    let deletedCount = 0;

    for (const docType of docTypesToDelete) {
      const query = {
        query: 'SELECT c.id, c.communityId FROM c WHERE c.docType = @docType',
        parameters: [{ name: '@docType', value: docType }],
      };

      try {
        const { resources } = await container.items.query(query).fetchAll();

        for (const doc of resources) {
          try {
            await container.item(doc.id, doc.communityId).delete();
            deletedCount++;
          } catch (deleteError) {
            if (deleteError.code !== 404) {
              log.warn('Failed to delete document', {
                id: doc.id,
                error: deleteError.message,
              });
            }
          }
        }
      } catch (error) {
        log.warn('Failed to query documents for deletion', {
          docType,
          error: error.message,
        });
      }
    }

    log.info('Community storage cleared', { deletedCount, preserveSnapshots });

    return { deletedCount, preserveSnapshots };
  }

  /**
   * Check if storage is healthy and accessible
   *
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      await this._ensureInitialized();

      // Simple query to verify connectivity
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
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Singleton instance
let instance = null;

function getCommunityStorageService() {
  if (!instance) {
    instance = new CommunityStorageService();
  }
  return instance;
}

module.exports = {
  CommunityStorageService,
  getCommunityStorageService,
  CONFIG,
  DOC_TYPES,
};
