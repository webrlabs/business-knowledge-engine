const gremlin = require('gremlin');
const { DefaultAzureCredential } = require('@azure/identity');

let cachedClient = null;
let tokenExpiresAt = null;
let usingKeyAuth = false;

function getGremlinConfig() {
  return {
    endpoint: process.env.COSMOS_GREMLIN_ENDPOINT,
    database: process.env.COSMOS_GREMLIN_DATABASE || 'knowledge-graph',
    graph: process.env.COSMOS_GREMLIN_GRAPH || 'entities',
    key: process.env.COSMOS_GREMLIN_KEY || process.env.COSMOS_DB_KEY,
  };
}

async function createGremlinClient() {
  const config = getGremlinConfig();

  if (!config.endpoint) {
    throw new Error('COSMOS_GREMLIN_ENDPOINT is required');
  }

  // Return cached client if using key auth or token is still valid (with 5 min buffer)
  const now = Date.now();
  if (cachedClient && (usingKeyAuth || (tokenExpiresAt && now < tokenExpiresAt - 5 * 60 * 1000))) {
    return cachedClient;
  }

  // Close existing client if any
  if (cachedClient) {
    try {
      await cachedClient.close();
    } catch (e) {
      // Ignore close errors
    }
  }

  let authenticator;

  // Use API key if provided (local dev), otherwise use Azure AD (deployed)
  if (config.key) {
    usingKeyAuth = true;
    authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
      `/dbs/${config.database}/colls/${config.graph}`,
      config.key
    );
  } else {
    usingKeyAuth = false;
    // Get token from DefaultAzureCredential
    const credential = new DefaultAzureCredential();
    const tokenResponse = await credential.getToken('https://cosmos.azure.com/.default');
    tokenExpiresAt = tokenResponse.expiresOnTimestamp;

    authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
      `/dbs/${config.database}/colls/${config.graph}`,
      tokenResponse.token
    );
  }

  cachedClient = new gremlin.driver.Client(config.endpoint, {
    authenticator,
    traversalsource: 'g',
    rejectUnauthorized: true,
    mimeType: 'application/vnd.gremlin-v2.0+json',
  });

  return cachedClient;
}

async function closeGremlinClient() {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    tokenExpiresAt = null;
  }
}

module.exports = {
  createGremlinClient,
  closeGremlinClient,
  getGremlinConfig,
};
