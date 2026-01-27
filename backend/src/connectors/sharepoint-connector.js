/**
 * SharePoint Site Connector (F4.2.1)
 *
 * Provides connectivity to SharePoint Online sites for document ingestion
 * using Microsoft Graph API. Supports both full sync and delta (incremental)
 * sync for efficient document retrieval.
 *
 * Features:
 * - Connection to SharePoint Online sites via Microsoft Graph
 * - Site discovery and document library enumeration
 * - Full and incremental document sync using delta queries
 * - Document metadata extraction (permissions, modified date, etc.)
 * - File content download with streaming support
 * - Integration with ConnectorHealthService for monitoring
 * - Integration with IncrementalSyncService for change tracking
 * - Support for both application (daemon) and delegated authentication
 *
 * Authentication:
 * - Uses @azure/identity for Azure AD / Microsoft Entra ID authentication
 * - Supports ClientSecretCredential for app-only access
 * - Supports ClientCertificateCredential for certificate-based auth
 * - Supports DefaultAzureCredential for managed identity scenarios
 *
 * Required Permissions (Azure AD App Registration):
 * - Sites.Read.All or Sites.ReadWrite.All (Application permission)
 * - Files.Read.All or Files.ReadWrite.All (Application permission)
 *
 * @module connectors/sharepoint-connector
 */

const { log } = require('../utils/logger');
const { trackEvent, trackMetric } = require('../utils/telemetry');
const {
  getConnectorHealthService,
  ConnectorType,
  SyncStatus,
} = require('../services/connector-health-service');

// Connector constants
const CONNECTOR_TYPE = ConnectorType.SHAREPOINT;
const GRAPH_API_VERSION = 'v1.0';
const GRAPH_BASE_URL = `https://graph.microsoft.com/${GRAPH_API_VERSION}`;
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * File type mappings for supported document types
 */
const SUPPORTED_FILE_TYPES = {
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  // Rich text
  '.rtf': 'application/rtf',
  '.html': 'text/html',
  '.htm': 'text/html',
};

/**
 * SharePoint connection configuration
 */
