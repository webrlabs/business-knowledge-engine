/**
 * Unit Tests for ADLS Gen2 ACL Sync (F4.2.4)
 *
 * Tests for ACL retrieval, parsing, and mapping to allowedGroups
 * for security trimming integration.
 */

const {
  ADLSGen2Connector,
  AclPermission,
  AclEntryType,
  createADLSGen2Connector,
} = require('../adls-gen2-connector');

// Mock dependencies
jest.mock('@azure/storage-file-datalake', () => {
  const mockFileClient = {
    getProperties: jest.fn(),
    read: jest.fn(),
    getAccessControl: jest.fn(),
  };

  const mockDirectoryClient = {
    getAccessControl: jest.fn(),
  };

  // Create a proper async iterator for listPaths
  const createAsyncIterator = (items = []) => {
    let index = 0;
    return {
      next: jest.fn().mockImplementation(async () => {
        if (index < items.length) {
          return { value: items[index++], done: false };
        }
        return { value: undefined, done: true };
      }),
      [Symbol.asyncIterator]() {
        return this;
      },
      continuationToken: undefined,
    };
  };

  const mockFileSystemClient = {
    exists: jest.fn().mockResolvedValue(true),
    listPaths: jest.fn(() => createAsyncIterator([{ name: 'test.txt', contentLength: 100 }])),
    getFileClient: jest.fn(() => mockFileClient),
    getDirectoryClient: jest.fn(() => mockDirectoryClient),
    getProperties: jest.fn(),
    _createAsyncIterator: createAsyncIterator,
  };

  const mockServiceClient = {
    getFileSystemClient: jest.fn(() => mockFileSystemClient),
  };

  return {
    DataLakeServiceClient: jest.fn(() => mockServiceClient),
    StorageSharedKeyCredential: jest.fn(),
    __mocks__: {
      mockFileClient,
      mockDirectoryClient,
      mockFileSystemClient,
      mockServiceClient,
      createAsyncIterator,
    },
  };
});

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
  trackMetric: jest.fn(),
}));

const {
  DataLakeServiceClient,
  __mocks__: { mockFileClient, mockDirectoryClient, mockFileSystemClient, createAsyncIterator },
} = require('@azure/storage-file-datalake');

