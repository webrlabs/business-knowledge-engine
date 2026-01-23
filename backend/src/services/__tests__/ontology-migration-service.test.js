/**
 * Unit tests for Ontology Migration Service
 *
 * @see Feature F2.2.2 - Migration Framework
 */

const path = require('path');
const fs = require('fs');
const {
  OntologyMigrationService,
  MigrationContext,
  InMemoryMigrationStorage,
  MIGRATION_STATUS,
} = require('../ontology-migration-service');

// Mock the logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock telemetry
jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
}));

// Mock ontology service
jest.mock('../ontology-service', () => ({
  getOntologyService: jest.fn(() => ({
    initialized: true,
    validateEntityType: jest.fn((type) => ({
      valid: ['Entity', 'BusinessFlowEntity', 'Process', 'Task'].includes(type),
      message: type === 'Project' ? 'Entity type "Project" is not defined in the ontology' : null,
    })),
    getNextVersion: jest.fn(() => '1.1.0'),
  })),
}));

describe('OntologyMigrationService', () => {
  let service;
  let testMigrationsDir;
  let storage;

  // Helper to clear require cache for migration files
  const clearRequireCache = () => {
    Object.keys(require.cache).forEach((key) => {
      if (key.includes('__test_migrations__')) {
        delete require.cache[key];
      }
    });
  };

  beforeEach(() => {
    // Clear require cache before each test
    clearRequireCache();

    // Create a temporary migrations directory for testing
    testMigrationsDir = path.join(__dirname, '__test_migrations__');
    if (!fs.existsSync(testMigrationsDir)) {
      fs.mkdirSync(testMigrationsDir, { recursive: true });
    }

    storage = new InMemoryMigrationStorage();

    service = new OntologyMigrationService({
      migrationsDir: testMigrationsDir,
      storage,
    });
  });

  afterEach(() => {
    // Clean up test migrations directory
    if (fs.existsSync(testMigrationsDir)) {
      const files = fs.readdirSync(testMigrationsDir);
      for (const file of files) {
        const filePath = path.join(testMigrationsDir, file);
        // Clear require cache for this specific file
        delete require.cache[require.resolve(filePath)];
        fs.unlinkSync(filePath);
      }
      fs.rmdirSync(testMigrationsDir);
    }

    // Clear all migration-related cache
    clearRequireCache();
    service.reset();
  });

  describe('initialization', () => {
    test('should initialize with empty migrations directory', async () => {
      await service.initialize();

      expect(service._initialized).toBe(true);
      expect(service._migrations.size).toBe(0);
    });

    test('should load JavaScript migration files', async () => {
      // Create a test migration file
      const migrationContent = `
module.exports = {
  version: '1.0.1',
  name: 'test-migration',
  description: 'Test migration',
  async up(context) {
    context.addEntityType('TestType', { label: 'Test' });
  },
  async down(context) {
    context.removeEntityType('TestType');
  },
};
`;
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-test-migration.js'),
        migrationContent
      );

      await service.initialize();

      expect(service._migrations.size).toBe(1);
      expect(service._migrations.has('1.0.1')).toBe(true);
    });

    test('should load JSON migration files', async () => {
      const migrationJson = {
        version: '1.0.2',
        name: 'json-test-migration',
        description: 'Test JSON migration',
        changes: {
          addEntityTypes: [{ name: 'JsonTestType', label: 'JSON Test' }],
        },
      };
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.2-json-test.json'),
        JSON.stringify(migrationJson, null, 2)
      );

      await service.initialize();

      expect(service._migrations.size).toBe(1);
      expect(service._migrations.has('1.0.2')).toBe(true);
    });

    test('should skip invalid migration files', async () => {
      // Create an invalid migration (missing required fields)
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.3-invalid.js'),
        'module.exports = { name: "no-version" };'
      );

      await service.initialize();

      expect(service._migrations.size).toBe(0);
    });
  });

  describe('getAllMigrations', () => {
    test('should return migrations sorted by version', async () => {
      // Create migrations out of order
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.3-third.js'),
        'module.exports = { version: "1.0.3", name: "third", async up(ctx) {} };'
      );
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-first.js'),
        'module.exports = { version: "1.0.1", name: "first", async up(ctx) {} };'
      );
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.2-second.js'),
        'module.exports = { version: "1.0.2", name: "second", async up(ctx) {} };'
      );

      await service.initialize();
      const migrations = service.getAllMigrations();

      expect(migrations.length).toBe(3);
      expect(migrations[0].version).toBe('1.0.1');
      expect(migrations[1].version).toBe('1.0.2');
      expect(migrations[2].version).toBe('1.0.3');
    });

    test('should indicate pending status for unapplied migrations', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-test.js'),
        'module.exports = { version: "1.0.1", name: "test", async up(ctx) {} };'
      );

      await service.initialize();
      const migrations = service.getAllMigrations();

      expect(migrations[0].status).toBe(MIGRATION_STATUS.PENDING);
      expect(migrations[0].appliedAt).toBeNull();
    });
  });

  describe('runMigration', () => {
    test('should run a migration successfully', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-test.js'),
        'module.exports = { version: "1.0.1", name: "test", up: async function(ctx) { ctx.addEntityType("NewType", { label: "New" }); } };'
      );

      await service.initialize();
      const result = await service.runMigration('1.0.1');

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.changes).toBeDefined();
      expect(service._appliedMigrations.has('1.0.1')).toBe(true);
    });

    test('should support dry-run mode', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-test.js'),
        'module.exports = { version: "1.0.1", name: "test", up: async function(ctx) { ctx.addEntityType("NewType", { label: "New" }); } };'
      );

      await service.initialize();
      const result = await service.runMigration('1.0.1', { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.changes).toBeDefined();
      // Should NOT be marked as applied
      expect(service._appliedMigrations.has('1.0.1')).toBe(false);
    });

    test('should throw error for already applied migration', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-test.js'),
        'module.exports = { version: "1.0.1", name: "test", up: async function(ctx) {} };'
      );

      await service.initialize();
      await service.runMigration('1.0.1');

      await expect(service.runMigration('1.0.1')).rejects.toThrow(
        'already been applied'
      );
    });

    test('should throw error for unknown migration', async () => {
      await service.initialize();

      await expect(service.runMigration('9.9.9')).rejects.toThrow('not found');
    });

    test('should execute validation function when provided', async () => {
      // Use unique filename to avoid require cache issues
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.5-validation-test.js'),
        'module.exports = { version: "1.0.5", name: "validation-test", up: async function(ctx) {}, validate: async function(ctx) { return { valid: false, errors: ["Precondition failed"] }; } };'
      );

      await service.initialize();
      const result = await service.runMigration('1.0.5');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });
  });

  describe('runAllPending', () => {
    test('should run all pending migrations in order', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-first.js'),
        'module.exports = { version: "1.0.1", name: "first", up: async function(ctx) { ctx.addEntityType("First", {}); } };'
      );
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.2-second.js'),
        'module.exports = { version: "1.0.2", name: "second", up: async function(ctx) { ctx.addEntityType("Second", {}); } };'
      );

      await service.initialize();
      const result = await service.runAllPending();

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(2);
      expect(result.results.length).toBe(2);
      expect(service._appliedMigrations.size).toBe(2);
    });

    test('should stop on error when stopOnError is true', async () => {
      // Use unique filenames to avoid require cache issues
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.6-error-first.js'),
        'module.exports = { version: "1.0.6", name: "error-first", up: async function(ctx) { throw new Error("Intentional error"); } };'
      );
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.7-error-second.js'),
        'module.exports = { version: "1.0.7", name: "error-second", up: async function(ctx) {} };'
      );

      await service.initialize();
      const result = await service.runAllPending({ stopOnError: true });

      expect(result.success).toBe(false);
      expect(result.results[0].success).toBe(false);
      expect(result.results[1].skipped).toBe(true);
    });

    test('should return early when no pending migrations', async () => {
      await service.initialize();
      const result = await service.runAllPending();

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(0);
    });
  });

  describe('rollbackMigration', () => {
    test('should rollback an applied migration', async () => {
      // Use unique filename to avoid require cache issues
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.8-rollback-test.js'),
        'module.exports = { version: "1.0.8", name: "rollback-test", up: async function(ctx) { ctx.addEntityType("Test", {}); }, down: async function(ctx) { ctx.removeEntityType("Test"); } };'
      );

      await service.initialize();
      await service.runMigration('1.0.8');
      expect(service._appliedMigrations.has('1.0.8')).toBe(true);

      const result = await service.rollbackMigration('1.0.8');

      expect(result.success).toBe(true);
      expect(result.changes).toBeDefined();
      expect(service._appliedMigrations.has('1.0.8')).toBe(false);
    });

    test('should throw error for unapplied migration', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-test.js'),
        'module.exports = { version: "1.0.1", name: "test", up: async function(ctx) {}, down: async function(ctx) {} };'
      );

      await service.initialize();

      await expect(service.rollbackMigration('1.0.1')).rejects.toThrow(
        'has not been applied'
      );
    });

    test('should throw error when migration has no down function', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-test.js'),
        'module.exports = { version: "1.0.1", name: "test", up: async function(ctx) {} };'
      );

      await service.initialize();
      await service.runMigration('1.0.1');

      await expect(service.rollbackMigration('1.0.1')).rejects.toThrow(
        'does not support rollback'
      );
    });
  });

  describe('createMigration', () => {
    test('should create a JavaScript migration file', () => {
      service._initialized = true;
      service.migrationsDir = testMigrationsDir;
      service.ontologyService = {
        initialized: true,
        getNextVersion: () => '1.1.0',
      };

      const result = service.createMigration({
        name: 'Add User Type',
        description: 'Adds a User entity type',
        format: 'js',
      });

      expect(result.version).toBe('1.1.0');
      expect(result.filename).toBe('1.1.0-add-user-type.js');
      expect(fs.existsSync(result.filepath)).toBe(true);

      const content = fs.readFileSync(result.filepath, 'utf8');
      expect(content).toContain('version: \'1.1.0\'');
      expect(content).toContain('Add User Type');
    });

    test('should create a JSON migration file', () => {
      service._initialized = true;
      service.migrationsDir = testMigrationsDir;
      service.ontologyService = {
        initialized: true,
        getNextVersion: () => '1.2.0',
      };

      const result = service.createMigration({
        name: 'JSON Migration',
        description: 'Test JSON migration',
        format: 'json',
      });

      expect(result.format).toBe('json');
      expect(result.filename).toBe('1.2.0-json-migration.json');

      const content = JSON.parse(fs.readFileSync(result.filepath, 'utf8'));
      expect(content.version).toBe('1.2.0');
      expect(content.changes).toBeDefined();
    });

    test('should throw error if file already exists', () => {
      service._initialized = true;
      service.migrationsDir = testMigrationsDir;
      service.ontologyService = {
        initialized: true,
        getNextVersion: () => '1.1.0',
      };

      // Create first
      service.createMigration({ name: 'Test' });

      // Try to create again with same version
      expect(() => service.createMigration({ name: 'Test' })).toThrow(
        'already exists'
      );
    });
  });

  describe('getStatus', () => {
    test('should return correct status summary', async () => {
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.1-first.js'),
        'module.exports = { version: "1.0.1", name: "first", async up(ctx) {} };'
      );
      fs.writeFileSync(
        path.join(testMigrationsDir, '1.0.2-second.js'),
        'module.exports = { version: "1.0.2", name: "second", async up(ctx) {} };'
      );

      await service.initialize();
      await service.runMigration('1.0.1');

      const status = service.getStatus();

      expect(status.totalMigrations).toBe(2);
      expect(status.appliedCount).toBe(1);
      expect(status.pendingCount).toBe(1);
      expect(status.hasPending).toBe(true);
      expect(status.lastApplied.version).toBe('1.0.1');
      expect(status.nextPending.version).toBe('1.0.2');
    });
  });
});

