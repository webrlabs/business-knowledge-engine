/**
 * MSAL Service for Azure AD Token Acquisition
 *
 * Provides token acquisition for:
 * - Client Credentials Flow (app-to-app authentication)
 * - On-Behalf-Of Flow (delegated user authentication for downstream APIs)
 *
 * Environment Variables:
 *   AZURE_AD_TENANT_ID - Azure AD tenant ID
 *   AZURE_AD_CLIENT_ID - Application (client) ID
 *   AZURE_AD_CLIENT_SECRET - Client secret (for confidential client)
 */

const msal = require('@azure/msal-node');
const { log } = require('../utils/logger');

// Configuration
const tenantId = process.env.AZURE_AD_TENANT_ID;
const clientId = process.env.AZURE_AD_CLIENT_ID;
const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;

// MSAL configuration
const msalConfig = {
  auth: {
    clientId: clientId || '',
    authority: `https://login.microsoftonline.com/${tenantId || 'common'}`,
    clientSecret: clientSecret,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case msal.LogLevel.Error:
            log.error('MSAL Error', { message });
            break;
          case msal.LogLevel.Warning:
            log.warn('MSAL Warning', { message });
            break;
          case msal.LogLevel.Info:
            log.debug('MSAL Info', { message });
            break;
          case msal.LogLevel.Verbose:
            log.debug('MSAL Verbose', { message });
            break;
        }
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Warning,
    },
  },
};

// Singleton confidential client application
let confidentialClient = null;

/**
 * Get or create the MSAL confidential client application
 * @returns {msal.ConfidentialClientApplication|null}
 */
function getConfidentialClient() {
  if (!tenantId || !clientId) {
    log.warn('MSAL not configured - missing tenant ID or client ID');
    return null;
  }

  if (!confidentialClient) {
    confidentialClient = new msal.ConfidentialClientApplication(msalConfig);
    log.info('MSAL ConfidentialClientApplication initialized');
  }

  return confidentialClient;
}

/**
 * Acquire token using Client Credentials Flow
 * Use this for app-to-app authentication (service-to-service)
 *
 * @param {string[]} scopes - The scopes to request (e.g., ['https://graph.microsoft.com/.default'])
 * @returns {Promise<string|null>} - Access token or null if failed
 */
async function acquireTokenClientCredentials(scopes) {
  const client = getConfidentialClient();
  if (!client) {
    return null;
  }

  if (!clientSecret) {
    log.error('Cannot acquire token - client secret not configured');
    return null;
  }

  try {
    const result = await client.acquireTokenByClientCredential({
      scopes,
    });

    if (result && result.accessToken) {
      log.debug('Token acquired via client credentials', {
        scopes,
        expiresOn: result.expiresOn,
      });
      return result.accessToken;
    }

    log.warn('No access token in client credentials response');
    return null;
  } catch (error) {
    log.error('Failed to acquire token via client credentials', {
      error: error.message,
      scopes,
    });
    return null;
  }
}

/**
 * Acquire token using On-Behalf-Of Flow
 * Use this when you need to call a downstream API on behalf of the user
 *
 * @param {string} userAccessToken - The user's access token from the incoming request
 * @param {string[]} scopes - The scopes for the downstream API
 * @returns {Promise<string|null>} - Access token for downstream API or null if failed
 */
async function acquireTokenOnBehalfOf(userAccessToken, scopes) {
  const client = getConfidentialClient();
  if (!client) {
    return null;
  }

  if (!clientSecret) {
    log.error('Cannot acquire OBO token - client secret not configured');
    return null;
  }

  try {
    const result = await client.acquireTokenOnBehalfOf({
      oboAssertion: userAccessToken,
      scopes,
    });

    if (result && result.accessToken) {
      log.debug('Token acquired via OBO flow', {
        scopes,
        expiresOn: result.expiresOn,
      });
      return result.accessToken;
    }

    log.warn('No access token in OBO response');
    return null;
  } catch (error) {
    log.error('Failed to acquire token via OBO', {
      error: error.message,
      scopes,
    });
    return null;
  }
}

/**
 * Get token for Microsoft Graph API
 * @param {string} [userAccessToken] - Optional user token for OBO flow. If not provided, uses client credentials.
 * @returns {Promise<string|null>}
 */
async function getGraphToken(userAccessToken = null) {
  const scopes = ['https://graph.microsoft.com/.default'];

  if (userAccessToken) {
    return acquireTokenOnBehalfOf(userAccessToken, scopes);
  }

  return acquireTokenClientCredentials(scopes);
}

/**
 * Get token for Azure Storage
 * @param {string} [userAccessToken] - Optional user token for OBO flow
 * @returns {Promise<string|null>}
 */
async function getStorageToken(userAccessToken = null) {
  const scopes = ['https://storage.azure.com/.default'];

  if (userAccessToken) {
    return acquireTokenOnBehalfOf(userAccessToken, scopes);
  }

  return acquireTokenClientCredentials(scopes);
}

/**
 * Get token for Azure Cognitive Services (OpenAI, Document Intelligence, etc.)
 * @param {string} [userAccessToken] - Optional user token for OBO flow
 * @returns {Promise<string|null>}
 */
async function getCognitiveServicesToken(userAccessToken = null) {
  const scopes = ['https://cognitiveservices.azure.com/.default'];

  if (userAccessToken) {
    return acquireTokenOnBehalfOf(userAccessToken, scopes);
  }

  return acquireTokenClientCredentials(scopes);
}

/**
 * Check if MSAL is properly configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!(tenantId && clientId);
}

/**
 * Check if client credentials are available
 * @returns {boolean}
 */
function hasClientCredentials() {
  return !!(tenantId && clientId && clientSecret);
}

/**
 * Clear the token cache (useful for testing or forced refresh)
 */
async function clearCache() {
  if (confidentialClient) {
    const cache = confidentialClient.getTokenCache();
    // Get all accounts and remove them
    const accounts = await cache.getAllAccounts();
    for (const account of accounts) {
      await cache.removeAccount(account);
    }
    log.info('MSAL token cache cleared');
  }
}

module.exports = {
  getConfidentialClient,
  acquireTokenClientCredentials,
  acquireTokenOnBehalfOf,
  getGraphToken,
  getStorageToken,
  getCognitiveServicesToken,
  isConfigured,
  hasClientCredentials,
  clearCache,
};
