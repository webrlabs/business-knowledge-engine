/**
 * Azure Data Lake Storage Gen2 Connector (F4.2.3)
 *
 * Provides document synchronization from Azure Data Lake Storage Gen2.
 * Supports hierarchical namespace, file/directory operations, and
 * integrates with connector health and incremental sync services.
 *
 * Authentication methods:
 * - DefaultAzureCredential (recommended for production)
 * - Storage account key
 * - SAS token
 * - Connection string
 *
 * @module connectors/adls-gen2-connector
 * @see {@link https://www.npmjs.com/package/@azure/storage-file-datalake}
 */

const { DataLakeServiceClient, StorageSharedKeyCredential } = require('@azure/storage-file-datalake');
const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');
const { BaseConnector, ConnectionStatus } = require('./base-connector');
const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');

/**
 * Authentication types supported by the connector
 */
const AuthenticationType = {
  DEFAULT_CREDENTIAL: 'default_credential', // DefaultAzureCredential (recommended)
  STORAGE_KEY: 'storage_key', // Storage account key
  SAS_TOKEN: 'sas_token', // Shared Access Signature
  CONNECTION_STRING: 'connection_string', // Full connection string
};

/**
 * ACL permission flags
 */
const AclPermission = {
  READ: 'r',
  WRITE: 'w',
  EXECUTE: 'x',
};

/**
 * ACL entry types
 */
const AclEntryType = {
  USER: 'user',
  GROUP: 'group',
  MASK: 'mask',
  OTHER: 'other',
};

/**
 * Default configuration for ADLS Gen2 connector
 */
const DEFAULT_CONFIG = {
  // Connection settings
  accountName: process.env.ADLS_ACCOUNT_NAME,
  fileSystemName: process.env.ADLS_FILE_SYSTEM_NAME || process.env.ADLS_CONTAINER_NAME,
  authenticationType: process.env.ADLS_AUTHENTICATION_TYPE || AuthenticationType.DEFAULT_CREDENTIAL,
  storageKey: process.env.ADLS_STORAGE_KEY,
  sasToken: process.env.ADLS_SAS_TOKEN,
  connectionString: process.env.ADLS_CONNECTION_STRING,

  // Sync settings
  batchSize: parseInt(process.env.ADLS_BATCH_SIZE) || 50,
  includeSubdirectories: process.env.ADLS_INCLUDE_SUBDIRECTORIES !== 'false',
  fileExtensions: process.env.ADLS_FILE_EXTENSIONS
    ? process.env.ADLS_FILE_EXTENSIONS.split(',').map((ext) => ext.trim().toLowerCase())
    : null, // null = all extensions
  basePath: process.env.ADLS_BASE_PATH || '', // Root path to sync from
  excludePaths: process.env.ADLS_EXCLUDE_PATHS
    ? process.env.ADLS_EXCLUDE_PATHS.split(',').map((p) => p.trim())
    : [],

  // Content settings
  maxFileSizeBytes: parseInt(process.env.ADLS_MAX_FILE_SIZE_BYTES) || 50 * 1024 * 1024, // 50MB default
  downloadTimeoutMs: parseInt(process.env.ADLS_DOWNLOAD_TIMEOUT_MS) || 60000, // 1 minute

  // Health check settings
  healthCheckTimeoutMs: parseInt(process.env.ADLS_HEALTH_CHECK_TIMEOUT_MS) || 10000,

  // ACL Sync settings (F4.2.4)
  syncAcls: process.env.ADLS_SYNC_ACLS === 'true',
  includeDefaultAcls: process.env.ADLS_INCLUDE_DEFAULT_ACLS !== 'false', // Default true
  aclReadPermissionRequired: process.env.ADLS_ACL_READ_PERMISSION_REQUIRED !== 'false', // Default true - only include entries with read permission
  resolveObjectIds: process.env.ADLS_RESOLVE_OBJECT_IDS === 'true', // Resolve Azure AD object IDs to display names
};

/**
 * ADLS Gen2 Connector
 *
 * @extends BaseConnector
 */