describe('MigrationContext', () => {
  let context;

  beforeEach(() => {
    context = new MigrationContext({
      dryRun: false,
      logger: { debug: jest.fn(), warn: jest.fn() },
    });
  });

  describe('change tracking', () => {
    test('should track added entity types', () => {
      context.addEntityType('NewType', { label: 'New' });
      context.addEntityType('AnotherType', { label: 'Another' });

      const summary = context.getChangesSummary();

      expect(summary.addedEntityTypes.length).toBe(2);
      expect(summary.totalTypeChanges).toBe(2);
    });

    test('should track removed entity types', () => {
      context.removeEntityType('OldType');

      const summary = context.getChangesSummary();

      expect(summary.removedEntityTypes.length).toBe(1);
    });

    test('should track relationship types', () => {
      context.addRelationshipType('NEW_REL', { domain: 'A', range: 'B' });
      context.removeRelationshipType('OLD_REL');

      const summary = context.getChangesSummary();

      expect(summary.addedRelationshipTypes.length).toBe(1);
      expect(summary.removedRelationshipTypes.length).toBe(1);
    });

    test('should track affected entities/relationships counts', () => {
      context.recordEntitiesAffected(50);
      context.recordEntitiesAffected(25);
      context.recordRelationshipsAffected(100);

      const summary = context.getChangesSummary();

      expect(summary.entitiesAffected).toBe(75);
      expect(summary.relationshipsAffected).toBe(100);
    });

    test('should track warnings', () => {
      context.addWarning('Warning 1');
      context.addWarning('Warning 2');

      const summary = context.getChangesSummary();

      expect(summary.warnings.length).toBe(2);
    });
  });
});

