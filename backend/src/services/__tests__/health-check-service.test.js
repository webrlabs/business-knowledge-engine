/**
 * Health Check Service Tests (FC.7)
 */

const {
  HealthCheckService,
  getHealthCheckService,
  resetHealthCheckService,
  HealthStatus,
  Dependencies,
} = require('../health-check-service');

// Mock dependencies
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
  trackMetric: jest.fn(),
}));

jest.mock('../../storage/cosmos', () => ({
  getClient: jest.fn(),
}));

jest.mock('../../clients/gremlin', () => ({
  createGremlinClient: jest.fn(),
  getGremlinConfig: jest.fn(),
}));

jest.mock('../../clients', () => ({
  createOpenAIClient: jest.fn(),
  getOpenAIConfig: jest.fn(),
}));

jest.mock('../../clients/search', () => ({
  createSearchClient: jest.fn(),
}));

jest.mock('../../storage/blob', () => ({
  getContainerClient: jest.fn(),
}));

jest.mock('node-fetch', () => jest.fn());

describe('HealthCheckService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    resetHealthCheckService();
    service = new HealthCheckService();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(service.config).toBeDefined();
      expect(service.config.checkTimeoutMs).toBe(10000);
      expect(service.config.cacheTimeMs).toBe(30000);
      expect(service.config.historySize).toBe(100);
    });

    it('should initialize empty cache and history', () => {
      expect(service.cache.size).toBe(0);
      expect(service.history.length).toBe(0);
    });

    it('should not mark startup as complete initially', () => {
      expect(service.startupComplete).toBe(false);
    });
  });

  describe('getLiveness', () => {
    it('should always return ok status', () => {
      const result = service.getLiveness();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('checkCosmosDb', () => {
    it('should return healthy status when Cosmos DB is accessible', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({
          resource: {
            id: 'test-account',
            writableLocations: [{ name: 'East US' }],
            readableLocations: [{ name: 'East US' }],
            consistencyPolicy: { defaultConsistencyLevel: 'Session' },
          },
        }),
      });

      const result = await service.checkCosmosDb(false);

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.latencyMs).toBeDefined();
      expect(result.details.databaseAccountId).toBe('test-account');
    });

    it('should return unhealthy status when Cosmos DB fails', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockRejectedValue(new Error('Connection failed')),
      });

      const result = await service.checkCosmosDb(false);

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.details.error).toBe('Connection failed');
    });

    it('should use cache when useCache is true', async () => {
      // First call - set cache
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({
          resource: { id: 'cached-account' },
        }),
      });

      await service.checkCosmosDb(false);

      // Second call - should use cache
      const cachedResult = await service.checkCosmosDb(true);
      expect(cachedResult.details.databaseAccountId).toBe('cached-account');
      expect(getClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkGremlin', () => {
    it('should return unknown when Gremlin is not configured', async () => {
      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const result = await service.checkGremlin(false);

      expect(result.status).toBe(HealthStatus.UNKNOWN);
      expect(result.details.configured).toBe(false);
    });

    it('should return healthy when Gremlin is accessible', async () => {
      const { createGremlinClient, getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({
        endpoint: 'wss://test.gremlin.cosmos.azure.com:443/',
        database: 'test-db',
        graph: 'test-graph',
      });
      createGremlinClient.mockResolvedValue({
        submit: jest.fn().mockResolvedValue({ _items: [1] }),
      });

      const result = await service.checkGremlin(false);

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.details.database).toBe('test-db');
    });

    it('should return unhealthy when Gremlin fails', async () => {
      const { createGremlinClient, getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({
        endpoint: 'wss://test.gremlin.cosmos.azure.com:443/',
      });
      createGremlinClient.mockRejectedValue(new Error('Connection refused'));

      const result = await service.checkGremlin(false);

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.details.error).toBe('Connection refused');
    });
  });

  describe('checkOpenAI', () => {
    it('should return unknown when OpenAI is not configured', async () => {
      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      const result = await service.checkOpenAI(false);

      expect(result.status).toBe(HealthStatus.UNKNOWN);
      expect(result.details.configured).toBe(false);
    });

    it('should return healthy when OpenAI is accessible', async () => {
      const { createOpenAIClient, getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({
        endpoint: 'https://test.openai.azure.com/',
        deploymentName: 'gpt-4',
      });
      createOpenAIClient.mockReturnValue({
        models: {
          list: jest.fn().mockResolvedValue({ data: [] }),
        },
      });

      const result = await service.checkOpenAI(false);

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.details.deploymentName).toBe('gpt-4');
    });

    it('should return degraded when circuit breaker is open', async () => {
      const { createOpenAIClient, getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({
        endpoint: 'https://test.openai.azure.com/',
      });
      createOpenAIClient.mockReturnValue({
        models: {
          list: jest.fn().mockRejectedValue(new Error('circuit breaker is open')),
        },
      });

      const result = await service.checkOpenAI(false);

      expect(result.status).toBe(HealthStatus.DEGRADED);
    });
  });

  describe('checkAzureSearch', () => {
    beforeEach(() => {
      process.env.AZURE_SEARCH_ENDPOINT = 'https://test.search.windows.net';
      process.env.AZURE_SEARCH_INDEX_NAME = 'test-index';
    });

    afterEach(() => {
      delete process.env.AZURE_SEARCH_ENDPOINT;
      delete process.env.AZURE_SEARCH_INDEX_NAME;
    });

    it('should return unknown when Azure Search is not configured', async () => {
      delete process.env.AZURE_SEARCH_ENDPOINT;

      const result = await service.checkAzureSearch(false);

      expect(result.status).toBe(HealthStatus.UNKNOWN);
      expect(result.details.configured).toBe(false);
    });

    it('should return healthy when Azure Search is accessible', async () => {
      const { createSearchClient } = require('../../clients/search');
      createSearchClient.mockReturnValue({
        search: jest.fn().mockResolvedValue({
          results: (async function* () {})(),
        }),
      });

      const result = await service.checkAzureSearch(false);

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.details.indexName).toBe('test-index');
    });
  });

  describe('checkBlobStorage', () => {
    beforeEach(() => {
      process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
    });

    afterEach(() => {
      delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
      delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    });

    it('should return unknown when Blob Storage is not configured', async () => {
      delete process.env.AZURE_STORAGE_ACCOUNT_NAME;

      const result = await service.checkBlobStorage(false);

      expect(result.status).toBe(HealthStatus.UNKNOWN);
      expect(result.details.configured).toBe(false);
    });

    it('should return healthy when Blob Storage is accessible', async () => {
      const { getContainerClient } = require('../../storage/blob');
      getContainerClient.mockResolvedValue({
        exists: jest.fn().mockResolvedValue(true),
      });

      const result = await service.checkBlobStorage(false);

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.details.containerExists).toBe(true);
    });

    it('should return degraded when container does not exist', async () => {
      const { getContainerClient } = require('../../storage/blob');
      getContainerClient.mockResolvedValue({
        exists: jest.fn().mockResolvedValue(false),
      });

      const result = await service.checkBlobStorage(false);

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.details.containerExists).toBe(false);
    });
  });

  describe('checkDocIntelligence', () => {
    beforeEach(() => {
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = 'https://test.cognitiveservices.azure.com';
    });

    afterEach(() => {
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    });

    it('should return unknown when Doc Intelligence is not configured', async () => {
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;

      const result = await service.checkDocIntelligence(false);

      expect(result.status).toBe(HealthStatus.UNKNOWN);
      expect(result.details.configured).toBe(false);
    });

    it('should return healthy when Doc Intelligence is accessible', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({ status: 200 });

      const result = await service.checkDocIntelligence(false);

      expect(result.status).toBe(HealthStatus.HEALTHY);
    });

    it('should return healthy when Doc Intelligence returns 401 (reachable but auth issue)', async () => {
      const fetch = require('node-fetch');
      fetch.mockResolvedValue({ status: 401 });

      const result = await service.checkDocIntelligence(false);

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.details.httpStatus).toBe(401);
    });
  });

  describe('checkAll', () => {
    it('should check all dependencies in parallel', async () => {
      // Mock all dependencies as healthy
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      const result = await service.checkAll(false);

      expect(result.status).toBeDefined();
      expect(result.dependencies).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.totalLatencyMs).toBeDefined();
    });

    it('should return unhealthy when critical dependency fails', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockRejectedValue(new Error('Failed')),
      });

      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      const result = await service.checkAll(false);

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
    });

    it('should add result to history', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      await service.checkAll(false);

      expect(service.history.length).toBe(1);
    });
  });

  describe('getReadiness', () => {
    it('should return not ready when startup is not complete', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      service.startupComplete = false;

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);
    });

    it('should return ready when startup is complete and critical deps healthy', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      service.startupComplete = true;

      const result = await service.getReadiness();

      expect(result.ready).toBe(true);
    });
  });

  describe('performStartupValidation', () => {
    it('should mark startup complete when critical deps are healthy', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      const result = await service.performStartupValidation();

      expect(result.success).toBe(true);
      expect(service.startupComplete).toBe(true);
    });

    it('should fail startup when critical deps are unhealthy', async () => {
      service.config.startupRetries = 1;
      service.config.startupRetryDelayMs = 10;

      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockRejectedValue(new Error('Failed')),
      });

      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      const result = await service.performStartupValidation();

      expect(result.success).toBe(false);
      expect(service.startupComplete).toBe(false);
    });
  });

  describe('listeners', () => {
    it('should notify listeners when status changes', async () => {
      const listener = jest.fn();
      service.addListener(listener);

      // First call - set to healthy
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      await service.checkCosmosDb(false);

      // Change to unhealthy
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockRejectedValue(new Error('Failed')),
      });

      await service.checkCosmosDb(false);

      expect(listener).toHaveBeenCalledWith(
        Dependencies.COSMOS_DB,
        HealthStatus.HEALTHY,
        HealthStatus.UNHEALTHY
      );
    });

    it('should remove listeners', async () => {
      const listener = jest.fn();
      service.addListener(listener);
      service.removeListener(listener);

      expect(service.listeners.has(listener)).toBe(false);
    });
  });

  describe('history', () => {
    it('should limit history size', async () => {
      service.config.historySize = 3;

      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      // Add 5 entries
      for (let i = 0; i < 5; i++) {
        await service.checkAll(false);
      }

      expect(service.history.length).toBe(3);
    });

    it('should return limited history with getHistory', async () => {
      const { getClient } = require('../../storage/cosmos');
      getClient.mockReturnValue({
        getDatabaseAccount: jest.fn().mockResolvedValue({ resource: {} }),
      });

      const { getGremlinConfig } = require('../../clients/gremlin');
      getGremlinConfig.mockReturnValue({ endpoint: null });

      const { getOpenAIConfig } = require('../../clients');
      getOpenAIConfig.mockReturnValue({ endpoint: null, apiKey: null });

      // Add 5 entries
      for (let i = 0; i < 5; i++) {
        await service.checkAll(false);
      }

      const history = service.getHistory(2);
      expect(history.length).toBe(2);
    });
  });

  describe('cache management', () => {
    it('should clear all cache', () => {
      service.cache.set('test', { status: 'healthy' });
      service.clearCache();
      expect(service.cache.size).toBe(0);
    });

    it('should clear specific dependency cache', () => {
      service.cache.set(Dependencies.COSMOS_DB, { status: 'healthy' });
      service.cache.set(Dependencies.GREMLIN, { status: 'healthy' });

      service.clearCache(Dependencies.COSMOS_DB);

      expect(service.cache.has(Dependencies.COSMOS_DB)).toBe(false);
      expect(service.cache.has(Dependencies.GREMLIN)).toBe(true);
    });

    it('should return cache stats', () => {
      service.cache.set(Dependencies.COSMOS_DB, {
        status: HealthStatus.HEALTHY,
        timestamp: Date.now(),
      });

      const stats = service.getCacheStats();

      expect(stats.size).toBe(1);
      expect(stats.entries.length).toBe(1);
      expect(stats.entries[0].dependency).toBe(Dependencies.COSMOS_DB);
    });
  });

  describe('configuration', () => {
    it('should return current configuration', () => {
      const config = service.getConfig();
      expect(config.checkTimeoutMs).toBeDefined();
      expect(config.cacheTimeMs).toBeDefined();
    });

    it('should update configuration', () => {
      service.updateConfig({ checkTimeoutMs: 5000 });
      expect(service.config.checkTimeoutMs).toBe(5000);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getHealthCheckService();
      const instance2 = getHealthCheckService();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getHealthCheckService();
      resetHealthCheckService();
      const instance2 = getHealthCheckService();
      expect(instance1).not.toBe(instance2);
    });
  });
});
