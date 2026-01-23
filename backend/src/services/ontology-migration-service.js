/**
 * Ontology Migration Service
 *
 * Provides a framework for defining and running ontology schema migrations.
 * Tracks migration history, supports dry-run mode, and enables controlled
 * evolution of the ontology schema.
 *
 * Features:
 * - Load migrations from /ontology/migrations/ directory
 * - Track applied migrations in Cosmos DB
 * - Execute migrations in version order
 * - Dry-run mode to preview changes
 * - Rollback support (prepared for F2.2.5)
 * - Migration validation before execution
 *
 * Migration file format:
 *   Module must export: { version, name, description, up, down, validate? }
 *
 * @module services/ontology-migration-service
 * @see Feature F2.2.2 - Migration Framework
 */

const fs = require('fs');
const path = require('path');
const { log } = require('../utils/logger');
const { trackEvent } = require('../utils/telemetry');
const { getOntologyService } = require('./ontology-service');

/**
 * Migration status constants
 */
const MIGRATION_STATUS = {
  PENDING: 'pending',
  APPLIED: 'applied',
  ROLLED_BACK: 'rolled_back',
  FAILED: 'failed',
};

/**
 * Migration context passed to up/down functions
 */
class MigrationContext {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.ontologyService = options.ontologyService || null;
    this.graphService = options.graphService || null;
    this.storage = options.storage || null;
    this.logger = options.logger || log;

    // Track changes for dry-run reporting
    this.changes = {
      addedEntityTypes: [],
      removedEntityTypes: [],
      modifiedEntityTypes: [],
      addedRelationshipTypes: [],
      removedRelationshipTypes: [],
      modifiedRelationshipTypes: [],
      addedProperties: [],
      removedProperties: [],
      modifiedProperties: [],
      entitiesAffected: 0,
      relationshipsAffected: 0,
      warnings: [],
    };
  }

  /**
   * Record an entity type addition
   */
  addEntityType(typeName, definition) {
    this.changes.addedEntityTypes.push({ typeName, definition });
    this.logger.debug(`[Migration] Add entity type: ${typeName}`);
  }

  /**
   * Record an entity type removal
   */
  removeEntityType(typeName) {
    this.changes.removedEntityTypes.push({ typeName });
    this.logger.debug(`[Migration] Remove entity type: ${typeName}`);
  }

  /**
   * Record an entity type modification
   */
  modifyEntityType(typeName, changes) {
    this.changes.modifiedEntityTypes.push({ typeName, changes });
    this.logger.debug(`[Migration] Modify entity type: ${typeName}`);
  }

  /**
   * Record a relationship type addition
   */
  addRelationshipType(typeName, definition) {
    this.changes.addedRelationshipTypes.push({ typeName, definition });
    this.logger.debug(`[Migration] Add relationship type: ${typeName}`);
  }

  /**
   * Record a relationship type removal
   */
  removeRelationshipType(typeName) {
    this.changes.removedRelationshipTypes.push({ typeName });
    this.logger.debug(`[Migration] Remove relationship type: ${typeName}`);
  }

  /**
   * Record a relationship type modification
   */
  modifyRelationshipType(typeName, changes) {
    this.changes.modifiedRelationshipTypes.push({ typeName, changes });
    this.logger.debug(`[Migration] Modify relationship type: ${typeName}`);
  }

  /**
   * Record a property addition
   */
  addProperty(propertyName, definition) {
    this.changes.addedProperties.push({ propertyName, definition });
    this.logger.debug(`[Migration] Add property: ${propertyName}`);
  }

  /**
   * Record a property removal
   */
  removeProperty(propertyName) {
    this.changes.removedProperties.push({ propertyName });
    this.logger.debug(`[Migration] Remove property: ${propertyName}`);
  }

  /**
   * Record a property modification
   */
  modifyProperty(propertyName, changes) {
    this.changes.modifiedProperties.push({ propertyName, changes });
    this.logger.debug(`[Migration] Modify property: ${propertyName}`);
  }

  /**
   * Record entities affected by the migration
   */
  recordEntitiesAffected(count) {
    this.changes.entitiesAffected += count;
  }

  /**
   * Record relationships affected by the migration
   */
  recordRelationshipsAffected(count) {
    this.changes.relationshipsAffected += count;
  }

  /**
   * Add a warning message
   */
  addWarning(message) {
    this.changes.warnings.push(message);
    this.logger.warn(`[Migration] Warning: ${message}`);
  }

  /**
   * Get summary of changes
   */
  getChangesSummary() {
    return {
      ...this.changes,
      totalTypeChanges:
        this.changes.addedEntityTypes.length +
        this.changes.removedEntityTypes.length +
        this.changes.modifiedEntityTypes.length +
        this.changes.addedRelationshipTypes.length +
        this.changes.removedRelationshipTypes.length +
        this.changes.modifiedRelationshipTypes.length +
        this.changes.addedProperties.length +
        this.changes.removedProperties.length +
        this.changes.modifiedProperties.length,
    };
  }
}