describe('InMemoryMigrationStorage', () => {
  let storage;

  beforeEach(() => {
    storage = new InMemoryMigrationStorage();
  });

  test('should save and retrieve migration records', async () => {
    await storage.saveMigrationRecord({
      version: '1.0.1',
      name: 'test',
      status: MIGRATION_STATUS.APPLIED,
      appliedAt: '2026-01-23T10:00:00Z',
    });

    const history = await storage.getMigrationHistory();

    expect(history.length).toBe(1);
    expect(history[0].version).toBe('1.0.1');
    expect(history[0].status).toBe(MIGRATION_STATUS.APPLIED);
  });

  test('should update existing records', async () => {
    await storage.saveMigrationRecord({
      version: '1.0.1',
      status: MIGRATION_STATUS.APPLIED,
    });

    await storage.saveMigrationRecord({
      version: '1.0.1',
      status: MIGRATION_STATUS.ROLLED_BACK,
    });

    const history = await storage.getMigrationHistory();

    expect(history.length).toBe(1);
    expect(history[0].status).toBe(MIGRATION_STATUS.ROLLED_BACK);
  });

  test('should clear all records', async () => {
    await storage.saveMigrationRecord({ version: '1.0.1', status: 'applied' });
    await storage.saveMigrationRecord({ version: '1.0.2', status: 'applied' });

    storage.clear();
    const history = await storage.getMigrationHistory();

    expect(history.length).toBe(0);
  });
});

