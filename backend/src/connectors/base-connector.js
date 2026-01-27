/**
 * Base Connector Abstract Class
 *
 * Provides a standardized interface for all external data connectors
 * (SharePoint, ADLS Gen2, Blob Storage, etc.).
 *
 * All connectors should extend this class and implement the required methods.
 *
 * @module connectors/base-connector
 */

const { log } = require('../utils/logger');

/**
 * Connection status enum
 */
const ConnectionStatus = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

/**
 * Document metadata structure returned by connectors
 * @typedef {Object} DocumentMetadata
 * @property {string} id - Unique identifier in the source system
 * @property {string} name - Document name/filename
 * @property {string} path - Full path in the source system
 * @property {string} mimeType - MIME type of the document
 * @property {number} size - File size in bytes
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} modifiedAt - Last modified timestamp
 * @property {string} contentHash - Hash of file content for change detection
 * @property {string} [eTag] - ETag from source system
 * @property {string} [version] - Version identifier
 * @property {Object} [custom] - Connector-specific metadata
 */

/**
 * Document with content
 * @typedef {Object} Document
 * @property {DocumentMetadata} metadata - Document metadata
 * @property {Buffer|string} content - Document content
 * @property {string} [contentType] - Content type header
 */

/**
 * Abstract base class for all connectors
 */
class BaseConnector {
  /**
   * Create a new connector instance
   * @param {string} connectorId - Unique identifier for this connector instance
   * @param {string} connectorType - Type of connector (e.g., 'adls', 'sharepoint')
   * @param {Object} config - Connector configuration
   */
  constructor(connectorId, connectorType, config = {}) {
    if (new.target === BaseConnector) {
      throw new Error('BaseConnector is abstract and cannot be instantiated directly');
    }

    this.connectorId = connectorId;
    this.connectorType = connectorType;
    this.config = config;
    this.connectionStatus = ConnectionStatus.DISCONNECTED;
    this.lastError = null;
    this.isInitialized = false;
    this.initializationTime = null;
  }

  /**
   * Initialize the connector (establish connections, validate credentials, etc.)
   * Must be called before using any other methods.
   * @returns {Promise<void>}
   * @abstract
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Perform a health check on the connector
   * @returns {Promise<{healthy: boolean, message: string, details?: Object}>}
   * @abstract
   */
  async performHealthCheck() {
    throw new Error('performHealthCheck() must be implemented by subclass');
  }

  /**
   * List documents from the data source
   * @param {Object} options - List options
   * @param {string} [options.path] - Path/folder to list from
   * @param {boolean} [options.recursive] - Include subdirectories
   * @param {string[]} [options.extensions] - Filter by file extensions
   * @param {number} [options.limit] - Maximum documents to return
   * @param {string} [options.continuationToken] - Pagination token
   * @returns {Promise<{documents: DocumentMetadata[], continuationToken?: string}>}
   * @abstract
   */
  async listDocuments(options = {}) {
    throw new Error('listDocuments() must be implemented by subclass');
  }

  /**
   * Get a single document with its content
   * @param {string} documentId - Document identifier in the source system
   * @returns {Promise<Document>}
   * @abstract
   */
  async getDocument(documentId) {
    throw new Error('getDocument() must be implemented by subclass');
  }

  /**
   * Get document metadata without content
   * @param {string} documentId - Document identifier
   * @returns {Promise<DocumentMetadata>}
   * @abstract
   */
  async getDocumentMetadata(documentId) {
    throw new Error('getDocumentMetadata() must be implemented by subclass');
  }

  /**
   * Check if a document exists
   * @param {string} documentId - Document identifier
   * @returns {Promise<boolean>}
   */
  async documentExists(documentId) {
    try {
      await this.getDocumentMetadata(documentId);
      return true;
    } catch (error) {
      if (error.code === 'NOT_FOUND' || error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Disconnect from the data source
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.connectionStatus = ConnectionStatus.DISCONNECTED;
    this.isInitialized = false;
    log('info', `Connector ${this.connectorId} disconnected`);
  }

  /**
   * Get connector status information
   * @returns {Object}
   */
  getStatus() {
    return {
      connectorId: this.connectorId,
      connectorType: this.connectorType,
      connectionStatus: this.connectionStatus,
      isInitialized: this.isInitialized,
      initializationTime: this.initializationTime,
      lastError: this.lastError,
    };
  }

  /**
   * Set the connection status and log the change
   * @param {string} status - New connection status
   * @param {string} [message] - Optional status message
   * @protected
   */
  _setConnectionStatus(status, message = null) {
    const previousStatus = this.connectionStatus;
    this.connectionStatus = status;

    if (previousStatus !== status) {
      log('info', `Connector ${this.connectorId} status changed: ${previousStatus} -> ${status}`, {
        message,
      });
    }
  }

  /**
   * Record an error
   * @param {Error} error - The error that occurred
   * @protected
   */
  _recordError(error) {
    this.lastError = {
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    };
    log('error', `Connector ${this.connectorId} error: ${error.message}`, {
      code: error.code,
      stack: error.stack,
    });
  }

  /**
   * Ensure the connector is initialized before performing operations
   * @throws {Error} If connector is not initialized
   * @protected
   */
  _ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error(`Connector ${this.connectorId} is not initialized. Call initialize() first.`);
    }
  }

  /**
   * Validate configuration has required fields
   * @param {string[]} requiredFields - List of required field names
   * @throws {Error} If any required field is missing
   * @protected
   */
  _validateConfig(requiredFields) {
    const missing = requiredFields.filter((field) => !this.config[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
  }
}

module.exports = {
  BaseConnector,
  ConnectionStatus,
};