describe('ADLS Gen2 ACL Sync (F4.2.4)', () => {
  let connector;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset the listPaths mock to return a proper async iterator
    mockFileSystemClient.listPaths.mockReturnValue(
      createAsyncIterator([{ name: 'test.txt', contentLength: 100, isDirectory: false }])
    );

    connector = createADLSGen2Connector('test-adls', {
      accountName: 'testaccount',
      fileSystemName: 'testfs',
      syncAcls: true,
    });

    await connector.initialize();
  });

  describe('AclPermission Constants', () => {
    it('should define read permission', () => {
      expect(AclPermission.READ).toBe('r');
    });

    it('should define write permission', () => {
      expect(AclPermission.WRITE).toBe('w');
    });

    it('should define execute permission', () => {
      expect(AclPermission.EXECUTE).toBe('x');
    });
  });

  describe('AclEntryType Constants', () => {
    it('should define user entry type', () => {
      expect(AclEntryType.USER).toBe('user');
    });

    it('should define group entry type', () => {
      expect(AclEntryType.GROUP).toBe('group');
    });

    it('should define mask entry type', () => {
      expect(AclEntryType.MASK).toBe('mask');
    });

    it('should define other entry type', () => {
      expect(AclEntryType.OTHER).toBe('other');
    });
  });

  describe('_parseAclEntry', () => {
    it('should parse basic user ACL entry', () => {
      const entry = connector._parseAclEntry('user::rwx');

      expect(entry).toEqual({
        type: 'user',
        objectId: null,
        permissions: 'rwx',
        isDefault: false,
        hasRead: true,
        hasWrite: true,
        hasExecute: true,
        raw: 'user::rwx',
      });
    });

    it('should parse named user ACL entry with object ID', () => {
      const objectId = '00000000-0000-0000-0000-000000000001';
      const entry = connector._parseAclEntry(`user:${objectId}:r-x`);

      expect(entry).toEqual({
        type: 'user',
        objectId,
        permissions: 'r-x',
        isDefault: false,
        hasRead: true,
        hasWrite: false,
        hasExecute: true,
        raw: `user:${objectId}:r-x`,
      });
    });

    it('should parse group ACL entry', () => {
      const entry = connector._parseAclEntry('group::r-x');

      expect(entry).toEqual({
        type: 'group',
        objectId: null,
        permissions: 'r-x',
        isDefault: false,
        hasRead: true,
        hasWrite: false,
        hasExecute: true,
        raw: 'group::r-x',
      });
    });

    it('should parse named group ACL entry with object ID', () => {
      const groupId = '00000000-0000-0000-0000-000000000002';
      const entry = connector._parseAclEntry(`group:${groupId}:rwx`);

      expect(entry).toEqual({
        type: 'group',
        objectId: groupId,
        permissions: 'rwx',
        isDefault: false,
        hasRead: true,
        hasWrite: true,
        hasExecute: true,
        raw: `group:${groupId}:rwx`,
      });
    });

    it('should parse mask ACL entry', () => {
      const entry = connector._parseAclEntry('mask::rwx');

      expect(entry).toEqual({
        type: 'mask',
        objectId: null,
        permissions: 'rwx',
        isDefault: false,
        hasRead: true,
        hasWrite: true,
        hasExecute: true,
        raw: 'mask::rwx',
      });
    });

    it('should parse other ACL entry', () => {
      const entry = connector._parseAclEntry('other::---');

      expect(entry).toEqual({
        type: 'other',
        objectId: null,
        permissions: '---',
        isDefault: false,
        hasRead: false,
        hasWrite: false,
        hasExecute: false,
        raw: 'other::---',
      });
    });

    it('should parse default ACL entry', () => {
      const entry = connector._parseAclEntry('default:user::rwx');

      expect(entry).toEqual({
        type: 'user',
        objectId: null,
        permissions: 'rwx',
        isDefault: true,
        hasRead: true,
        hasWrite: true,
        hasExecute: true,
        raw: 'default:user::rwx',
      });
    });

    it('should return null for invalid entry format', () => {
      expect(connector._parseAclEntry('')).toBeNull();
      expect(connector._parseAclEntry(null)).toBeNull();
      expect(connector._parseAclEntry('invalid')).toBeNull();
      expect(connector._parseAclEntry('user:only')).toBeNull();
    });

    it('should return null for unknown entry type', () => {
      const entry = connector._parseAclEntry('unknown::rwx');
      expect(entry).toBeNull();
    });
  });

  describe('_parseAclString', () => {
    it('should parse full POSIX ACL string', () => {
      const aclString = 'user::rwx,group::r-x,mask::rwx,other::---';
      const entries = connector._parseAclString(aclString);

      expect(entries).toHaveLength(4);
      expect(entries[0].type).toBe('user');
      expect(entries[1].type).toBe('group');
      expect(entries[2].type).toBe('mask');
      expect(entries[3].type).toBe('other');
    });

    it('should parse ACL string with named users and groups', () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const groupId = '22222222-2222-2222-2222-222222222222';
      const aclString = `user::rwx,user:${userId}:r-x,group::r-x,group:${groupId}:rw-,mask::rwx,other::---`;

      const entries = connector._parseAclString(aclString);

      expect(entries).toHaveLength(6);

      const namedUser = entries.find((e) => e.objectId === userId);
      expect(namedUser).toBeDefined();
      expect(namedUser.type).toBe('user');
      expect(namedUser.hasRead).toBe(true);

      const namedGroup = entries.find((e) => e.objectId === groupId);
      expect(namedGroup).toBeDefined();
      expect(namedGroup.type).toBe('group');
      expect(namedGroup.hasWrite).toBe(true);
    });

    it('should return empty array for null or empty ACL string', () => {
      expect(connector._parseAclString(null)).toEqual([]);
      expect(connector._parseAclString('')).toEqual([]);
    });

    it('should handle whitespace in ACL string', () => {
      const aclString = 'user::rwx, group::r-x, other::---';
      const entries = connector._parseAclString(aclString);

      expect(entries).toHaveLength(3);
    });
  });

  describe('_aclToAllowedGroups', () => {
    it('should include owner in allowedGroups when owner ACL entry has read permission', () => {
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'user', objectId: null, permissions: 'rwx', hasRead: true }, // owner entry
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).toContain('user:owner-object-id');
    });

    it('should include owning group in allowedGroups when group ACL entry has read permission', () => {
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'group', objectId: null, permissions: 'r-x', hasRead: true }, // owning group entry
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).toContain('group:group-object-id');
    });

    it('should include named users with read permission', () => {
      const userId = '33333333-3333-3333-3333-333333333333';
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'user', objectId: userId, permissions: 'r-x', hasRead: true },
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).toContain(`user:${userId}`);
    });

    it('should include named groups with read permission', () => {
      const groupId = '44444444-4444-4444-4444-444444444444';
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'group', objectId: groupId, permissions: 'rwx', hasRead: true },
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).toContain(`group:${groupId}`);
    });

    it('should add "public" for other entries with read permission', () => {
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'other', objectId: null, permissions: 'r--', hasRead: true },
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).toContain('public');
    });

    it('should not include entries without read permission when aclReadPermissionRequired is true', () => {
      const userId = '55555555-5555-5555-5555-555555555555';
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'user', objectId: userId, permissions: '-wx', hasRead: false },
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).not.toContain(`user:${userId}`);
    });

    it('should skip mask entries', () => {
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'user', objectId: null, permissions: 'rwx', hasRead: true }, // owner
          { type: 'group', objectId: null, permissions: 'r-x', hasRead: true }, // group
          { type: 'mask', objectId: null, permissions: 'rwx', hasRead: true }, // mask - should be skipped
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      // Should only have owner and group, not mask
      expect(allowedGroups).toHaveLength(2);
      expect(allowedGroups).toContain('user:owner-object-id');
      expect(allowedGroups).toContain('group:group-object-id');
      expect(allowedGroups).not.toContain('mask');
    });

    it('should return empty array for null accessControl', () => {
      expect(connector._aclToAllowedGroups(null)).toEqual([]);
    });

    it('should return empty array when acl is missing', () => {
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
      };

      expect(connector._aclToAllowedGroups(accessControl)).toEqual([]);
    });

    it('should deduplicate entries', () => {
      const userId = 'user-123';
      const accessControl = {
        owner: 'owner-object-id',
        group: 'group-object-id',
        acl: [
          { type: 'user', objectId: null, permissions: 'rwx', hasRead: true }, // Owner
          { type: 'group', objectId: null, permissions: 'r-x', hasRead: true }, // Owning group
          { type: 'user', objectId: userId, permissions: 'r--', hasRead: true }, // Named user
          { type: 'user', objectId: userId, permissions: 'r--', hasRead: true }, // Same named user (duplicate)
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      // Should have exactly 3 unique entries (owner, group, and one named user)
      expect(allowedGroups).toHaveLength(3);
      expect(allowedGroups).toContain('user:owner-object-id');
      expect(allowedGroups).toContain('group:group-object-id');
      expect(allowedGroups).toContain(`user:${userId}`);
    });
  });

  describe('getFileAccessControl', () => {
    it('should retrieve ACL for a file', async () => {
      mockFileClient.getAccessControl.mockResolvedValue({
        owner: 'owner-id',
        group: 'group-id',
        permissions: 'rwxr-x---',
        acl: 'user::rwx,group::r-x,other::---',
      });

      const result = await connector.getFileAccessControl('test/file.txt');

      expect(result).toBeDefined();
      expect(result.owner).toBe('owner-id');
      expect(result.group).toBe('group-id');
      expect(result.permissions).toBe('rwxr-x---');
      expect(result.acl).toHaveLength(3);
      expect(result.rawAcl).toBe('user::rwx,group::r-x,other::---');
    });

    it('should throw NOT_FOUND error for missing file', async () => {
      const error = new Error('File not found');
      error.statusCode = 404;
      mockFileClient.getAccessControl.mockRejectedValue(error);

      await expect(connector.getFileAccessControl('missing.txt')).rejects.toThrow('File not found');
    });

    it('should return null for 403 permission denied', async () => {
      const error = new Error('Access denied');
      error.statusCode = 403;
      mockFileClient.getAccessControl.mockRejectedValue(error);

      const result = await connector.getFileAccessControl('protected.txt');

      expect(result).toBeNull();
    });
  });

  describe('getDirectoryAccessControl', () => {
    it('should retrieve ACL for a directory', async () => {
      mockDirectoryClient.getAccessControl.mockResolvedValue({
        owner: 'dir-owner-id',
        group: 'dir-group-id',
        permissions: 'rwxr-xr-x',
        acl: 'user::rwx,group::r-x,other::r-x',
      });

      const result = await connector.getDirectoryAccessControl('test/dir');

      expect(result).toBeDefined();
      expect(result.owner).toBe('dir-owner-id');
      expect(result.group).toBe('dir-group-id');
    });

    it('should throw NOT_FOUND error for missing directory', async () => {
      const error = new Error('Directory not found');
      error.statusCode = 404;
      mockDirectoryClient.getAccessControl.mockRejectedValue(error);

      await expect(connector.getDirectoryAccessControl('missing-dir')).rejects.toThrow('Directory not found');
    });

    it('should return null for 403 permission denied', async () => {
      const error = new Error('Access denied');
      error.statusCode = 403;
      mockDirectoryClient.getAccessControl.mockRejectedValue(error);

      const result = await connector.getDirectoryAccessControl('protected-dir');

      expect(result).toBeNull();
    });
  });

  describe('getDocumentWithAcls', () => {
    beforeEach(() => {
      mockFileClient.getProperties.mockResolvedValue({
        contentType: 'text/plain',
        contentLength: 100,
        createdOn: new Date('2024-01-01'),
        lastModified: new Date('2024-01-15'),
        etag: 'etag-123',
      });

      mockFileClient.read.mockResolvedValue({
        readableStreamBody: (async function* () {
          yield Buffer.from('test content');
        })(),
      });

      mockFileClient.getAccessControl.mockResolvedValue({
        owner: 'owner-id',
        group: 'group-id',
        permissions: 'rwxr-x---',
        acl: 'user::rwx,group::r-x,other::---',
      });
    });

    it('should include ACLs in document metadata when syncAcls is true', async () => {
      const result = await connector.getDocumentWithAcls('doc.txt');

      expect(result.metadata.accessControl).toBeDefined();
      expect(result.metadata.allowedGroups).toBeDefined();
      expect(result.metadata.aclsSynced).toBe(true);
    });

    it('should include allowedGroups derived from ACLs', async () => {
      const result = await connector.getDocumentWithAcls('doc.txt');

      expect(result.metadata.allowedGroups).toContain('user:owner-id');
      expect(result.metadata.allowedGroups).toContain('group:group-id');
    });

    it('should skip ACL sync when includeAcls option is false', async () => {
      const result = await connector.getDocumentWithAcls('doc.txt', { includeAcls: false });

      expect(result.metadata.accessControl).toBeUndefined();
      expect(result.metadata.allowedGroups).toBeUndefined();
    });

    it('should handle ACL fetch errors gracefully', async () => {
      mockFileClient.getAccessControl.mockRejectedValue(new Error('ACL error'));

      const result = await connector.getDocumentWithAcls('doc.txt');

      expect(result.metadata.aclsSynced).toBe(false);
      expect(result.metadata.aclSyncError).toBe('ACL error');
    });
  });

  describe('batchGetAccessControl', () => {
    beforeEach(() => {
      mockFileClient.getAccessControl.mockResolvedValue({
        owner: 'owner-id',
        group: 'group-id',
        permissions: 'rwxr-x---',
        acl: 'user::rwx,group::r-x,other::---',
      });
    });

    it('should retrieve ACLs for multiple files', async () => {
      const paths = ['file1.txt', 'file2.txt', 'file3.txt'];
      const results = await connector.batchGetAccessControl(paths);

      expect(results.size).toBe(3);
      expect(results.get('file1.txt')).toBeDefined();
      expect(results.get('file2.txt')).toBeDefined();
      expect(results.get('file3.txt')).toBeDefined();
    });

    it('should handle partial failures', async () => {
      mockFileClient.getAccessControl
        .mockResolvedValueOnce({
          owner: 'owner-id',
          group: 'group-id',
          acl: 'user::rwx',
        })
        .mockRejectedValueOnce(new Error('Access denied'))
        .mockResolvedValueOnce({
          owner: 'owner-id',
          group: 'group-id',
          acl: 'user::rwx',
        });

      const paths = ['file1.txt', 'file2.txt', 'file3.txt'];
      const results = await connector.batchGetAccessControl(paths);

      expect(results.size).toBe(2); // Only successful ones
    });

    it('should respect concurrency limit', async () => {
      const paths = Array(10)
        .fill(null)
        .map((_, i) => `file${i}.txt`);

      await connector.batchGetAccessControl(paths, { concurrency: 2 });

      // Each file should have been processed
      expect(mockFileClient.getAccessControl).toHaveBeenCalledTimes(10);
    });
  });

  describe('listDocuments with ACLs', () => {
    beforeEach(() => {
      mockFileSystemClient.listPaths.mockReturnValue(
        createAsyncIterator([
          { name: 'doc1.txt', contentLength: 100, isDirectory: false },
          { name: 'doc2.txt', contentLength: 200, isDirectory: false },
        ])
      );

      mockFileClient.getAccessControl.mockResolvedValue({
        owner: 'owner-id',
        group: 'group-id',
        permissions: 'rwxr-x---',
        acl: 'user::rwx,group::r-x,other::---',
      });
    });

    it('should include ACLs when includeAcls option is true', async () => {
      const result = await connector.listDocuments({ includeAcls: true });

      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].accessControl).toBeDefined();
      expect(result.documents[0].allowedGroups).toBeDefined();
    });

    it('should include ACL stats when ACLs are synced', async () => {
      const result = await connector.listDocuments({ includeAcls: true });

      expect(result.aclStats).toBeDefined();
      expect(result.aclStats.attempted).toBe(2);
      expect(result.aclStats.succeeded).toBe(2);
      expect(result.aclStats.failed).toBe(0);
    });

    it('should not include ACL stats when ACLs are not synced', async () => {
      const result = await connector.listDocuments({ includeAcls: false });

      expect(result.aclStats).toBeUndefined();
    });

    it('should track failed ACL syncs', async () => {
      mockFileClient.getAccessControl
        .mockResolvedValueOnce({
          owner: 'owner-id',
          group: 'group-id',
          acl: 'user::rwx',
        })
        .mockResolvedValueOnce(null); // Failed (returned null from 403 handler)

      const result = await connector.listDocuments({ includeAcls: true });

      expect(result.aclStats.succeeded).toBe(1);
      expect(result.aclStats.failed).toBe(1);
    });
  });

  describe('getAclSyncStats', () => {
    it('should calculate statistics from documents', async () => {
      const documents = [
        {
          id: 'doc1.txt',
          accessControl: { owner: 'owner1', group: 'group1' },
          allowedGroups: ['user:owner1', 'group:group1'],
        },
        {
          id: 'doc2.txt',
          accessControl: { owner: 'owner2', group: 'group1' },
          allowedGroups: ['user:owner2', 'group:group1', 'public'],
        },
        {
          id: 'doc3.txt',
          aclSyncError: 'Access denied',
        },
      ];

      const stats = await connector.getAclSyncStats(documents);

      expect(stats.totalDocuments).toBe(3);
      expect(stats.documentsWithAcls).toBe(2);
      expect(stats.aclErrors).toBe(1);
      expect(stats.uniqueOwners).toBe(2);
      expect(stats.uniqueGroups).toBe(1);
      expect(stats.publicDocuments).toBe(1);
    });
  });

  describe('_pathItemToMetadata with ACLs', () => {
    it('should include accessControl when provided', () => {
      const pathItem = { name: 'test.txt', contentLength: 100, lastModified: new Date() };
      const accessControl = { owner: 'owner-id', group: 'group-id', acl: [] };

      const metadata = connector._pathItemToMetadata(pathItem, accessControl);

      expect(metadata.accessControl).toBe(accessControl);
      expect(metadata.aclsSynced).toBe(true);
    });

    it('should include allowedGroups when provided', () => {
      const pathItem = { name: 'test.txt', contentLength: 100, lastModified: new Date() };
      const allowedGroups = ['user:owner-id', 'group:group-id'];

      const metadata = connector._pathItemToMetadata(pathItem, null, allowedGroups);

      expect(metadata.allowedGroups).toBe(allowedGroups);
    });

    it('should work without ACL parameters', () => {
      const pathItem = { name: 'test.txt', contentLength: 100, lastModified: new Date() };

      const metadata = connector._pathItemToMetadata(pathItem);

      expect(metadata.accessControl).toBeUndefined();
      expect(metadata.allowedGroups).toBeUndefined();
      expect(metadata.aclsSynced).toBeUndefined();
    });
  });

  describe('Configuration options', () => {
    it('should respect syncAcls config setting', async () => {
      const connectorWithAcls = createADLSGen2Connector('acl-enabled', {
        accountName: 'test',
        fileSystemName: 'testfs',
        syncAcls: true,
      });

      expect(connectorWithAcls.config.syncAcls).toBe(true);
    });

    it('should respect aclReadPermissionRequired config setting', () => {
      const connectorStrict = createADLSGen2Connector('strict-acl', {
        accountName: 'test',
        fileSystemName: 'testfs',
        aclReadPermissionRequired: true,
      });

      expect(connectorStrict.config.aclReadPermissionRequired).toBe(true);
    });

    it('should respect includeDefaultAcls config setting', () => {
      const connectorWithDefaults = createADLSGen2Connector('with-defaults', {
        accountName: 'test',
        fileSystemName: 'testfs',
        includeDefaultAcls: true,
      });

      expect(connectorWithDefaults.config.includeDefaultAcls).toBe(true);
    });
  });
});

