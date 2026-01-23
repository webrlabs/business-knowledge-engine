/**
 * Cosmos DB Storage Adapter for Ontology Migrations
 *
 * Provides persistent storage for migration history using Azure Cosmos DB.
 * Tracks applied migrations, rollbacks, and failure records.
 *
 * @module services/migration-storage-adapter
 * @see Feature F2.2.2 - Migration Framework
 */

const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');
const { log } = require('../utils/logger');
const { MigrationStorageAdapter } = require('./ontology-migration-service');

const CONTAINER_ID = process.env.COSMOS_DB_MIGRATIONS_CONTAINER || 'ontology-migrations';
const DATABASE_ID = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';

class CosmosMigrationStorageAdapter extends MigrationStorageAdapter {
  constructor(options = {}) {
    super();
    this._client = null;
    this._database = null;
    this._container = null;
    this._initialized = false;
    this._endpoint = options.endpoint || process.env.COSMOS_DB_ENDPOINT;
    this._key = options.key || process.env.COSMOS_DB_KEY;
  }

  /**
   * Get or create the Cosmos client
   */
  _getClient() {
    if (this._client) {
      return this._client;
    }

    if (!this._endpoint) {
      throw new Error('COSMOS_DB_ENDPOINT is required');
    }

    if (this._key) {
      this._client = new CosmosClient({ endpoint: this._endpoint, key: this._key });
    } else {
      this._client = new CosmosClient({
        endpoint: this._endpoint,
        aadCredentials: new DefaultAzureCredential(),
      });
    }

    return this._client;
  }