/**
 * Ontology Migration Service
 */
class OntologyMigrationService {
  constructor(options = {}) {
    this.migrationsDir = options.migrationsDir ||
      path.resolve(__dirname, '../../../ontology/migrations');
    this.storage = options.storage || null;
    this.graphService = options.graphService || null;
    this.ontologyService = options.ontologyService || null;

    this._migrations = new Map(); // version -> migration
    this._appliedMigrations = new Map(); // version -> record
    this._initialized = false;
  }

  /**
   * Initialize the migration service
   */
  async initialize() {
    if (this._initialized) {
      return;
    }

    log.info('[OntologyMigrationService] Initializing...');

    // Load migrations from disk
    await this._loadMigrations();

    // Load applied migrations from storage
    await this._loadAppliedMigrations();

    this._initialized = true;

    log.info('[OntologyMigrationService] Initialized', {
      totalMigrations: this._migrations.size,
      appliedMigrations: this._appliedMigrations.size,
      pendingMigrations: this.getPendingMigrations().length,
    });
  }

  /**
   * Load migration files from the migrations directory
   */
  async _loadMigrations() {
    if (!fs.existsSync(this.migrationsDir)) {
      log.info(`[OntologyMigrationService] Migrations directory does not exist: ${this.migrationsDir}`);
      fs.mkdirSync(this.migrationsDir, { recursive: true });
      return;
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.js') || f.endsWith('.json'))
      .sort(); // Sort by filename (version prefix ensures order)

    for (const file of files) {
      try {
        const filePath = path.join(this.migrationsDir, file);
        let migration;

        if (file.endsWith('.js')) {
          // JavaScript migration (can have up/down functions)
          migration = require(filePath);
        } else if (file.endsWith('.json')) {
          // JSON migration (declarative format)
          const content = fs.readFileSync(filePath, 'utf8');
          migration = this._parseJsonMigration(JSON.parse(content));
        }

        // Validate migration structure
        const validation = this._validateMigration(migration, file);
        if (!validation.valid) {
          log.error(`[OntologyMigrationService] Invalid migration ${file}:`, validation.errors);
          continue;
        }

        this._migrations.set(migration.version, {
          ...migration,
          filename: file,
          filepath: filePath,
        });

        log.debug(`[OntologyMigrationService] Loaded migration: ${migration.version} - ${migration.name}`);
      } catch (error) {
        log.error(`[OntologyMigrationService] Failed to load migration ${file}:`, error);
      }
    }
  }

  /**
   * Parse a JSON migration file into executable format
   */
  _parseJsonMigration(json) {
    return {
      version: json.version,
      name: json.name,
      description: json.description,
      targetOntologyVersion: json.targetOntologyVersion,
      changes: json.changes || {},

      // Generate up function from declarative changes
      up: async (context) => {
        const changes = json.changes || {};

        // Add entity types
        for (const entityType of changes.addEntityTypes || []) {
          context.addEntityType(entityType.name, entityType);
        }

        // Remove entity types
        for (const typeName of changes.removeEntityTypes || []) {
          context.removeEntityType(typeName);
        }

        // Modify entity types
        for (const modification of changes.modifyEntityTypes || []) {
          context.modifyEntityType(modification.name, modification.changes);
        }

        // Add relationship types
        for (const relType of changes.addRelationshipTypes || []) {
          context.addRelationshipType(relType.name, relType);
        }

        // Remove relationship types
        for (const typeName of changes.removeRelationshipTypes || []) {
          context.removeRelationshipType(typeName);
        }

        // Modify relationship types
        for (const modification of changes.modifyRelationshipTypes || []) {
          context.modifyRelationshipType(modification.name, modification.changes);
        }

        // Add properties
        for (const property of changes.addProperties || []) {
          context.addProperty(property.name, property);
        }

        // Remove properties
        for (const propertyName of changes.removeProperties || []) {
          context.removeProperty(propertyName);
        }

        // Modify properties
        for (const modification of changes.modifyProperties || []) {
          context.modifyProperty(modification.name, modification.changes);
        }

        // Entity transformations
        if (changes.transformEntities && !context.dryRun) {
          for (const transform of changes.transformEntities) {
            const count = await context.graphService?.transformEntities?.(transform) || 0;
            context.recordEntitiesAffected(count);
          }
        }

        // Relationship transformations
        if (changes.transformRelationships && !context.dryRun) {
          for (const transform of changes.transformRelationships) {
            const count = await context.graphService?.transformRelationships?.(transform) || 0;
            context.recordRelationshipsAffected(count);
          }
        }
      },

      // Generate down function (reverse of up)
      down: async (context) => {
        const changes = json.changes || {};

        // Reverse: remove added entity types
        for (const entityType of changes.addEntityTypes || []) {
          context.removeEntityType(entityType.name);
        }

        // Reverse: add removed entity types (if definition provided)
        for (const removal of changes.removeEntityTypes || []) {
          if (typeof removal === 'object' && removal.originalDefinition) {
            context.addEntityType(removal.name, removal.originalDefinition);
          }
        }

        // Similar for relationships...
        for (const relType of changes.addRelationshipTypes || []) {
          context.removeRelationshipType(relType.name);
        }

        // Reverse: remove added properties
        for (const property of changes.addProperties || []) {
          context.removeProperty(property.name);
        }

        // Note: Full reversal may not always be possible
        context.addWarning('JSON migrations have limited rollback capability');
      },

      // Optional validation function
      validate: json.validate ? eval(`(${json.validate})`) : undefined,
    };
  }

  /**
   * Validate migration structure
   */
  _validateMigration(migration, filename) {
    const errors = [];

    if (!migration.version) {
      errors.push('Migration must have a "version" field');
    } else if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(migration.version)) {
      errors.push(`Invalid version format: ${migration.version}. Expected semantic version (e.g., "1.0.1")`);
    }

    if (!migration.name) {
      errors.push('Migration must have a "name" field');
    }

    if (!migration.up || typeof migration.up !== 'function') {
      errors.push('Migration must have an "up" function');
    }

    // down function is optional but recommended
    if (migration.down && typeof migration.down !== 'function') {
      errors.push('"down" must be a function if provided');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Load applied migrations from persistent storage
   */
  async _loadAppliedMigrations() {
    if (!this.storage) {
      log.debug('[OntologyMigrationService] No storage configured, using in-memory tracking');
      return;
    }

    try {
      const records = await this.storage.getMigrationHistory();
      for (const record of records) {
        if (record.status === MIGRATION_STATUS.APPLIED) {
          this._appliedMigrations.set(record.version, record);
        }
      }
    } catch (error) {
      log.warn('[OntologyMigrationService] Failed to load migration history:', error.message);
    }
  }

  /**
   * Get all registered migrations sorted by version
   */
  getAllMigrations() {
    this._ensureInitialized();

    return Array.from(this._migrations.values())
      .sort((a, b) => this._compareVersions(a.version, b.version))
      .map(m => ({
        version: m.version,
        name: m.name,
        description: m.description,
        filename: m.filename,
        status: this._appliedMigrations.has(m.version)
          ? MIGRATION_STATUS.APPLIED
          : MIGRATION_STATUS.PENDING,
        appliedAt: this._appliedMigrations.get(m.version)?.appliedAt || null,
      }));
  }

  /**
   * Get pending (not yet applied) migrations
   */
  getPendingMigrations() {
    this._ensureInitialized();

    return this.getAllMigrations()
      .filter(m => m.status === MIGRATION_STATUS.PENDING);
  }

  /**
   * Get applied migrations
   */
  getAppliedMigrations() {
    this._ensureInitialized();

    return this.getAllMigrations()
      .filter(m => m.status === MIGRATION_STATUS.APPLIED);
  }

  /**
   * Run a single migration
   * @param {string} version - Migration version to run
   * @param {Object} options - Options
   * @param {boolean} options.dryRun - If true, preview changes without applying
   * @returns {Object} - Migration result
   */
  async runMigration(version, options = {}) {
    this._ensureInitialized();

    const { dryRun = false } = options;

    const migration = this._migrations.get(version);
    if (!migration) {
      throw new Error(`Migration ${version} not found`);
    }

    if (this._appliedMigrations.has(version) && !dryRun) {
      throw new Error(`Migration ${version} has already been applied`);
    }

    log.info(`[OntologyMigrationService] ${dryRun ? 'Dry-run' : 'Running'} migration: ${version} - ${migration.name}`);

    const context = new MigrationContext({
      dryRun,
      ontologyService: this.ontologyService || getOntologyService(),
      graphService: this.graphService,
      storage: this.storage,
    });

    const startTime = Date.now();
    let error = null;

    try {
      // Run optional validation first
      if (migration.validate) {
        const validationResult = await migration.validate(context);
        if (validationResult && !validationResult.valid) {
          throw new Error(`Validation failed: ${validationResult.errors?.join(', ')}`);
        }
      }

      // Execute the migration
      await migration.up(context);

      // If not dry run, record the migration
      if (!dryRun) {
        const record = {
          version: migration.version,
          name: migration.name,
          description: migration.description,
          status: MIGRATION_STATUS.APPLIED,
          appliedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          changes: context.getChangesSummary(),
        };

        this._appliedMigrations.set(version, record);

        if (this.storage) {
          await this.storage.saveMigrationRecord(record);
        }

        trackEvent('ontology_migration_applied', {
          version,
          name: migration.name,
          durationMs: record.durationMs,
        });
      }
    } catch (err) {
      error = err;
      log.error(`[OntologyMigrationService] Migration ${version} failed:`, err);

      if (!dryRun && this.storage) {
        await this.storage.saveMigrationRecord({
          version: migration.version,
          name: migration.name,
          status: MIGRATION_STATUS.FAILED,
          appliedAt: new Date().toISOString(),
          error: err.message,
        });
      }

      trackEvent('ontology_migration_failed', {
        version,
        name: migration.name,
        error: err.message,
      });
    }

    const result = {
      version,
      name: migration.name,
      dryRun,
      success: !error,
      error: error?.message || null,
      durationMs: Date.now() - startTime,
      changes: context.getChangesSummary(),
    };

    log.info(`[OntologyMigrationService] Migration ${version} ${result.success ? 'completed' : 'failed'}`, {
      dryRun,
      durationMs: result.durationMs,
      changes: result.changes.totalTypeChanges,
    });

    return result;
  }

  /**
   * Run all pending migrations
   * @param {Object} options - Options
   * @param {boolean} options.dryRun - If true, preview changes without applying
   * @param {boolean} options.stopOnError - If true, stop on first error (default: true)
   * @returns {Object} - Results summary
   */
  async runAllPending(options = {}) {
    this._ensureInitialized();

    const { dryRun = false, stopOnError = true } = options;
    const pending = this.getPendingMigrations();

    if (pending.length === 0) {
      log.info('[OntologyMigrationService] No pending migrations');
      return {
        migrationsRun: 0,
        success: true,
        results: [],
      };
    }

    log.info(`[OntologyMigrationService] ${dryRun ? 'Dry-run' : 'Running'} ${pending.length} pending migrations`);

    const results = [];
    let hasError = false;

    for (const migration of pending) {
      if (hasError && stopOnError) {
        results.push({
          version: migration.version,
          name: migration.name,
          skipped: true,
          reason: 'Previous migration failed',
        });
        continue;
      }

      const result = await this.runMigration(migration.version, { dryRun });
      results.push(result);

      if (!result.success) {
        hasError = true;
      }
    }

    return {
      migrationsRun: results.filter(r => !r.skipped).length,
      success: !hasError,
      dryRun,
      results,
    };
  }

  /**
   * Rollback a migration (run its down function)
   * @param {string} version - Migration version to rollback
   * @param {Object} options - Options
   * @param {boolean} options.dryRun - If true, preview changes without applying
   * @returns {Object} - Rollback result
   */
  async rollbackMigration(version, options = {}) {
    this._ensureInitialized();

    const { dryRun = false } = options;

    const migration = this._migrations.get(version);
    if (!migration) {
      throw new Error(`Migration ${version} not found`);
    }

    if (!this._appliedMigrations.has(version)) {
      throw new Error(`Migration ${version} has not been applied`);
    }

    if (!migration.down) {
      throw new Error(`Migration ${version} does not support rollback (no "down" function)`);
    }

    log.info(`[OntologyMigrationService] ${dryRun ? 'Dry-run rollback' : 'Rolling back'} migration: ${version}`);

    const context = new MigrationContext({
      dryRun,
      ontologyService: this.ontologyService || getOntologyService(),
      graphService: this.graphService,
      storage: this.storage,
    });

    const startTime = Date.now();
    let error = null;

    try {
      await migration.down(context);

      if (!dryRun) {
        this._appliedMigrations.delete(version);

        if (this.storage) {
          await this.storage.saveMigrationRecord({
            version: migration.version,
            name: migration.name,
            status: MIGRATION_STATUS.ROLLED_BACK,
            rolledBackAt: new Date().toISOString(),
          });
        }

        trackEvent('ontology_migration_rolled_back', {
          version,
          name: migration.name,
        });
      }
    } catch (err) {
      error = err;
      log.error(`[OntologyMigrationService] Rollback of ${version} failed:`, err);
    }

    return {
      version,
      name: migration.name,
      dryRun,
      success: !error,
      error: error?.message || null,
      durationMs: Date.now() - startTime,
      changes: context.getChangesSummary(),
    };
  }

  /**
   * Get migration status summary
   */
  getStatus() {
    this._ensureInitialized();

    const all = this.getAllMigrations();
    const pending = all.filter(m => m.status === MIGRATION_STATUS.PENDING);
    const applied = all.filter(m => m.status === MIGRATION_STATUS.APPLIED);

    return {
      totalMigrations: all.length,
      pendingCount: pending.length,
      appliedCount: applied.length,
      hasPending: pending.length > 0,
      nextPending: pending.length > 0 ? pending[0] : null,
      lastApplied: applied.length > 0 ? applied[applied.length - 1] : null,
      migrations: all,
    };
  }

  /**
   * Create a new migration file
   * @param {Object} options - Migration options
   * @param {string} options.name - Migration name (slug format)
   * @param {string} options.description - Migration description
   * @param {string} options.targetVersion - Target ontology version
   * @param {'js'|'json'} options.format - File format (default: 'js')
   * @returns {Object} - Created migration info
   */
  createMigration(options = {}) {
    const { name, description, targetVersion, format = 'js' } = options;

    if (!name) {
      throw new Error('Migration name is required');
    }

    // Generate version based on current ontology version or timestamp
    const ontologyService = this.ontologyService || getOntologyService();
    let nextVersion;

    if (ontologyService.initialized) {
      nextVersion = ontologyService.getNextVersion('minor');
    } else {
      // Fallback to timestamp-based version
      const now = new Date();
      nextVersion = `0.0.${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    }

    // Sanitize name for filename
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${nextVersion}-${slug}.${format}`;
    const filepath = path.join(this.migrationsDir, filename);

    // Check if file already exists
    if (fs.existsSync(filepath)) {
      throw new Error(`Migration file already exists: ${filename}`);
    }

    let content;
    if (format === 'js') {
      content = this._generateJsMigrationTemplate(nextVersion, name, description, targetVersion);
    } else {
      content = this._generateJsonMigrationTemplate(nextVersion, name, description, targetVersion);
    }

    fs.writeFileSync(filepath, content, 'utf8');

    log.info(`[OntologyMigrationService] Created migration: ${filename}`);

    return {
      version: nextVersion,
      name,
      filename,
      filepath,
      format,
    };
  }

  /**
   * Generate JavaScript migration template
   */
  _generateJsMigrationTemplate(version, name, description, targetVersion) {
    return `/**
 * Migration: ${name}
 * Version: ${version}
 * Target Ontology Version: ${targetVersion || 'N/A'}
 *
 * ${description || 'TODO: Add description'}
 */

module.exports = {
  version: '${version}',
  name: '${name}',
  description: '${description || ''}',
  targetOntologyVersion: ${targetVersion ? `'${targetVersion}'` : 'null'},

  /**
   * Apply the migration
   * @param {MigrationContext} context - Migration context with helpers
   */
  async up(context) {
    // Example: Add a new entity type
    // context.addEntityType('NewType', {
    //   label: 'New Type',
    //   comment: 'Description of the new type',
    //   parent: 'Entity',
    // });

    // Example: Add a new relationship type
    // context.addRelationshipType('NEW_RELATION', {
    //   label: 'new relation',
    //   domain: 'SourceType',
    //   range: 'TargetType',
    // });

    // Example: Transform existing entities (only runs if not dry-run)
    // if (!context.dryRun && context.graphService) {
    //   const count = await context.graphService.updateEntitiesByType('OldType', {
    //     newProperty: 'defaultValue',
    //   });
    //   context.recordEntitiesAffected(count);
    // }

    // TODO: Implement migration logic
    throw new Error('Migration not implemented');
  },

  /**
   * Rollback the migration (reverse of up)
   * @param {MigrationContext} context - Migration context with helpers
   */
  async down(context) {
    // Reverse the changes made in up()
    // This is important for enabling safe rollbacks

    // TODO: Implement rollback logic
    throw new Error('Rollback not implemented');
  },

  /**
   * Optional: Validate migration can be applied
   * @param {MigrationContext} context - Migration context
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  async validate(context) {
    const errors = [];

    // Example: Check preconditions
    // if (!context.ontologyService.entityTypes.has('RequiredType')) {
    //   errors.push('Required entity type "RequiredType" not found');
    // }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};
`;
  }

  /**
   * Generate JSON migration template
   */
  _generateJsonMigrationTemplate(version, name, description, targetVersion) {
    const template = {
      version,
      name,
      description: description || '',
      targetOntologyVersion: targetVersion || null,
      changes: {
        addEntityTypes: [
          {
            name: 'ExampleType',
            label: 'Example Type',
            comment: 'Example entity type - remove this',
            parent: 'Entity',
          },
        ],
        removeEntityTypes: [],
        modifyEntityTypes: [],
        addRelationshipTypes: [],
        removeRelationshipTypes: [],
        modifyRelationshipTypes: [],
        transformEntities: [],
        transformRelationships: [],
      },
    };

    return JSON.stringify(template, null, 2);
  }

  /**
   * Compare semantic versions
   */
  _compareVersions(a, b) {
    const parseVersion = (v) => {
      const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!match) return [0, 0, 0];
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    };

    const [aMajor, aMinor, aPatch] = parseVersion(a);
    const [bMajor, bMinor, bPatch] = parseVersion(b);

    if (aMajor !== bMajor) return aMajor - bMajor;
    if (aMinor !== bMinor) return aMinor - bMinor;
    return aPatch - bPatch;
  }

  /**
   * Ensure service is initialized
   */
  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error('OntologyMigrationService not initialized. Call initialize() first.');
    }
  }

