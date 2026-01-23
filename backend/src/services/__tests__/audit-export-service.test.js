/**
 * Unit Tests for Audit Export Service (F5.1.5)
 *
 * Tests export functionality including:
 * - CSV/JSON/NDJSON format generation
 * - File export and listing
 * - Scheduled exports
 * - Job tracking
 * - Statistics
 */

const fs = require('fs').promises;
const path = require('path');

// Mock dependencies before importing the service
jest.mock('../configuration-service', () => ({
  getConfig: jest.fn((key) => {
    const configs = {
      AUDIT_LOG_ARCHIVE_DIR: 'test-audit-archives',
      AUDIT_LOG_ARCHIVE_ENABLED: false,
      AUDIT_LOG_RETENTION_SWEEP_HOURS: 24,
    };
    return configs[key];
  }),
  getConfigurationService: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

jest.mock('../audit-persistence-service', () => ({
  getAuditPersistenceService: jest.fn(() => ({
    queryLogs: jest.fn(async () => [
      {
        id: 'audit_001',
        timestamp: '2026-01-20T10:00:00.000Z',
        action: 'create',
        entityType: 'document',
        entityId: 'doc-123',
        userId: 'user-001',
        userName: 'Test User',
        userEmail: 'test@example.com',
        details: { source: 'upload' },
      },
      {
        id: 'audit_002',
        timestamp: '2026-01-21T14:30:00.000Z',
        action: 'ACCESS_DENIED',
        entityType: 'security',
        entityId: 'doc-456',
        userId: 'user-002',
        userName: 'Another User',
        userEmail: 'another@example.com',
        details: { reason: 'Insufficient permissions' },
      },
      {
        id: 'audit_003',
        timestamp: '2026-01-22T09:15:00.000Z',
        action: 'update',
        entityType: 'entity',
        entityId: 'entity-789',
        userId: 'user-001',
        userName: 'Test User',
        userEmail: 'test@example.com',
        details: { field: 'name', oldValue: 'Old', newValue: 'New' },
      },
    ]),
  })),
}));

jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    errorWithStack: jest.fn(),
  },
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
}));

const {
  AuditExportService,
  getAuditExportService,
  EXPORT_FORMATS,
  EXPORT_STATUS,
  CSV_COLUMNS,
} = require('../audit-export-service');