  /**
   * Initialize the Cosmos container for migrations
   */
  async initialize() {
    if (this._initialized) {
      return;
    }

    try {
      const client = this._getClient();

      const { database } = await client.databases.createIfNotExists({
        id: DATABASE_ID,
      });
      this._database = database;

      const { container } = await database.containers.createIfNotExists({
        id: CONTAINER_ID,
        partitionKey: {
          paths: ['/recordType'],
        },
      });
      this._container = container;

      this._initialized = true;
      log.info('[CosmosMigrationStorageAdapter] Initialized');
    } catch (error) {
      log.error('[CosmosMigrationStorageAdapter] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Ensure adapter is initialized
   */
  async _ensureInitialized() {
    if (!this._initialized) {
      await this.initialize();
    }
  }

  /**
   * Get all migration records
   * @returns {Promise<Array>} - Migration history records
   */
  async getMigrationHistory() {
    await this._ensureInitialized();

    try {
      const query = {
        query: 'SELECT * FROM c WHERE c.recordType = @recordType ORDER BY c.version ASC',
        parameters: [{ name: '@recordType', value: 'migration' }],
      };

      const { resources } = await this._container.items.query(query).fetchAll();
      return resources.map(this._mapRecord);
    } catch (error) {
      log.error('[CosmosMigrationStorageAdapter] Failed to get migration history:', error);
      throw error;
    }
  }

  /**
   * Get a specific migration record by version
   * @param {string} version - Migration version
   * @returns {Promise<Object|null>} - Migration record or null
   */
  async getMigrationRecord(version) {
    await this._ensureInitialized();

    try {
      const { resource } = await this._container.item(version, 'migration').read();
      return resource ? this._mapRecord(resource) : null;
    } catch (error) {
      if (error.code === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save a migration record
   * @param {Object} record - Migration record to save
   */
  async saveMigrationRecord(record) {
    await this._ensureInitialized();

    try {
      const doc = {
        id: record.version,
        recordType: 'migration',
        version: record.version,
        name: record.name,
        description: record.description,
        status: record.status,
        appliedAt: record.appliedAt || null,
        rolledBackAt: record.rolledBackAt || null,
        durationMs: record.durationMs || null,
        error: record.error || null,
        changes: record.changes || null,
        updatedAt: new Date().toISOString(),
      };

      await this._container.items.upsert(doc);
      log.debug(`[CosmosMigrationStorageAdapter] Saved migration record: ${record.version}`);
    } catch (error) {
      log.error(`[CosmosMigrationStorageAdapter] Failed to save migration record ${record.version}:`, error);
      throw error;
    }
  }

  /**
   * Delete a migration record
   * @param {string} version - Migration version to delete
   */
  async deleteMigrationRecord(version) {
    await this._ensureInitialized();

    try {
      await this._container.item(version, 'migration').delete();
      log.debug(`[CosmosMigrationStorageAdapter] Deleted migration record: ${version}`);
    } catch (error) {
      if (error.code === 404) {
        return; // Already deleted
      }
      throw error;
    }
  }

  /**
   * Get the latest applied migration version
   * @returns {Promise<string|null>} - Latest version or null
   */
  async getLatestAppliedVersion() {
    await this._ensureInitialized();

    try {
      const query = {
        query: `
          SELECT TOP 1 c.version
          FROM c
          WHERE c.recordType = @recordType AND c.status = @status
          ORDER BY c.appliedAt DESC
        `,
        parameters: [
          { name: '@recordType', value: 'migration' },
          { name: '@status', value: 'applied' },
        ],
      };

      const { resources } = await this._container.items.query(query).fetchAll();
      return resources.length > 0 ? resources[0].version : null;
    } catch (error) {
      log.error('[CosmosMigrationStorageAdapter] Failed to get latest version:', error);
      throw error;
    }
  }

  /**
   * Map Cosmos document to migration record
   */
  _mapRecord(doc) {
    return {
      version: doc.version,
      name: doc.name,
      description: doc.description,
      status: doc.status,
      appliedAt: doc.appliedAt,
      rolledBackAt: doc.rolledBackAt,
      durationMs: doc.durationMs,
      error: doc.error,
      changes: doc.changes,
    };
  }
}

/**
 * File-based storage adapter for local development/testing
 */
class FileMigrationStorageAdapter extends MigrationStorageAdapter {
  constructor(options = {}) {
    super();
    this._fs = require('fs');
    this._path = require('path');
    this._filePath = options.filePath || this._path.resolve(__dirname, '../../../ontology/migrations/.history.json');
  }

  async getMigrationHistory() {
    try {
      if (!this._fs.existsSync(this._filePath)) {
        return [];
      }
      const content = this._fs.readFileSync(this._filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      log.warn('[FileMigrationStorageAdapter] Failed to read history:', error.message);
      return [];
    }
  }

  async saveMigrationRecord(record) {
    const history = await this.getMigrationHistory();
    const index = history.findIndex(r => r.version === record.version);

    if (index >= 0) {
      history[index] = { ...history[index], ...record, updatedAt: new Date().toISOString() };
    } else {
      history.push({ ...record, updatedAt: new Date().toISOString() });
    }

    // Sort by version
    history.sort((a, b) => {
      const [aMaj, aMin, aPat] = a.version.split('.').map(Number);
      const [bMaj, bMin, bPat] = b.version.split('.').map(Number);
      return aMaj - bMaj || aMin - bMin || aPat - bPat;
    });

    const dir = this._path.dirname(this._filePath);
    if (!this._fs.existsSync(dir)) {
      this._fs.mkdirSync(dir, { recursive: true });
    }

    this._fs.writeFileSync(this._filePath, JSON.stringify(history, null, 2), 'utf8');
  }
}

/**
 * Factory function to create the appropriate storage adapter
 */
function createMigrationStorageAdapter(options = {}) {
  const type = options.type || process.env.MIGRATION_STORAGE_TYPE || 'cosmos';

  switch (type) {
    case 'cosmos':
      return new CosmosMigrationStorageAdapter(options);
    case 'file':
      return new FileMigrationStorageAdapter(options);
    case 'memory':
      const { InMemoryMigrationStorage } = require('./ontology-migration-service');
      return new InMemoryMigrationStorage();
    default:
      throw new Error(`Unknown migration storage type: ${type}`);
  }
}

module.exports = {
  CosmosMigrationStorageAdapter,
  FileMigrationStorageAdapter,
  createMigrationStorageAdapter,
};