describe('Complex ACL scenarios', () => {
  let connector;

  beforeEach(() => {
    connector = createADLSGen2Connector('complex-test', {
      accountName: 'test',
      fileSystemName: 'testfs',
      syncAcls: true,
      aclReadPermissionRequired: true,
    });
  });

  describe('Enterprise ACL patterns', () => {
    it('should handle multiple named users and groups', () => {
      const accessControl = {
        owner: 'admin-user-id',
        group: 'admin-group-id',
        acl: [
          { type: 'user', objectId: null, permissions: 'rwx', hasRead: true }, // owner
          { type: 'user', objectId: 'user1-id', permissions: 'r--', hasRead: true },
          { type: 'user', objectId: 'user2-id', permissions: 'rw-', hasRead: true },
          { type: 'group', objectId: null, permissions: 'r-x', hasRead: true }, // owning group
          { type: 'group', objectId: 'group1-id', permissions: 'r--', hasRead: true },
          { type: 'group', objectId: 'group2-id', permissions: 'r-x', hasRead: true },
          { type: 'mask', objectId: null, permissions: 'rwx', hasRead: true },
          { type: 'other', objectId: null, permissions: '---', hasRead: false },
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).toContain('user:admin-user-id');
      expect(allowedGroups).toContain('user:user1-id');
      expect(allowedGroups).toContain('user:user2-id');
      expect(allowedGroups).toContain('group:admin-group-id');
      expect(allowedGroups).toContain('group:group1-id');
      expect(allowedGroups).toContain('group:group2-id');
      expect(allowedGroups).not.toContain('public'); // other has no read
    });

    it('should handle public read access', () => {
      const accessControl = {
        owner: 'owner-id',
        group: 'group-id',
        acl: [
          { type: 'user', objectId: null, permissions: 'rwx', hasRead: true },
          { type: 'group', objectId: null, permissions: 'r-x', hasRead: true },
          { type: 'other', objectId: null, permissions: 'r--', hasRead: true },
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      expect(allowedGroups).toContain('public');
    });

    it('should handle restrictive ACLs (no external access)', () => {
      const accessControl = {
        owner: 'owner-id',
        group: 'group-id',
        acl: [
          { type: 'user', objectId: null, permissions: 'rwx', hasRead: true },
          { type: 'group', objectId: null, permissions: '---', hasRead: false },
          { type: 'other', objectId: null, permissions: '---', hasRead: false },
        ],
      };

      const allowedGroups = connector._aclToAllowedGroups(accessControl);

      // Only owner should have access
      expect(allowedGroups).toContain('user:owner-id');
      expect(allowedGroups).not.toContain('group:group-id'); // group has no read
      expect(allowedGroups).not.toContain('public');
    });
  });

  describe('Default ACL parsing', () => {
    it('should parse default ACL entries', () => {
      const aclString = 'user::rwx,group::r-x,other::---,default:user::rwx,default:group::r-x,default:other::---';
      const entries = connector._parseAclString(aclString);

      const defaultEntries = entries.filter((e) => e.isDefault);
      const accessEntries = entries.filter((e) => !e.isDefault);

      expect(defaultEntries).toHaveLength(3);
      expect(accessEntries).toHaveLength(3);
    });

    it('should correctly identify default user entry', () => {
      const entry = connector._parseAclEntry('default:user:user-id:rwx');

      expect(entry.isDefault).toBe(true);
      expect(entry.type).toBe('user');
      expect(entry.objectId).toBe('user-id');
    });
  });
});
