/**
 * Connectors Module
 *
 * Exports all connector implementations for external data sources.
 *
 * @module connectors
 */

const { BaseConnector, ConnectionStatus } = require('./base-connector');
const {
  ADLSGen2Connector,
  AuthenticationType,
  getADLSGen2Connector,
  createADLSGen2Connector,
  resetDefaultConnector,
  DEFAULT_CONFIG: ADLS_DEFAULT_CONFIG,
} = require('./adls-gen2-connector');
const {
  SharePointConnector,
  SharePointConnectionConfig,
  SharePointDocument,
  SharePointDeltaState,
  createSharePointConnector,
  SUPPORTED_FILE_TYPES: SHAREPOINT_SUPPORTED_FILE_TYPES,
  CONNECTOR_TYPE: SHAREPOINT_CONNECTOR_TYPE,
} = require('./sharepoint-connector');

module.exports = {
  // Base connector
  BaseConnector,
  ConnectionStatus,

  // ADLS Gen2 Connector
  ADLSGen2Connector,
  AuthenticationType,
  getADLSGen2Connector,
  createADLSGen2Connector,
  resetDefaultConnector,
  ADLS_DEFAULT_CONFIG,

  // SharePoint Connector
  SharePointConnector,
  SharePointConnectionConfig,
  SharePointDocument,
  SharePointDeltaState,
  createSharePointConnector,
  SHAREPOINT_SUPPORTED_FILE_TYPES,
  SHAREPOINT_CONNECTOR_TYPE,
};