describe('Migration validation', () => {
  let service;
  let testMigrationsDir;

  beforeEach(() => {
    testMigrationsDir = path.join(__dirname, '__test_migrations_validation__');
    if (!fs.existsSync(testMigrationsDir)) {
      fs.mkdirSync(testMigrationsDir, { recursive: true });
    }

    service = new OntologyMigrationService({
      migrationsDir: testMigrationsDir,
      storage: new InMemoryMigrationStorage(),
    });
  });

  afterEach(() => {
    if (fs.existsSync(testMigrationsDir)) {
      const files = fs.readdirSync(testMigrationsDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testMigrationsDir, file));
      }
      fs.rmdirSync(testMigrationsDir);
    }
  });

  test('should reject migration without version', async () => {
    fs.writeFileSync(
      path.join(testMigrationsDir, 'invalid.js'),
      'module.exports = { name: "no-version", async up(ctx) {} };'
    );

    await service.initialize();

    expect(service._migrations.size).toBe(0);
  });

  test('should reject migration without up function', async () => {
    fs.writeFileSync(
      path.join(testMigrationsDir, '1.0.1-no-up.js'),
      'module.exports = { version: "1.0.1", name: "no-up" };'
    );

    await service.initialize();

    expect(service._migrations.size).toBe(0);
  });

  test('should accept migration without down function (but log warning)', async () => {
    fs.writeFileSync(
      path.join(testMigrationsDir, '1.0.1-no-down.js'),
      'module.exports = { version: "1.0.1", name: "no-down", async up(ctx) {} };'
    );

    await service.initialize();

    expect(service._migrations.size).toBe(1);
  });
});