  /**
   * Reset service (for testing)
   */
  reset() {
    this._migrations.clear();
    this._appliedMigrations.clear();
    this._initialized = false;
  }
}

/**
 * Storage adapter interface for migration persistence
 * Implementations should provide Cosmos DB, file-based, or in-memory storage
 */
class MigrationStorageAdapter {
  async getMigrationHistory() {
    throw new Error('getMigrationHistory() not implemented');
  }

  async saveMigrationRecord(record) {
    throw new Error('saveMigrationRecord() not implemented');
  }
}

/**
 * In-memory storage adapter for testing
 */
class InMemoryMigrationStorage extends MigrationStorageAdapter {
  constructor() {
    super();
    this._records = [];
  }

  async getMigrationHistory() {
    return this._records;
  }

  async saveMigrationRecord(record) {
    // Update existing or add new
    const index = this._records.findIndex(r => r.version === record.version);
    if (index >= 0) {
      this._records[index] = { ...this._records[index], ...record };
    } else {
      this._records.push(record);
    }
  }

  clear() {
    this._records = [];
  }
}

// Singleton instance
let instance = null;

/**
 * Get the migration service instance
 * @returns {OntologyMigrationService}
 */
function getOntologyMigrationService() {
  if (!instance) {
    instance = new OntologyMigrationService();
  }
  return instance;
}

/**
 * Initialize and get the migration service
 * @returns {Promise<OntologyMigrationService>}
 */
async function initializeOntologyMigrationService(options = {}) {
  const service = getOntologyMigrationService();

  if (options.storage) {
    service.storage = options.storage;
  }
  if (options.graphService) {
    service.graphService = options.graphService;
  }
  if (options.ontologyService) {
    service.ontologyService = options.ontologyService;
  }

  await service.initialize();
  return service;
}

module.exports = {
  OntologyMigrationService,
  MigrationContext,
  MigrationStorageAdapter,
  InMemoryMigrationStorage,
  MIGRATION_STATUS,
  getOntologyMigrationService,
  initializeOntologyMigrationService,
};