class SharePointConnectionConfig {
  /**
   * @param {Object} options - Connection options
   * @param {string} options.tenantId - Azure AD tenant ID
   * @param {string} options.clientId - Application (client) ID
   * @param {string} options.clientSecret - Client secret (optional if using certificate)
   * @param {string} options.certificatePath - Path to certificate (optional if using secret)
   * @param {string} options.siteUrl - SharePoint site URL (e.g., 'contoso.sharepoint.com')
   * @param {string} options.sitePath - Site path (e.g., '/sites/TeamSite')
   * @param {string[]} options.libraryNames - Document library names to sync (empty = all)
   * @param {string[]} options.includedFolders - Folder paths to include (optional)
   * @param {string[]} options.excludedFolders - Folder paths to exclude (optional)
   * @param {string[]} options.fileTypes - File extensions to sync (empty = all supported)
   * @param {number} options.pageSize - Items per page for API requests
   * @param {number} options.timeoutMs - Request timeout in milliseconds
   * @param {boolean} options.syncPermissions - Whether to sync document permissions (F4.2.2)
   * @param {boolean} options.includeInheritedPermissions - Include permissions inherited from parent
   * @param {string[]} options.permissionRolesToSync - Which roles to map to allowedGroups (default: all)
   */
  constructor(options = {}) {
    // Authentication
    this.tenantId = options.tenantId || process.env.SHAREPOINT_TENANT_ID || process.env.AZURE_AD_TENANT_ID;
    this.clientId = options.clientId || process.env.SHAREPOINT_CLIENT_ID;
    this.clientSecret = options.clientSecret || process.env.SHAREPOINT_CLIENT_SECRET;
    this.certificatePath = options.certificatePath || process.env.SHAREPOINT_CERTIFICATE_PATH;

    // Site configuration
    this.siteUrl = options.siteUrl || process.env.SHAREPOINT_SITE_URL;
    this.sitePath = options.sitePath || process.env.SHAREPOINT_SITE_PATH || '';

    // Filtering
    this.libraryNames = options.libraryNames || [];
    this.includedFolders = options.includedFolders || [];
    this.excludedFolders = options.excludedFolders || [];
    this.fileTypes = options.fileTypes || Object.keys(SUPPORTED_FILE_TYPES);

    // Performance
    this.pageSize = options.pageSize || parseInt(process.env.SHAREPOINT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
    this.timeoutMs = options.timeoutMs || parseInt(process.env.SHAREPOINT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

    // Permission sync settings (F4.2.2)
    this.syncPermissions = options.syncPermissions !== undefined
      ? options.syncPermissions
      : process.env.SHAREPOINT_SYNC_PERMISSIONS === 'true';
    this.includeInheritedPermissions = options.includeInheritedPermissions !== undefined
      ? options.includeInheritedPermissions
      : process.env.SHAREPOINT_INCLUDE_INHERITED_PERMISSIONS !== 'false'; // Default true
    this.permissionRolesToSync = options.permissionRolesToSync ||
      (process.env.SHAREPOINT_PERMISSION_ROLES_TO_SYNC
        ? process.env.SHAREPOINT_PERMISSION_ROLES_TO_SYNC.split(',')
        : []); // Empty = all roles

    // Validate required fields
    this.validate();
  }

  /**
   * Validate configuration
   * @throws {Error} If required fields are missing
   */
  validate() {
    const errors = [];

    if (!this.tenantId) {
      errors.push('tenantId is required (set SHAREPOINT_TENANT_ID or AZURE_AD_TENANT_ID)');
    }
    if (!this.clientId) {
      errors.push('clientId is required (set SHAREPOINT_CLIENT_ID)');
    }
    if (!this.clientSecret && !this.certificatePath) {
      errors.push('clientSecret or certificatePath is required');
    }
    if (!this.siteUrl) {
      errors.push('siteUrl is required (set SHAREPOINT_SITE_URL)');
    }

    if (errors.length > 0) {
      throw new Error(`SharePoint connector configuration errors: ${errors.join('; ')}`);
    }
  }

  /**
   * Get the full site identifier for Graph API
   * @returns {string} Site identifier in format 'hostname:sitePath'
   */
  getSiteIdentifier() {
    const url = this.siteUrl.replace(/^https?:\/\//, '');
    if (this.sitePath) {
      return `${url}:${this.sitePath}`;
    }
    return url;
  }

  /**
   * Convert to serializable object (excluding secrets)
   * @returns {Object}
   */
  toJSON() {
    return {
      tenantId: this.tenantId,
      clientId: this.clientId,
      siteUrl: this.siteUrl,
      sitePath: this.sitePath,
      libraryNames: this.libraryNames,
      includedFolders: this.includedFolders,
      excludedFolders: this.excludedFolders,
      fileTypes: this.fileTypes,
      pageSize: this.pageSize,
      timeoutMs: this.timeoutMs,
      syncPermissions: this.syncPermissions,
      includeInheritedPermissions: this.includeInheritedPermissions,
      permissionRolesToSync: this.permissionRolesToSync,
    };
  }
}

/**
 * SharePoint document item
 */
class SharePointDocument {
  constructor(driveItem, driveId, siteId) {
    this.id = driveItem.id;
    this.driveId = driveId;
    this.siteId = siteId;
    this.name = driveItem.name;
    this.path = driveItem.parentReference?.path || '';
    this.webUrl = driveItem.webUrl;
    this.size = driveItem.size || 0;
    this.mimeType = driveItem.file?.mimeType || this._inferMimeType(driveItem.name);
    this.createdDateTime = driveItem.createdDateTime;
    this.lastModifiedDateTime = driveItem.lastModifiedDateTime;
    this.createdBy = driveItem.createdBy?.user?.displayName || 'Unknown';
    this.lastModifiedBy = driveItem.lastModifiedBy?.user?.displayName || 'Unknown';
    this.eTag = driveItem.eTag;
    this.cTag = driveItem.cTag;

    // SharePoint-specific metadata
    this.listItemId = driveItem.listItem?.id;
    this.contentType = driveItem.listItem?.contentType?.name;
    this.fields = driveItem.listItem?.fields || {};

    // Permissions (populated separately)
    this.permissions = [];
    this.sharedWith = [];

    // Security trimming field (F4.2.2 - populated via syncPermissions)
    this.allowedGroups = [];
  }

  /**
   * Set permissions and derive allowedGroups for security trimming (F4.2.2)
   * @param {Object[]} permissions - Raw permission objects from Graph API
   * @param {Object} options - Mapping options
   * @param {boolean} options.includeInherited - Include inherited permissions (default true)
   * @param {string[]} options.rolesToInclude - Only include these roles (empty = all)
   */
  setPermissions(permissions, options = {}) {
    const { includeInherited = true, rolesToInclude = [] } = options;

    this.permissions = permissions;
    this.allowedGroups = [];
    const groupSet = new Set();

    for (const perm of permissions) {
      // Skip inherited permissions if not configured to include them
      if (!includeInherited && perm.inheritedFrom) {
        continue;
      }

      // Filter by roles if specified
      if (rolesToInclude.length > 0) {
        const permRoles = perm.roles || [];
        const hasMatchingRole = permRoles.some(role =>
          rolesToInclude.includes(role.toLowerCase())
        );
        if (!hasMatchingRole) {
          continue;
        }
      }

      // Extract group identifiers from different permission types
      this._extractGroupsFromPermission(perm, groupSet);
    }

    this.allowedGroups = Array.from(groupSet).filter(g => g && g.trim());

    // Also populate sharedWith for backward compatibility
    this.sharedWith = permissions
      .map(p => p.grantedTo || p.grantedToEmail)
      .filter(Boolean);
  }

  /**
   * Extract group identifiers from a single permission entry
   * @private
   */
  _extractGroupsFromPermission(perm, groupSet) {
    // Handle group grants (grantedToIdentitiesV2 or grantedToIdentities)
    const identitiesV2 = perm.grantedToIdentitiesV2 || [];
    const identities = perm.grantedToIdentities || [];

    for (const identity of [...identitiesV2, ...identities]) {
      // Azure AD Group
      if (identity.group) {
        const groupName = identity.group.displayName || identity.group.id;
        if (groupName) groupSet.add(groupName);
      }
      // SharePoint Group
      if (identity.siteGroup) {
        const groupName = identity.siteGroup.displayName || identity.siteGroup.id;
        if (groupName) groupSet.add(groupName);
      }
      // User (add user's email as a "group" for direct access)
      if (identity.user) {
        const userEmail = identity.user.email || identity.user.userPrincipalName;
        if (userEmail) groupSet.add(`user:${userEmail}`);
      }
    }

    // Handle single grantedTo (older API format)
    if (perm.grantedTo) {
      if (perm.grantedTo.user) {
        const email = perm.grantedTo.user.email || perm.grantedTo.user.userPrincipalName;
        if (email) groupSet.add(`user:${email}`);
      }
    }

    // Handle grantedToV2 (newer API format)
    if (perm.grantedToV2) {
      if (perm.grantedToV2.group) {
        const groupName = perm.grantedToV2.group.displayName || perm.grantedToV2.group.id;
        if (groupName) groupSet.add(groupName);
      }
      if (perm.grantedToV2.siteGroup) {
        const groupName = perm.grantedToV2.siteGroup.displayName || perm.grantedToV2.siteGroup.id;
        if (groupName) groupSet.add(groupName);
      }
      if (perm.grantedToV2.user) {
        const email = perm.grantedToV2.user.email || perm.grantedToV2.user.userPrincipalName;
        if (email) groupSet.add(`user:${email}`);
      }
    }

    // Handle sharing links (organization-wide, anyone, etc.)
    if (perm.link) {
      if (perm.link.scope === 'organization') {
        groupSet.add('organization'); // All authenticated users in tenant
      } else if (perm.link.scope === 'anonymous') {
        groupSet.add('anonymous'); // Public access
      } else if (perm.link.scope === 'users') {
        // Specific users - already handled above via grantedToIdentities
      }
    }
  }

  /**
   * Get unique identifier for change tracking
   * @returns {string}
   */
  getUniqueId() {
    return `sharepoint:${this.siteId}:${this.driveId}:${this.id}`;
  }

  /**
   * Get download URL placeholder (actual URL obtained via API)
   * @returns {string}
   */
  getDownloadPath() {
    return `/drives/${this.driveId}/items/${this.id}/content`;
  }

  /**
   * Infer MIME type from file extension
   * @private
   */
  _inferMimeType(filename) {
    const ext = filename ? '.' + filename.split('.').pop().toLowerCase() : '';
    return SUPPORTED_FILE_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * Check if this is a supported file type
   * @returns {boolean}
   */
  isSupported() {
    const ext = '.' + (this.name || '').split('.').pop().toLowerCase();
    return ext in SUPPORTED_FILE_TYPES;
  }

  /**
   * Convert to document metadata format
   * @returns {Object}
   */
  toDocumentMetadata() {
    return {
      sourceId: this.getUniqueId(),
      sourceType: 'sharepoint',
      sourceName: this.name,
      sourceUrl: this.webUrl,
      sourcePath: this.path,
      mimeType: this.mimeType,
      size: this.size,
      createdAt: this.createdDateTime,
      modifiedAt: this.lastModifiedDateTime,
      createdBy: this.createdBy,
      modifiedBy: this.lastModifiedBy,
      eTag: this.eTag,
      // F4.2.2: allowedGroups at top level for security trimming
      allowedGroups: this.allowedGroups,
      metadata: {
        driveId: this.driveId,
        siteId: this.siteId,
        itemId: this.id,
        listItemId: this.listItemId,
        contentType: this.contentType,
        fields: this.fields,
        permissions: this.permissions,
        sharedWith: this.sharedWith,
      },
    };
  }
}

/**
 * Delta sync state for tracking changes
 */
class SharePointDeltaState {
  constructor(driveId, deltaLink = null) {
    this.driveId = driveId;
    this.deltaLink = deltaLink;
    this.lastSyncTime = deltaLink ? new Date().toISOString() : null;
    this.syncedItemCount = 0;
    this.deletedItemCount = 0;
  }

  /**
   * Update with new delta link after sync
   * @param {string} newDeltaLink - New delta link from API
   * @param {number} synced - Number of items synced
   * @param {number} deleted - Number of items deleted
   */
  update(newDeltaLink, synced = 0, deleted = 0) {
    this.deltaLink = newDeltaLink;
    this.lastSyncTime = new Date().toISOString();
    this.syncedItemCount += synced;
    this.deletedItemCount += deleted;
  }

  /**
   * Check if this is a fresh sync (no delta link)
   * @returns {boolean}
   */
  isFreshSync() {
    return !this.deltaLink;
  }
}

/**
 * SharePoint Connector for document ingestion
 */
class SharePointConnector {
  /**
   * @param {SharePointConnectionConfig|Object} config - Connection configuration
   */
  constructor(config) {
    this.config = config instanceof SharePointConnectionConfig
      ? config
      : new SharePointConnectionConfig(config);

    this.connectorId = `sharepoint-${this.config.siteUrl.replace(/[^a-zA-Z0-9]/g, '-')}`;
    this.graphClient = null;
    this.credential = null;
    this.siteId = null;
    this.isInitialized = false;

    // Delta state per drive
    this.deltaStates = new Map();

    // Health service integration
    this.healthService = null;
  }

  /**
   * Initialize the connector
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      log.info({ connectorId: this.connectorId }, 'Initializing SharePoint connector');

      // Lazy load dependencies to allow mocking in tests
      await this._initializeAuth();
      await this._initializeGraphClient();
      await this._resolveSiteId();

      // Register with health service
      this.healthService = getConnectorHealthService();
      this.healthService.registerConnector(this.connectorId, CONNECTOR_TYPE, {
        connectionConfig: this.config.toJSON(),
        isEnabled: true,
      });

      this.isInitialized = true;

      log.info({
        connectorId: this.connectorId,
        siteId: this.siteId,
      }, 'SharePoint connector initialized successfully');

      trackEvent('sharepoint_connector_initialized', {
        connectorId: this.connectorId,
        siteUrl: this.config.siteUrl,
      });

    } catch (error) {
      log.error({ error: error.message, connectorId: this.connectorId }, 'Failed to initialize SharePoint connector');
      throw error;
    }
  }

  /**
   * Initialize Azure AD authentication
   * @private
   */
  async _initializeAuth() {
    // Lazy load @azure/identity to allow mocking
    const { ClientSecretCredential, ClientCertificateCredential } = require('@azure/identity');

    if (this.config.clientSecret) {
      this.credential = new ClientSecretCredential(
        this.config.tenantId,
        this.config.clientId,
        this.config.clientSecret
      );
    } else if (this.config.certificatePath) {
      this.credential = new ClientCertificateCredential(
        this.config.tenantId,
        this.config.clientId,
        this.config.certificatePath
      );
    }

    log.debug({ connectorId: this.connectorId }, 'Azure AD credential initialized');
  }

  /**
   * Initialize Microsoft Graph client
   * @private
   */
  async _initializeGraphClient() {
    // Lazy load Microsoft Graph client
    const { Client } = require('@microsoft/microsoft-graph-client');
    const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');

    const authProvider = new TokenCredentialAuthenticationProvider(this.credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });

    this.graphClient = Client.initWithMiddleware({
      authProvider,
      defaultVersion: GRAPH_API_VERSION,
    });

    log.debug({ connectorId: this.connectorId }, 'Microsoft Graph client initialized');
  }

  /**
   * Resolve SharePoint site ID from site URL
   * @private
   */
  async _resolveSiteId() {
    const siteIdentifier = this.config.getSiteIdentifier();

    try {
      const site = await this.graphClient
        .api(`/sites/${siteIdentifier}`)
        .select('id,displayName,webUrl')
        .get();

      this.siteId = site.id;
      this.siteName = site.displayName;
      this.siteWebUrl = site.webUrl;

      log.info({
        connectorId: this.connectorId,
        siteId: this.siteId,
        siteName: this.siteName,
      }, 'SharePoint site resolved');

    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`SharePoint site not found: ${siteIdentifier}`);
      }
      throw error;
    }
  }

  /**
   * Test connection to SharePoint
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const startTime = Date.now();

      // Try to get site info and drives
      const [site, drives] = await Promise.all([
        this.graphClient.api(`/sites/${this.siteId}`).select('id,displayName').get(),
        this.graphClient.api(`/sites/${this.siteId}/drives`).select('id,name').top(1).get(),
      ]);

      const duration = Date.now() - startTime;

      // Report health check
      if (this.healthService) {
        await this.healthService.performHealthCheck(this.connectorId, async () => ({
          healthy: true,
          message: `Connected to site: ${site.displayName}`,
        }));
      }

      return {
        success: true,
        siteId: site.id,
        siteName: site.displayName,
        drivesAvailable: drives.value?.length || 0,
        latencyMs: duration,
        message: 'Connection successful',
      };

    } catch (error) {
      if (this.healthService) {
        this.healthService.trackSyncError(this.connectorId, {
          type: 'connection_test_failed',
          message: error.message,
          code: error.code || error.statusCode,
        });
      }

      return {
        success: false,
        error: error.message,
        code: error.code || error.statusCode,
        message: 'Connection failed',
      };
    }
  }

  /**
   * List all document libraries in the site
   * @returns {Promise<Object[]>} List of document libraries
   */
  async listDocumentLibraries() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const response = await this.graphClient
        .api(`/sites/${this.siteId}/drives`)
        .select('id,name,description,driveType,webUrl,quota')
        .get();

      const libraries = response.value.map(drive => ({
        id: drive.id,
        name: drive.name,
        description: drive.description,
        type: drive.driveType,
        webUrl: drive.webUrl,
        quota: drive.quota ? {
          total: drive.quota.total,
          used: drive.quota.used,
          remaining: drive.quota.remaining,
        } : null,
      }));

      // Filter by configured library names if specified
      if (this.config.libraryNames.length > 0) {
        return libraries.filter(lib =>
          this.config.libraryNames.includes(lib.name)
        );
      }

      return libraries;

    } catch (error) {
      log.error({ error: error.message, connectorId: this.connectorId }, 'Failed to list document libraries');
      throw error;
    }
  }

  /**
   * Sync documents from all configured libraries
   * @param {Object} options - Sync options
   * @param {boolean} options.fullSync - Force full sync instead of delta
   * @param {Function} options.onDocument - Callback for each document
   * @param {Function} options.onProgress - Progress callback
   * @param {string} options.syncId - Sync session ID
   * @returns {Promise<Object>} Sync result
   */
  async syncDocuments(options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const {
      fullSync = false,
      onDocument,
      onProgress,
      syncId = `sync-${Date.now()}`,
    } = options;

    const syncType = fullSync ? 'full' : 'incremental';

    // Track sync start
    if (this.healthService) {
      this.healthService.trackSyncStart(this.connectorId, {
        syncId,
        syncType,
      });
    }

    log.info({
      connectorId: this.connectorId,
      syncId,
      syncType,
    }, 'Starting SharePoint document sync');

    const result = {
      syncId,
      syncType,
      startTime: new Date().toISOString(),
      endTime: null,
      librariesProcessed: 0,
      documentsFound: 0,
      documentsProcessed: 0,
      documentsAdded: 0,
      documentsModified: 0,
      documentsDeleted: 0,
      documentsFailed: 0,
      bytesProcessed: 0,
      permissionsSynced: 0, // F4.2.2
      permissionsFailed: 0, // F4.2.2
      errors: [],
    };

    try {
      // Get libraries to sync
      const libraries = await this.listDocumentLibraries();
      result.librariesProcessed = libraries.length;

      // Sync each library
      for (const library of libraries) {
        try {
          const libraryResult = await this._syncLibrary(library, {
            fullSync,
            onDocument,
            onProgress,
            syncId,
          });

          result.documentsFound += libraryResult.documentsFound;
          result.documentsProcessed += libraryResult.documentsProcessed;
          result.documentsAdded += libraryResult.documentsAdded;
          result.documentsModified += libraryResult.documentsModified;
          result.documentsDeleted += libraryResult.documentsDeleted;
          result.documentsFailed += libraryResult.documentsFailed;
          result.bytesProcessed += libraryResult.bytesProcessed;
          result.permissionsSynced += libraryResult.permissionsSynced; // F4.2.2
          result.permissionsFailed += libraryResult.permissionsFailed; // F4.2.2
          result.errors.push(...libraryResult.errors);

          if (onProgress) {
            onProgress({
              type: 'library_complete',
              library: library.name,
              documentsProcessed: libraryResult.documentsProcessed,
            });
          }

        } catch (libraryError) {
          log.error({
            error: libraryError.message,
            libraryId: library.id,
            libraryName: library.name,
          }, 'Failed to sync library');

          result.errors.push({
            libraryId: library.id,
            libraryName: library.name,
            error: libraryError.message,
          });
        }
      }

      result.endTime = new Date().toISOString();

      // Determine sync status
      const status = result.errors.length > 0
        ? (result.documentsProcessed > 0 ? SyncStatus.PARTIAL : SyncStatus.FAILURE)
        : SyncStatus.SUCCESS;

      // Track sync completion
      if (this.healthService) {
        this.healthService.trackSyncComplete(this.connectorId, {
          status,
          documentsProcessed: result.documentsProcessed,
          documentsFailed: result.documentsFailed,
          bytesProcessed: result.bytesProcessed,
          errors: result.errors,
        });
      }

      log.info({
        connectorId: this.connectorId,
        syncId,
        documentsProcessed: result.documentsProcessed,
        status,
      }, 'SharePoint sync completed');

      trackEvent('sharepoint_sync_completed', {
        connectorId: this.connectorId,
        syncType,
        documentsProcessed: result.documentsProcessed,
        status,
      });

      trackMetric('sharepoint.sync.documents', result.documentsProcessed, {
        connectorId: this.connectorId,
        syncType,
      });

      return result;

    } catch (error) {
      result.endTime = new Date().toISOString();
      result.errors.push({ error: error.message });

      if (this.healthService) {
        this.healthService.trackSyncComplete(this.connectorId, {
          status: SyncStatus.FAILURE,
          documentsProcessed: result.documentsProcessed,
          documentsFailed: result.documentsFailed,
          errors: result.errors,
        });
      }

      log.error({
        error: error.message,
        connectorId: this.connectorId,
        syncId,
      }, 'SharePoint sync failed');

      throw error;
    }
  }

  /**
   * Sync a single document library using delta queries
   * @private
   */
  async _syncLibrary(library, options) {
    const { fullSync, onDocument, onProgress, syncId } = options;
    const driveId = library.id;

    const result = {
      libraryId: driveId,
      libraryName: library.name,
      documentsFound: 0,
      documentsProcessed: 0,
      documentsAdded: 0,
      documentsModified: 0,
      documentsDeleted: 0,
      documentsFailed: 0,
      bytesProcessed: 0,
      permissionsSynced: 0, // F4.2.2
      permissionsFailed: 0, // F4.2.2
      errors: [],
    };

    // Get or create delta state for this drive
    let deltaState = this.deltaStates.get(driveId);
    if (!deltaState || fullSync) {
      deltaState = new SharePointDeltaState(driveId);
      this.deltaStates.set(driveId, deltaState);
    }

    try {
      // Build delta query URL
      let deltaUrl = deltaState.deltaLink;
      if (!deltaUrl) {
        // Fresh sync - start from root
        deltaUrl = `/drives/${driveId}/root/delta`;
      }

      // Process all pages
      let pageCount = 0;
      while (deltaUrl) {
        const response = await this._executeDeltaQuery(deltaUrl);
        pageCount++;

        for (const item of response.value || []) {
          result.documentsFound++;

          // Check if item was deleted
          if (item.deleted) {
            result.documentsDeleted++;
            if (onDocument) {
              await onDocument({
                type: 'deleted',
                id: item.id,
                driveId,
                name: item.name,
              });
            }
            continue;
          }

          // Skip folders
          if (item.folder) {
            continue;
          }

          // Skip unsupported file types
          const doc = new SharePointDocument(item, driveId, this.siteId);
          if (!this._shouldIncludeFile(doc)) {
            continue;
          }

          try {
            // Determine if this is new or modified
            const isNew = deltaState.isFreshSync() ||
              new Date(item.createdDateTime) > new Date(deltaState.lastSyncTime || 0);

            if (isNew) {
              result.documentsAdded++;
            } else {
              result.documentsModified++;
            }

            // F4.2.2: Fetch and sync permissions if enabled
            if (this.config.syncPermissions) {
              try {
                const rawPermissions = await this.getRawPermissions(driveId, item.id);
                doc.setPermissions(rawPermissions, {
                  includeInherited: this.config.includeInheritedPermissions,
                  rolesToInclude: this.config.permissionRolesToSync,
                });

                result.permissionsSynced++;
                trackMetric('sharepoint.permissions.synced', doc.allowedGroups.length, {
                  connectorId: this.connectorId,
                  documentId: item.id,
                });
              } catch (permError) {
                // Log but don't fail the document sync
                result.permissionsFailed++;
                log.warn({
                  error: permError.message,
                  documentId: item.id,
                  name: item.name,
                }, 'Failed to sync document permissions');
                // Document will have empty allowedGroups, which may be intentional
                // for public documents
              }
            }

            // Invoke document callback
            if (onDocument) {
              await onDocument({
                type: isNew ? 'added' : 'modified',
                document: doc,
                metadata: doc.toDocumentMetadata(),
              });
            }

            result.documentsProcessed++;
            result.bytesProcessed += doc.size;

          } catch (docError) {
            result.documentsFailed++;
            result.errors.push({
              documentId: item.id,
              name: item.name,
              error: docError.message,
            });

            log.warn({
              error: docError.message,
              documentId: item.id,
              name: item.name,
            }, 'Failed to process document');
          }
        }

        // Report progress
        if (onProgress) {
          onProgress({
            type: 'page_complete',
            library: library.name,
            pageNumber: pageCount,
            documentsInPage: response.value?.length || 0,
            totalProcessed: result.documentsProcessed,
          });
        }

        // Get next page or delta link
        if (response['@odata.nextLink']) {
          deltaUrl = response['@odata.nextLink'];
        } else if (response['@odata.deltaLink']) {
          deltaState.update(
            response['@odata.deltaLink'],
            result.documentsProcessed,
            result.documentsDeleted
          );
          deltaUrl = null;
        } else {
          deltaUrl = null;
        }
      }

      return result;

    } catch (error) {
      log.error({
        error: error.message,
        libraryId: driveId,
        libraryName: library.name,
      }, 'Delta sync failed');
      throw error;
    }
  }

  /**
   * Execute a delta query with proper error handling
   * @private
   */
  async _executeDeltaQuery(url) {
    try {
      // Handle both full URLs (from nextLink) and paths
      if (url.startsWith('https://')) {
        // Extract the path from full URL
        const urlObj = new URL(url);
        url = urlObj.pathname + urlObj.search;
      }

      return await this.graphClient
        .api(url)
        .top(this.config.pageSize)
        .get();

    } catch (error) {
      // Handle specific errors
      if (error.statusCode === 410) {
        // Delta token expired - need full resync
        log.warn({ url }, 'Delta token expired, will need full resync');
        throw new Error('Delta token expired');
      }
      throw error;
    }
  }

  /**
   * Check if a file should be included based on configuration
   * @private
   */
  _shouldIncludeFile(doc) {
    // Check file type
    const ext = '.' + (doc.name || '').split('.').pop().toLowerCase();
    if (this.config.fileTypes.length > 0 && !this.config.fileTypes.includes(ext)) {
      return false;
    }

    // Check excluded folders
    const path = doc.path.toLowerCase();
    for (const excluded of this.config.excludedFolders) {
      if (path.includes(excluded.toLowerCase())) {
        return false;
      }
    }

    // Check included folders (if specified)
    if (this.config.includedFolders.length > 0) {
      let included = false;
      for (const includedFolder of this.config.includedFolders) {
        if (path.includes(includedFolder.toLowerCase())) {
          included = true;
          break;
        }
      }
      if (!included) {
        return false;
      }
    }

    return true;
  }

  /**
   * Download document content
   * @param {string} driveId - Drive ID
   * @param {string} itemId - Item ID
   * @returns {Promise<Buffer>} Document content
   */
  async downloadContent(driveId, itemId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const response = await this.graphClient
        .api(`/drives/${driveId}/items/${itemId}/content`)
        .getStream();

      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of response) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);

      trackMetric('sharepoint.download.bytes', buffer.length, {
        connectorId: this.connectorId,
        driveId,
      });

      return buffer;

    } catch (error) {
      log.error({
        error: error.message,
        driveId,
        itemId,
      }, 'Failed to download document content');

      if (this.healthService) {
        this.healthService.trackSyncError(this.connectorId, {
          type: 'download_failed',
          message: error.message,
          context: { driveId, itemId },
        });
      }

      throw error;
    }
  }

  /**
   * Get document permissions
   * @param {string} driveId - Drive ID
   * @param {string} itemId - Item ID
   * @returns {Promise<Object[]>} List of permissions
   */
  async getPermissions(driveId, itemId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const response = await this.graphClient
        .api(`/drives/${driveId}/items/${itemId}/permissions`)
        .get();

      return (response.value || []).map(perm => ({
        id: perm.id,
        type: perm.roles?.join(',') || 'unknown',
        grantedTo: perm.grantedTo?.user?.displayName || perm.grantedToV2?.user?.displayName,
        grantedToEmail: perm.grantedTo?.user?.email || perm.grantedToV2?.user?.email,
        shareId: perm.shareId,
        inheritedFrom: perm.inheritedFrom?.path,
        link: perm.link ? {
          type: perm.link.type,
          scope: perm.link.scope,
        } : null,
      }));

    } catch (error) {
      log.warn({
        error: error.message,
        driveId,
        itemId,
      }, 'Failed to get document permissions');
      return [];
    }
  }

  /**
   * Get raw document permissions for security trimming (F4.2.2)
   * Returns unprocessed Graph API permissions for use with SharePointDocument.setPermissions
   * @param {string} driveId - Drive ID
   * @param {string} itemId - Item ID
   * @returns {Promise<Object[]>} Raw permissions from Graph API
   * @throws {Error} If permission fetch fails (for tracking in sync results)
   */
  async getRawPermissions(driveId, itemId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const response = await this.graphClient
      .api(`/drives/${driveId}/items/${itemId}/permissions`)
      .get();

    return response.value || [];
  }

  /**
   * Get delta state for a drive (for persistence)
   * @param {string} driveId - Drive ID
   * @returns {SharePointDeltaState|null}
   */
  getDeltaState(driveId) {
    return this.deltaStates.get(driveId) || null;
  }

  /**
   * Set delta state for a drive (for recovery)
   * @param {string} driveId - Drive ID
   * @param {Object} state - Delta state
   */
  setDeltaState(driveId, state) {
    const deltaState = new SharePointDeltaState(driveId, state.deltaLink);
    deltaState.lastSyncTime = state.lastSyncTime;
    deltaState.syncedItemCount = state.syncedItemCount || 0;
    deltaState.deletedItemCount = state.deletedItemCount || 0;
    this.deltaStates.set(driveId, deltaState);
  }

  /**
   * Get all delta states for persistence
   * @returns {Object} Map of driveId -> delta state
   */
  getAllDeltaStates() {
    const states = {};
    for (const [driveId, state] of this.deltaStates) {
      states[driveId] = {
        driveId: state.driveId,
        deltaLink: state.deltaLink,
        lastSyncTime: state.lastSyncTime,
        syncedItemCount: state.syncedItemCount,
        deletedItemCount: state.deletedItemCount,
      };
    }
    return states;
  }

  /**
   * Get connector status
   * @returns {Object}
   */
  getStatus() {
    return {
      connectorId: this.connectorId,
      connectorType: CONNECTOR_TYPE,
      isInitialized: this.isInitialized,
      siteId: this.siteId,
      siteName: this.siteName,
      siteUrl: this.config.siteUrl,
      sitePath: this.config.sitePath,
      libraryFilter: this.config.libraryNames,
      fileTypesFilter: this.config.fileTypes,
      deltaStatesCount: this.deltaStates.size,
    };
  }

  /**
   * Cleanup and disconnect
   */
  async disconnect() {
    log.info({ connectorId: this.connectorId }, 'Disconnecting SharePoint connector');

    if (this.healthService) {
      this.healthService.setConnectorEnabled(this.connectorId, false);
    }

    this.graphClient = null;
    this.credential = null;
    this.isInitialized = false;

    trackEvent('sharepoint_connector_disconnected', {
      connectorId: this.connectorId,
    });
  }
}

/**
 * Create a SharePoint connector instance
 * @param {Object} config - Configuration options
 * @returns {SharePointConnector}
 */
function createSharePointConnector(config = {}) {
  return new SharePointConnector(config);
}

module.exports = {
  SharePointConnector,
  SharePointConnectionConfig,
  SharePointDocument,
  SharePointDeltaState,
  createSharePointConnector,
  SUPPORTED_FILE_TYPES,
  CONNECTOR_TYPE,
};