class ADLSGen2Connector extends BaseConnector {
  /**
   * Create an ADLS Gen2 connector
   * @param {string} connectorId - Unique identifier for this connector
   * @param {Object} config - Configuration options
   * @param {string} config.accountName - Azure Storage account name
   * @param {string} config.fileSystemName - Data Lake file system (container) name
   * @param {string} [config.authenticationType] - Authentication method
   * @param {string} [config.storageKey] - Storage account key (if using key auth)
   * @param {string} [config.sasToken] - SAS token (if using SAS auth)
   * @param {string} [config.basePath] - Base path to sync from
   * @param {boolean} [config.includeSubdirectories] - Whether to include subdirectories
   * @param {string[]} [config.fileExtensions] - File extensions to include (null = all)
   * @param {number} [config.batchSize] - Batch size for listing operations
   */
  constructor(connectorId, config = {}) {
    super(connectorId, 'adls', { ...DEFAULT_CONFIG, ...config });

    this.serviceClient = null;
    this.fileSystemClient = null;
    this.credential = null;
  }

  /**
   * Initialize the connector and establish connection to ADLS Gen2
   * @returns {Promise<void>}
   * @throws {Error} If initialization fails
   */
  async initialize() {
    if (this.isInitialized) {
      log('warn', `Connector ${this.connectorId} is already initialized`);
      return;
    }

    this._setConnectionStatus(ConnectionStatus.CONNECTING);

    try {
      // Validate required configuration
      this._validateConfig(['accountName', 'fileSystemName']);

      // Create the appropriate credential
      this.credential = this._createCredential();

      // Create the service client
      this.serviceClient = this._createServiceClient();

      // Create the file system client
      this.fileSystemClient = this.serviceClient.getFileSystemClient(this.config.fileSystemName);

      // Verify connectivity
      const healthCheck = await this.performHealthCheck();
      if (!healthCheck.healthy) {
        throw new Error(`Health check failed: ${healthCheck.message}`);
      }

      this.isInitialized = true;
      this.initializationTime = new Date();
      this._setConnectionStatus(ConnectionStatus.CONNECTED);

      log('info', `ADLS Gen2 Connector ${this.connectorId} initialized successfully`, {
        accountName: this.config.accountName,
        fileSystemName: this.config.fileSystemName,
        basePath: this.config.basePath || '/',
      });

      trackEvent('ADLSConnectorInitialized', {
        connectorId: this.connectorId,
        accountName: this.config.accountName,
        fileSystemName: this.config.fileSystemName,
      });
    } catch (error) {
      this._setConnectionStatus(ConnectionStatus.ERROR);
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Perform a health check on the ADLS Gen2 connection
   * @returns {Promise<{healthy: boolean, message: string, details?: Object}>}
   */
  async performHealthCheck() {
    const startTime = Date.now();

    try {
      if (!this.serviceClient) {
        // Not initialized yet - try to create a temporary client for health check
        const tempCredential = this._createCredential();
        const tempClient = this._createServiceClient(tempCredential);
        const tempFileSystem = tempClient.getFileSystemClient(this.config.fileSystemName);

        // Try to check if file system exists
        const exists = await tempFileSystem.exists();

        return {
          healthy: exists,
          message: exists ? 'Connected to ADLS Gen2' : 'File system not found',
          details: {
            accountName: this.config.accountName,
            fileSystemName: this.config.fileSystemName,
            latencyMs: Date.now() - startTime,
          },
        };
      }

      // Check if file system exists and is accessible
      const exists = await this.fileSystemClient.exists();

      if (!exists) {
        return {
          healthy: false,
          message: `File system '${this.config.fileSystemName}' not found`,
          details: {
            accountName: this.config.accountName,
            fileSystemName: this.config.fileSystemName,
            latencyMs: Date.now() - startTime,
          },
        };
      }

      // Try to list some paths to verify read access
      const pathIterator = this.fileSystemClient.listPaths({ maxResults: 1 });
      await pathIterator.next(); // Just try to get one item

      const latencyMs = Date.now() - startTime;

      trackMetric('ADLSHealthCheckLatency', latencyMs, {
        connectorId: this.connectorId,
      });

      return {
        healthy: true,
        message: 'ADLS Gen2 connection healthy',
        details: {
          accountName: this.config.accountName,
          fileSystemName: this.config.fileSystemName,
          latencyMs,
          connectionStatus: this.connectionStatus,
        },
      };
    } catch (error) {
      this._recordError(error);

      return {
        healthy: false,
        message: `Health check failed: ${error.message}`,
        details: {
          accountName: this.config.accountName,
          fileSystemName: this.config.fileSystemName,
          errorCode: error.code,
          latencyMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * List documents from ADLS Gen2
   * @param {Object} options - List options
   * @param {string} [options.path] - Path to list from (default: basePath)
   * @param {boolean} [options.recursive] - Include subdirectories (default: config setting)
   * @param {string[]} [options.extensions] - Filter by file extensions
   * @param {number} [options.limit] - Maximum documents to return
   * @param {string} [options.continuationToken] - Pagination token
   * @param {boolean} [options.includeAcls] - Include ACLs for each document (F4.2.4)
   * @returns {Promise<{documents: Array, continuationToken?: string, aclStats?: Object}>}
   */
  async listDocuments(options = {}) {
    this._ensureInitialized();

    const startTime = Date.now();
    const path = options.path || this.config.basePath || '';
    const recursive = options.recursive ?? this.config.includeSubdirectories;
    const extensions = options.extensions || this.config.fileExtensions;
    const limit = options.limit || this.config.batchSize;
    const includeAcls = options.includeAcls !== undefined ? options.includeAcls : this.config.syncAcls;

    const documents = [];
    const pathItems = []; // Store path items for ACL batch processing
    let continuationToken = options.continuationToken;
    let count = 0;

    // ACL sync stats (F4.2.4)
    const aclStats = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
    };

    try {
      const listOptions = {
        recursive,
        ...(continuationToken && { continuationToken }),
      };

      // If path is specified, use it as prefix
      if (path) {
        listOptions.path = path;
      }

      const pathIterator = this.fileSystemClient.listPaths(listOptions);

      for await (const pathItem of pathIterator) {
        // Skip directories (we only want files)
        if (pathItem.isDirectory) {
          continue;
        }

        // Check if path is excluded
        if (this._isPathExcluded(pathItem.name)) {
          continue;
        }

        // Filter by extension if specified
        if (extensions && extensions.length > 0) {
          const ext = this._getFileExtension(pathItem.name);
          if (!extensions.includes(ext)) {
            continue;
          }
        }

        // Check file size
        if (pathItem.contentLength > this.config.maxFileSizeBytes) {
          log('debug', `Skipping file ${pathItem.name}: exceeds max size`, {
            size: pathItem.contentLength,
            maxSize: this.config.maxFileSizeBytes,
          });
          continue;
        }

        pathItems.push(pathItem);

        count++;
        if (count >= limit) {
          // Get continuation token for next page
          continuationToken = pathIterator.continuationToken;
          break;
        }
      }

      // Process ACLs if enabled (F4.2.4)
      if (includeAcls && pathItems.length > 0) {
        const filePaths = pathItems.map((item) => item.name);
        const aclResults = await this.batchGetAccessControl(filePaths);

        for (const pathItem of pathItems) {
          const accessControl = aclResults.get(pathItem.name);
          let allowedGroups = null;

          if (accessControl) {
            aclStats.succeeded++;
            allowedGroups = this._aclToAllowedGroups(accessControl);
          } else {
            aclStats.failed++;
          }
          aclStats.attempted++;

          documents.push(this._pathItemToMetadata(pathItem, accessControl, allowedGroups));
        }
      } else {
        // No ACL sync - just convert path items
        for (const pathItem of pathItems) {
          documents.push(this._pathItemToMetadata(pathItem));
        }
      }

      const latencyMs = Date.now() - startTime;

      trackMetric('ADLSListDocuments', count, {
        connectorId: this.connectorId,
        path,
        latencyMs,
        includeAcls,
        aclsSucceeded: aclStats.succeeded,
        aclsFailed: aclStats.failed,
      });

      log('debug', `Listed ${count} documents from ADLS Gen2`, {
        connectorId: this.connectorId,
        path,
        latencyMs,
        includeAcls,
        aclStats: includeAcls ? aclStats : undefined,
      });

      const result = {
        documents,
        continuationToken: count >= limit ? continuationToken : undefined,
      };

      // Include ACL stats if ACL sync was performed
      if (includeAcls) {
        result.aclStats = aclStats;
      }

      return result;
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Get a single document with its content
   * @param {string} documentPath - Path to the document in ADLS
   * @returns {Promise<{metadata: Object, content: Buffer, contentType: string}>}
   */
  async getDocument(documentPath) {
    this._ensureInitialized();

    const startTime = Date.now();

    try {
      const fileClient = this.fileSystemClient.getFileClient(documentPath);

      // Get file properties for metadata
      const properties = await fileClient.getProperties();

      // Download the file content
      const downloadResponse = await fileClient.read();

      // Read the stream into a buffer
      const chunks = [];
      for await (const chunk of downloadResponse.readableStreamBody) {
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks);

      // Calculate content hash
      const contentHash = crypto.createHash('md5').update(content).digest('hex');

      const metadata = {
        id: documentPath,
        sourceId: documentPath,
        name: this._getFileName(documentPath),
        path: documentPath,
        mimeType: properties.contentType || this._getMimeType(documentPath),
        size: properties.contentLength,
        createdAt: properties.createdOn,
        modifiedAt: properties.lastModified,
        contentHash,
        eTag: properties.etag,
        version: properties.etag, // Use ETag as version
        custom: {
          accessTier: properties.accessTier,
          leaseStatus: properties.leaseStatus,
          encryptionScope: properties.encryptionScope,
          metadata: properties.metadata,
        },
      };

      const latencyMs = Date.now() - startTime;

      trackMetric('ADLSGetDocument', properties.contentLength, {
        connectorId: this.connectorId,
        path: documentPath,
        latencyMs,
      });

      log('debug', `Downloaded document from ADLS Gen2`, {
        connectorId: this.connectorId,
        path: documentPath,
        size: properties.contentLength,
        latencyMs,
      });

      return {
        metadata,
        content,
        contentType: properties.contentType || this._getMimeType(documentPath),
      };
    } catch (error) {
      this._recordError(error);

      // Convert ADLS-specific errors to connector errors
      if (error.statusCode === 404) {
        const notFoundError = new Error(`Document not found: ${documentPath}`);
        notFoundError.code = 'NOT_FOUND';
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      throw error;
    }
  }

  /**
   * Get document metadata without content
   * @param {string} documentPath - Path to the document
   * @returns {Promise<Object>}
   */
  async getDocumentMetadata(documentPath) {
    this._ensureInitialized();

    try {
      const fileClient = this.fileSystemClient.getFileClient(documentPath);
      const properties = await fileClient.getProperties();

      return {
        id: documentPath,
        sourceId: documentPath,
        name: this._getFileName(documentPath),
        path: documentPath,
        mimeType: properties.contentType || this._getMimeType(documentPath),
        size: properties.contentLength,
        createdAt: properties.createdOn,
        modifiedAt: properties.lastModified,
        eTag: properties.etag,
        version: properties.etag,
        custom: {
          accessTier: properties.accessTier,
          leaseStatus: properties.leaseStatus,
          metadata: properties.metadata,
        },
      };
    } catch (error) {
      this._recordError(error);

      if (error.statusCode === 404) {
        const notFoundError = new Error(`Document not found: ${documentPath}`);
        notFoundError.code = 'NOT_FOUND';
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      throw error;
    }
  }

  /**
   * List all directories at a given path
   * @param {string} [path] - Path to list directories from
   * @returns {Promise<Array>}
   */
  async listDirectories(path = '') {
    this._ensureInitialized();

    const directories = [];
    const basePath = path || this.config.basePath || '';

    try {
      const pathIterator = this.fileSystemClient.listPaths({
        path: basePath,
        recursive: false,
      });

      for await (const pathItem of pathIterator) {
        if (pathItem.isDirectory) {
          directories.push({
            name: this._getFileName(pathItem.name),
            path: pathItem.name,
            lastModified: pathItem.lastModified,
          });
        }
      }

      return directories;
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Get file system (container) properties
   * @returns {Promise<Object>}
   */
  async getFileSystemProperties() {
    this._ensureInitialized();

    try {
      const properties = await this.fileSystemClient.getProperties();

      return {
        name: this.config.fileSystemName,
        lastModified: properties.lastModified,
        etag: properties.etag,
        leaseStatus: properties.leaseStatus,
        leaseState: properties.leaseState,
        hasImmutabilityPolicy: properties.hasImmutabilityPolicy,
        hasLegalHold: properties.hasLegalHold,
        metadata: properties.metadata,
      };
    } catch (error) {
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Disconnect from ADLS Gen2
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.serviceClient = null;
    this.fileSystemClient = null;
    this.credential = null;

    await super.disconnect();

    trackEvent('ADLSConnectorDisconnected', {
      connectorId: this.connectorId,
    });
  }

  // ============================================================================
  // ACL Sync Methods (F4.2.4)
  // ============================================================================

  /**
   * Get access control (ACL) for a file
   * @param {string} filePath - Path to the file in ADLS
   * @returns {Promise<Object>} Access control information including owner, group, permissions, and ACL entries
   */
  async getFileAccessControl(filePath) {
    this._ensureInitialized();

    const startTime = Date.now();

    try {
      const fileClient = this.fileSystemClient.getFileClient(filePath);
      const accessControl = await fileClient.getAccessControl();

      const result = {
        owner: accessControl.owner,
        group: accessControl.group,
        permissions: accessControl.permissions,
        acl: this._parseAclString(accessControl.acl),
        rawAcl: accessControl.acl,
      };

      const latencyMs = Date.now() - startTime;

      trackMetric('ADLSGetAccessControl', 1, {
        connectorId: this.connectorId,
        path: filePath,
        latencyMs,
        aclEntries: result.acl.length,
      });

      log('debug', `Retrieved ACL for file`, {
        connectorId: this.connectorId,
        path: filePath,
        owner: accessControl.owner,
        aclEntries: result.acl.length,
        latencyMs,
      });

      return result;
    } catch (error) {
      this._recordError(error);

      if (error.statusCode === 404) {
        const notFoundError = new Error(`File not found: ${filePath}`);
        notFoundError.code = 'NOT_FOUND';
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      // Handle authorization errors gracefully
      if (error.statusCode === 403) {
        log('warn', `Insufficient permissions to read ACL for ${filePath}`, {
          connectorId: this.connectorId,
          errorCode: error.code,
        });
        return null;
      }

      throw error;
    }
  }

  /**
   * Get access control (ACL) for a directory
   * @param {string} directoryPath - Path to the directory in ADLS
   * @param {boolean} [includeDefault=true] - Whether to include default ACLs
   * @returns {Promise<Object>} Access control information
   */
  async getDirectoryAccessControl(directoryPath, includeDefault = true) {
    this._ensureInitialized();

    try {
      const directoryClient = this.fileSystemClient.getDirectoryClient(directoryPath);
      const accessControl = await directoryClient.getAccessControl();

      const result = {
        owner: accessControl.owner,
        group: accessControl.group,
        permissions: accessControl.permissions,
        acl: this._parseAclString(accessControl.acl),
        rawAcl: accessControl.acl,
      };

      return result;
    } catch (error) {
      this._recordError(error);

      if (error.statusCode === 404) {
        const notFoundError = new Error(`Directory not found: ${directoryPath}`);
        notFoundError.code = 'NOT_FOUND';
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      if (error.statusCode === 403) {
        log('warn', `Insufficient permissions to read ACL for directory ${directoryPath}`, {
          connectorId: this.connectorId,
        });
        return null;
      }

      throw error;
    }
  }

  /**
   * Get document with ACLs included in metadata
   * @param {string} documentPath - Path to the document
   * @param {Object} [options] - Options
   * @param {boolean} [options.includeAcls] - Whether to include ACLs (overrides config)
   * @returns {Promise<{metadata: Object, content: Buffer, contentType: string}>}
   */
  async getDocumentWithAcls(documentPath, options = {}) {
    const shouldSyncAcls = options.includeAcls !== undefined
      ? options.includeAcls
      : this.config.syncAcls;

    // Get the document content first
    const document = await this.getDocument(documentPath);

    // If ACL sync is enabled, fetch and add ACLs
    if (shouldSyncAcls) {
      try {
        const accessControl = await this.getFileAccessControl(documentPath);

        if (accessControl) {
          // Parse ACLs to allowedGroups for security trimming
          const allowedGroups = this._aclToAllowedGroups(accessControl);

          document.metadata.accessControl = accessControl;
          document.metadata.allowedGroups = allowedGroups;
          document.metadata.aclsSynced = true;
        } else {
          document.metadata.aclsSynced = false;
          document.metadata.aclSyncError = 'Insufficient permissions';
        }
      } catch (aclError) {
        log('warn', `Failed to sync ACLs for document ${documentPath}`, {
          error: aclError.message,
        });
        document.metadata.aclsSynced = false;
        document.metadata.aclSyncError = aclError.message;
      }
    }

    return document;
  }

  /**
   * Convert ACL entries to allowedGroups array for security trimming
   * @param {Object} accessControl - Access control object from getAccessControl
   * @returns {string[]} Array of allowed group identifiers
   */
  _aclToAllowedGroups(accessControl) {
    const allowedGroups = new Set();

    if (!accessControl || !accessControl.acl) {
      return [];
    }

    // Process ACL entries to determine which principals have read access
    for (const entry of accessControl.acl) {
      // Check if this entry has read permission
      const hasReadPermission = entry.hasRead !== undefined
        ? entry.hasRead
        : (entry.permissions && entry.permissions.includes(AclPermission.READ));

      // Only include entries with read permission if configured
      if (this.config.aclReadPermissionRequired && !hasReadPermission) {
        continue;
      }

      // Skip 'other' entries - these represent public access
      if (entry.type === AclEntryType.OTHER) {
        if (hasReadPermission) {
          allowedGroups.add('public');
        }
        continue;
      }

      // Skip 'mask' entries - these are permission masks, not principals
      if (entry.type === AclEntryType.MASK) {
        continue;
      }

      // Handle named user/group entries (have an objectId)
      if (entry.objectId) {
        if (entry.type === AclEntryType.USER) {
          allowedGroups.add(`user:${entry.objectId}`);
        } else if (entry.type === AclEntryType.GROUP) {
          allowedGroups.add(`group:${entry.objectId}`);
        }
      } else {
        // Handle unnamed entries (owner/owning group) - use the accessControl owner/group IDs
        if (entry.type === AclEntryType.USER && accessControl.owner) {
          allowedGroups.add(`user:${accessControl.owner}`);
        } else if (entry.type === AclEntryType.GROUP && accessControl.group) {
          allowedGroups.add(`group:${accessControl.group}`);
        }
      }
    }

    return Array.from(allowedGroups);
  }

  /**
   * Parse POSIX ACL string into structured entries
   * ADLS Gen2 ACL format: "user::rwx,user:oid:rwx,group::r-x,group:oid:r-x,mask::rwx,other::---"
   * @param {string} aclString - ACL string from ADLS
   * @returns {Object[]} Parsed ACL entries
   * @private
   */
  _parseAclString(aclString) {
    if (!aclString) {
      return [];
    }

    const entries = [];
    const parts = aclString.split(',');

    for (const part of parts) {
      const entry = this._parseAclEntry(part.trim());
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Parse a single ACL entry
   * Format: "type:objectId:permissions" or "type::permissions" for unnamed entries
   * Default ACL format: "default:type:objectId:permissions"
   * @param {string} entryString - Single ACL entry string
   * @returns {Object|null} Parsed entry or null if invalid
   * @private
   */
  _parseAclEntry(entryString) {
    if (!entryString) {
      return null;
    }

    const parts = entryString.split(':');

    let isDefault = false;
    let type, objectId, permissions;

    if (parts[0] === 'default') {
      isDefault = true;
      parts.shift();
    }

    if (parts.length < 3) {
      // Invalid entry format
      return null;
    }

    type = parts[0].toLowerCase();
    objectId = parts[1] || null; // Empty string means unnamed entry (owner/owning group)
    permissions = parts[2] || '';

    // Validate type
    if (!Object.values(AclEntryType).includes(type)) {
      log('debug', `Unknown ACL entry type: ${type}`);
      return null;
    }

    return {
      type,
      objectId: objectId || null,
      permissions,
      isDefault,
      hasRead: permissions.includes(AclPermission.READ),
      hasWrite: permissions.includes(AclPermission.WRITE),
      hasExecute: permissions.includes(AclPermission.EXECUTE),
      raw: entryString,
    };
  }

  /**
   * Batch get ACLs for multiple files
   * @param {string[]} filePaths - Array of file paths
   * @param {Object} [options] - Options
   * @param {number} [options.concurrency=5] - Maximum concurrent requests
   * @returns {Promise<Map<string, Object>>} Map of path to access control
   */
  async batchGetAccessControl(filePaths, options = {}) {
    this._ensureInitialized();

    const concurrency = options.concurrency || 5;
    const results = new Map();
    const errors = [];

    // Process in batches for controlled concurrency
    for (let i = 0; i < filePaths.length; i += concurrency) {
      const batch = filePaths.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map(async (path) => {
          const acl = await this.getFileAccessControl(path);
          return { path, acl };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.set(result.value.path, result.value.acl);
        } else {
          errors.push({
            path: batch[batchResults.indexOf(result)],
            error: result.reason.message,
          });
        }
      }
    }

    if (errors.length > 0) {
      log('warn', `Batch ACL retrieval completed with ${errors.length} errors`, {
        connectorId: this.connectorId,
        totalPaths: filePaths.length,
        successCount: results.size,
        errorCount: errors.length,
      });
    }

    trackMetric('ADLSBatchGetAccessControl', results.size, {
      connectorId: this.connectorId,
      totalPaths: filePaths.length,
      errorCount: errors.length,
    });

    return results;
  }

  /**
   * Get ACL sync statistics from a list operation result
   * @param {Object[]} documents - Documents from listDocuments
   * @returns {Promise<Object>} Statistics about ACL sync
   */
  async getAclSyncStats(documents) {
    const stats = {
      totalDocuments: documents.length,
      documentsWithAcls: 0,
      documentsWithoutAcls: 0,
      aclErrors: 0,
      uniqueOwners: new Set(),
      uniqueGroups: new Set(),
      uniqueAllowedGroups: new Set(),
      publicDocuments: 0,
    };

    for (const doc of documents) {
      if (doc.accessControl) {
        stats.documentsWithAcls++;

        if (doc.accessControl.owner) {
          stats.uniqueOwners.add(doc.accessControl.owner);
        }
        if (doc.accessControl.group) {
          stats.uniqueGroups.add(doc.accessControl.group);
        }

        if (doc.allowedGroups) {
          for (const group of doc.allowedGroups) {
            stats.uniqueAllowedGroups.add(group);
            if (group === 'public') {
              stats.publicDocuments++;
            }
          }
        }
      } else if (doc.aclSyncError) {
        stats.aclErrors++;
      } else {
        stats.documentsWithoutAcls++;
      }
    }

    return {
      ...stats,
      uniqueOwners: stats.uniqueOwners.size,
      uniqueGroups: stats.uniqueGroups.size,
      uniqueAllowedGroups: stats.uniqueAllowedGroups.size,
    };
  }

  // ============================================================================
  // Private helper methods
  // ============================================================================

  /**
   * Create the appropriate credential based on configuration
   * @returns {Object} Credential object
   * @private
   */
  _createCredential() {
    switch (this.config.authenticationType) {
      case AuthenticationType.STORAGE_KEY:
        if (!this.config.storageKey) {
          throw new Error('Storage key is required for storage_key authentication');
        }
        return new StorageSharedKeyCredential(this.config.accountName, this.config.storageKey);

      case AuthenticationType.SAS_TOKEN:
        // SAS token is appended to URL, no credential object needed
        return null;

      case AuthenticationType.CONNECTION_STRING:
        // Connection string is handled by fromConnectionString
        return null;

      case AuthenticationType.DEFAULT_CREDENTIAL:
      default:
        return new DefaultAzureCredential();
    }
  }

  /**
   * Create the DataLakeServiceClient
   * @param {Object} [credential] - Optional credential override
   * @returns {DataLakeServiceClient}
   * @private
   */
  _createServiceClient(credential = null) {
    const cred = credential || this.credential;

    if (this.config.authenticationType === AuthenticationType.CONNECTION_STRING) {
      if (!this.config.connectionString) {
        throw new Error('Connection string is required for connection_string authentication');
      }
      return DataLakeServiceClient.fromConnectionString(this.config.connectionString);
    }

    let url = `https://${this.config.accountName}.dfs.core.windows.net`;

    if (this.config.authenticationType === AuthenticationType.SAS_TOKEN) {
      if (!this.config.sasToken) {
        throw new Error('SAS token is required for sas_token authentication');
      }
      url += this.config.sasToken.startsWith('?') ? this.config.sasToken : `?${this.config.sasToken}`;
      return new DataLakeServiceClient(url);
    }

    return new DataLakeServiceClient(url, cred);
  }

  /**
   * Convert ADLS path item to document metadata format
   * @param {Object} pathItem - ADLS path item
   * @param {Object} [accessControl] - Optional access control from ACL sync
   * @param {string[]} [allowedGroups] - Optional allowed groups derived from ACLs
   * @returns {Object} Document metadata
   * @private
   */
  _pathItemToMetadata(pathItem, accessControl = null, allowedGroups = null) {
    const metadata = {
      id: pathItem.name,
      sourceId: pathItem.name,
      name: this._getFileName(pathItem.name),
      path: pathItem.name,
      mimeType: this._getMimeType(pathItem.name),
      size: pathItem.contentLength,
      createdAt: pathItem.createdOn || pathItem.lastModified,
      modifiedAt: pathItem.lastModified,
      eTag: pathItem.etag,
      version: pathItem.etag,
      custom: {
        owner: pathItem.owner,
        group: pathItem.group,
        permissions: pathItem.permissions,
      },
    };

    // Add ACL information if available (F4.2.4)
    if (accessControl) {
      metadata.accessControl = accessControl;
      metadata.aclsSynced = true;
    }

    // Add allowedGroups for security trimming (F4.2.4)
    if (allowedGroups) {
      metadata.allowedGroups = allowedGroups;
    }

    return metadata;
  }

  /**
   * Get file name from path
   * @param {string} path - Full path
   * @returns {string} File name
   * @private
   */
  _getFileName(path) {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  /**
   * Get file extension (lowercase, without dot)
   * @param {string} path - File path
   * @returns {string} Extension
   * @private
   */
  _getFileExtension(path) {
    const name = this._getFileName(path);
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex === -1) return '';
    return name.substring(dotIndex + 1).toLowerCase();
  }

  /**
   * Get MIME type based on file extension
   * @param {string} path - File path
   * @returns {string} MIME type
   * @private
   */
  _getMimeType(path) {
    const ext = this._getFileExtension(path);
    const mimeTypes = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      xml: 'application/xml',
      html: 'text/html',
      md: 'text/markdown',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      zip: 'application/zip',
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Check if a path should be excluded
   * @param {string} path - File path
   * @returns {boolean} True if path should be excluded
   * @private
   */
  _isPathExcluded(path) {
    if (!this.config.excludePaths || this.config.excludePaths.length === 0) {
      return false;
    }

    return this.config.excludePaths.some((excludePath) => {
      // Support wildcards
      if (excludePath.includes('*')) {
        const regex = new RegExp('^' + excludePath.replace(/\*/g, '.*') + '$');
        return regex.test(path);
      }
      return path.startsWith(excludePath);
    });
  }
}

// Singleton instance for default connector
let defaultConnector = null;

/**
 * Get the default ADLS Gen2 connector instance
 * @param {Object} [config] - Optional configuration override
 * @returns {ADLSGen2Connector}
 */
function getADLSGen2Connector(config = {}) {
  if (!defaultConnector) {
    defaultConnector = new ADLSGen2Connector('default-adls', config);
  }
  return defaultConnector;
}

/**
 * Create a new ADLS Gen2 connector instance
 * @param {string} connectorId - Unique identifier
 * @param {Object} config - Configuration
 * @returns {ADLSGen2Connector}
 */
function createADLSGen2Connector(connectorId, config = {}) {
  return new ADLSGen2Connector(connectorId, config);
}

/**
 * Reset the default connector (for testing)
 */
function resetDefaultConnector() {
  defaultConnector = null;
}

module.exports = {
  ADLSGen2Connector,
  AuthenticationType,
  AclPermission,
  AclEntryType,
  getADLSGen2Connector,
  createADLSGen2Connector,
  resetDefaultConnector,
  DEFAULT_CONFIG,
};
