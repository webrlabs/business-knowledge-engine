const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  AuditPersistenceService,
  __setAuditContainerForTesting,
  __resetAuditContainerForTesting,
} = require('../audit-persistence-service');

function createQueryIterator(pages) {
  let index = 0;
  return {
    hasMoreResults: () => index < pages.length,
    fetchNext: async () => ({ resources: pages[index++] || [] }),
  };
}

function createMockContainer(pages, deleteMock) {
  return {
    items: {
      query: jest.fn().mockReturnValue(createQueryIterator(pages)),
    },
    item: jest.fn((id, entityType) => ({
      delete: () => deleteMock(id, entityType),
    })),
  };
}

describe('Audit retention sweep', () => {
  let service;

  beforeEach(() => {
    service = new AuditPersistenceService();
    service.initialized = true;
  });

  afterEach(() => {
    __resetAuditContainerForTesting();
  });

  it('archives and deletes expired logs', async () => {
    const deleteMock = jest.fn().mockResolvedValue({});
    const items = [
      { id: 'audit_1', entityType: 'document', timestamp: '2020-01-01T00:00:00Z' },
      { id: 'audit_2', entityType: 'security', timestamp: '2020-01-02T00:00:00Z' },
    ];
    const mockContainer = createMockContainer([items], deleteMock);
    __setAuditContainerForTesting(mockContainer);

    const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-archives-'));

    const result = await service.runRetentionSweep({
      retentionSeconds: 60,
      archiveEnabled: true,
      archiveDir,
      batchSize: 2,
      ensurePolicy: false,
    });

    expect(result.archived).toBe(2);
    expect(result.deleted).toBe(2);
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(result.archivePath).toBeTruthy();

    const archivedContent = fs.readFileSync(result.archivePath, 'utf8').trim().split('\n');
    expect(archivedContent).toHaveLength(2);
  });

  it('supports dry-run without deletes or archives', async () => {
    const deleteMock = jest.fn().mockResolvedValue({});
    const items = [
      { id: 'audit_3', entityType: 'document', timestamp: '2020-01-01T00:00:00Z' },
    ];
    const mockContainer = createMockContainer([items], deleteMock);
    __setAuditContainerForTesting(mockContainer);

    const result = await service.runRetentionSweep({
      retentionSeconds: 60,
      archiveEnabled: true,
      archiveDir: 'audit-archives',
      dryRun: true,
      batchSize: 1,
      ensurePolicy: false,
    });

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.archived).toBe(0);
    expect(result.archivePath).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