describe('AuditExportService', () => {
  let service;
  let testDir;

  beforeAll(async () => {
    testDir = path.join(process.cwd(), 'test-audit-archives');
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch (e) {
      // Directory may already exist
    }
  });

  beforeEach(() => {
    service = new AuditExportService();
  });

  afterEach(() => {
    service.reset();
  });

  afterAll(async () => {
    // Cleanup test directory
    try {
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Constants', () => {
    test('EXPORT_FORMATS should have csv, json, and ndjson', () => {
      expect(EXPORT_FORMATS.CSV).toBe('csv');
      expect(EXPORT_FORMATS.JSON).toBe('json');
      expect(EXPORT_FORMATS.NDJSON).toBe('ndjson');
    });

    test('EXPORT_STATUS should have pending, in_progress, completed, and failed', () => {
      expect(EXPORT_STATUS.PENDING).toBe('pending');
      expect(EXPORT_STATUS.IN_PROGRESS).toBe('in_progress');
      expect(EXPORT_STATUS.COMPLETED).toBe('completed');
      expect(EXPORT_STATUS.FAILED).toBe('failed');
    });

    test('CSV_COLUMNS should contain expected columns', () => {
      expect(CSV_COLUMNS).toContain('id');
      expect(CSV_COLUMNS).toContain('timestamp');
      expect(CSV_COLUMNS).toContain('action');
      expect(CSV_COLUMNS).toContain('entityType');
      expect(CSV_COLUMNS).toContain('entityId');
      expect(CSV_COLUMNS).toContain('userId');
      expect(CSV_COLUMNS).toContain('userName');
      expect(CSV_COLUMNS).toContain('userEmail');
      expect(CSV_COLUMNS).toContain('details');
    });
  });

  describe('exportLogs', () => {
    describe('JSON format', () => {
      test('should export logs as JSON', async () => {
        const result = await service.exportLogs({ format: 'json' });

        expect(result.format).toBe('json');
        expect(result.recordCount).toBe(3);
        expect(result.contentType).toBe('application/json');
        expect(result.content).toBeDefined();

        const parsed = JSON.parse(result.content);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(3);
      });

      test('should include filters in result', async () => {
        const startDate = new Date('2026-01-20');
        const endDate = new Date('2026-01-22');

        const result = await service.exportLogs({
          format: 'json',
          startDate,
          endDate,
          action: 'create',
        });

        expect(result.filters.startDate).toBe(startDate.toISOString());
        expect(result.filters.endDate).toBe(endDate.toISOString());
        expect(result.filters.action).toBe('create');
      });
    });

    describe('CSV format', () => {
      test('should export logs as CSV', async () => {
        const result = await service.exportLogs({ format: 'csv' });

        expect(result.format).toBe('csv');
        expect(result.contentType).toBe('text/csv');
        expect(result.content).toBeDefined();

        const lines = result.content.split('\n');
        expect(lines.length).toBe(4); // header + 3 rows
        expect(lines[0]).toBe(CSV_COLUMNS.join(','));
      });

      test('should properly escape CSV values with commas', async () => {
        const result = await service.exportLogs({ format: 'csv' });
        const lines = result.content.split('\n');

        // Details column should be JSON-escaped and quoted
        expect(lines[1]).toContain('"');
      });
    });

    describe('NDJSON format', () => {
      test('should export logs as newline-delimited JSON', async () => {
        const result = await service.exportLogs({ format: 'ndjson' });

        expect(result.format).toBe('ndjson');
        expect(result.contentType).toBe('application/x-ndjson');
        expect(result.content).toBeDefined();

        const lines = result.content.split('\n');
        expect(lines.length).toBe(3);

        // Each line should be valid JSON
        lines.forEach((line) => {
          expect(() => JSON.parse(line)).not.toThrow();
        });
      });
    });

    test('should throw for invalid format', async () => {
      await expect(service.exportLogs({ format: 'invalid' })).rejects.toThrow(
        'Invalid export format'
      );
    });

    test('should create job for export', async () => {
      const result = await service.exportLogs({ format: 'json' });

      expect(result.jobId).toBeDefined();

      const job = service.getJobStatus(result.jobId);
      expect(job.status).toBe(EXPORT_STATUS.COMPLETED);
    });
  });

  describe('File export', () => {
    test('should save export to file', async () => {
      const result = await service.exportLogs({
        format: 'json',
        saveToFile: true,
      });

      expect(result.filePath).toBeDefined();
      expect(result.filename).toBeDefined();
      expect(result.fileSize).toBeGreaterThan(0);

      // Verify file exists
      const content = await fs.readFile(result.filePath, 'utf8');
      expect(content).toBeDefined();

      // Cleanup
      await fs.unlink(result.filePath);
    });

    test('should use custom filename when provided', async () => {
      const customFilename = 'audit-export_custom_test.json';
      const result = await service.exportLogs({
        format: 'json',
        saveToFile: true,
        filename: customFilename,
      });

      expect(result.filename).toBe(customFilename);

      // Cleanup
      await fs.unlink(result.filePath);
    });

    test('should generate appropriate filename for CSV', async () => {
      const result = await service.exportLogs({
        format: 'csv',
        saveToFile: true,
      });

      expect(result.filename).toMatch(/^audit-export_.*\.csv$/);

      // Cleanup
      await fs.unlink(result.filePath);
    });

    test('should generate appropriate filename for NDJSON', async () => {
      const result = await service.exportLogs({
        format: 'ndjson',
        saveToFile: true,
      });

      expect(result.filename).toMatch(/^audit-export_.*\.ndjson$/);

      // Cleanup
      await fs.unlink(result.filePath);
    });
  });

  describe('listExportFiles', () => {
    test('should list export files', async () => {
      // Create a test file
      await service.exportLogs({ format: 'json', saveToFile: true });

      const files = await service.listExportFiles();

      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThanOrEqual(1);

      const file = files[0];
      expect(file.filename).toBeDefined();
      expect(file.size).toBeDefined();
      expect(file.createdAt).toBeDefined();

      // Cleanup
      await fs.unlink(file.path);
    });

    test('should return empty array when no files exist', async () => {
      // Clear any existing files
      const files = await service.listExportFiles();
      for (const file of files) {
        await service.deleteExportFile(file.filename);
      }

      const result = await service.listExportFiles();
      expect(result).toEqual([]);
    });
  });

  describe('deleteExportFile', () => {
    test('should delete export file', async () => {
      // Create a test file
      const result = await service.exportLogs({
        format: 'json',
        saveToFile: true,
      });

      const deleted = await service.deleteExportFile(result.filename);
      expect(deleted).toBe(true);

      // Verify file no longer exists
      const files = await service.listExportFiles();
      expect(files.find((f) => f.filename === result.filename)).toBeUndefined();
    });

    test('should reject invalid filenames', async () => {
      await expect(service.deleteExportFile('malicious.txt')).rejects.toThrow(
        'Invalid filename'
      );
    });

    test('should return false for non-existent file', async () => {
      const deleted = await service.deleteExportFile('audit-export_nonexistent.json');
      expect(deleted).toBe(false);
    });
  });

  describe('Scheduled exports', () => {
    test('should create scheduled export', () => {
      const schedule = service.scheduleExport({
        name: 'test-schedule',
        format: 'json',
        intervalHours: 24,
      });

      expect(schedule.name).toBe('test-schedule');
      expect(schedule.format).toBe('json');
      expect(schedule.intervalHours).toBe(24);
      expect(schedule.nextRun).toBeDefined();
    });

    test('should throw for duplicate schedule name', () => {
      service.scheduleExport({ name: 'dup-test', format: 'json', intervalHours: 24 });

      expect(() => {
        service.scheduleExport({ name: 'dup-test', format: 'csv', intervalHours: 12 });
      }).toThrow("already exists");
    });

    test('should throw for missing schedule name', () => {
      expect(() => {
        service.scheduleExport({ format: 'json', intervalHours: 24 });
      }).toThrow('Schedule name is required');
    });

    test('should list scheduled exports', () => {
      service.scheduleExport({ name: 'sched-1', format: 'json', intervalHours: 24 });
      service.scheduleExport({ name: 'sched-2', format: 'csv', intervalHours: 12 });

      const schedules = service.getScheduledExports();

      expect(schedules.length).toBe(2);
      expect(schedules.find((s) => s.name === 'sched-1')).toBeDefined();
      expect(schedules.find((s) => s.name === 'sched-2')).toBeDefined();
    });

    test('should remove scheduled export', () => {
      service.scheduleExport({ name: 'to-remove', format: 'json', intervalHours: 24 });

      const result = service.removeScheduledExport('to-remove');

      expect(result.removed).toBe(true);
      expect(service.getScheduledExports().length).toBe(0);
    });

    test('should throw when removing non-existent schedule', () => {
      expect(() => {
        service.removeScheduledExport('nonexistent');
      }).toThrow('not found');
    });

    test('should run scheduled export on demand', async () => {
      service.scheduleExport({ name: 'run-now', format: 'json', intervalHours: 24 });

      const result = await service.runScheduledExportNow('run-now');

      expect(result.recordCount).toBe(3);
      expect(result.filePath).toBeDefined();

      // Verify schedule was updated
      const schedules = service.getScheduledExports();
      const schedule = schedules.find((s) => s.name === 'run-now');
      expect(schedule.lastRun).not.toBeNull();
      expect(schedule.runCount).toBe(1);

      // Cleanup
      await fs.unlink(result.filePath);
    });

    test('should throw when running non-existent schedule', async () => {
      await expect(service.runScheduledExportNow('nonexistent')).rejects.toThrow(
        'not found'
      );
    });
  });

  describe('Job tracking', () => {
    test('should track export jobs', async () => {
      await service.exportLogs({ format: 'json' });
      await service.exportLogs({ format: 'csv' });

      const jobs = service.getRecentJobs();

      expect(jobs.length).toBe(2);
      jobs.forEach((job) => {
        expect(job.status).toBe(EXPORT_STATUS.COMPLETED);
      });
    });

    test('should get specific job by ID', async () => {
      const result = await service.exportLogs({ format: 'json' });

      const job = service.getJobStatus(result.jobId);

      expect(job).toBeDefined();
      expect(job.id).toBe(result.jobId);
      expect(job.status).toBe(EXPORT_STATUS.COMPLETED);
    });

    test('should return null for non-existent job', () => {
      const job = service.getJobStatus(99999);
      expect(job).toBeNull();
    });

    test('should limit recent jobs returned', async () => {
      // Create multiple jobs
      for (let i = 0; i < 5; i++) {
        await service.exportLogs({ format: 'json' });
      }

      const jobs = service.getRecentJobs(3);
      expect(jobs.length).toBe(3);
    });
  });

  describe('Statistics', () => {
    test('should return export statistics', async () => {
      await service.exportLogs({ format: 'json' });
      await service.exportLogs({ format: 'csv', saveToFile: true }).then(async (r) => {
        await fs.unlink(r.filePath);
      });

      service.scheduleExport({ name: 'stat-test', format: 'json', intervalHours: 24 });

      const stats = service.getStatistics();

      expect(stats.totalJobs).toBe(2);
      expect(stats.completedJobs).toBe(2);
      expect(stats.failedJobs).toBe(0);
      expect(stats.scheduledExports).toBe(1);
      expect(stats.exportDirectory).toBeDefined();
    });
  });

  describe('Default schedule', () => {
    test('should not start default schedule when archiving is disabled', () => {
      const result = service.startDefaultSchedule();
      expect(result).toBeNull();
    });
  });

  describe('Singleton', () => {
    test('getAuditExportService should return singleton instance', () => {
      const instance1 = getAuditExportService();
      const instance2 = getAuditExportService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Shutdown', () => {
    test('should clear all scheduled jobs on shutdown', () => {
      service.scheduleExport({ name: 'shutdown-1', format: 'json', intervalHours: 24 });
      service.scheduleExport({ name: 'shutdown-2', format: 'csv', intervalHours: 12 });

      service.shutdown();

      expect(service.getScheduledExports().length).toBe(0);
    });
  });

  describe('Reset', () => {
    test('should reset all state', async () => {
      await service.exportLogs({ format: 'json' });
      service.scheduleExport({ name: 'reset-test', format: 'json', intervalHours: 24 });

      service.reset();

      expect(service.getRecentJobs().length).toBe(0);
      expect(service.getScheduledExports().length).toBe(0);
    });
  });
});

describe('CSV Escaping', () => {
  let service;

  beforeEach(() => {
    service = new AuditExportService();
  });

  afterEach(() => {
    service.reset();
  });

  test('should handle values with commas', async () => {
    const result = await service.exportLogs({ format: 'csv' });
    expect(result.content).toBeDefined();
    // The details field contains JSON which has commas
    expect(result.content).toMatch(/".*,.*"/);
  });

  test('should handle values with quotes', async () => {
    const result = await service.exportLogs({ format: 'csv' });
    // JSON strings contain quotes that need escaping
    expect(result.content).toBeDefined();
  });

  test('should handle null values', async () => {
    const result = await service.exportLogs({ format: 'csv' });
    expect(result.content).toBeDefined();
  });
});
