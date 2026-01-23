/**
 * Circuit Breaker Service Tests
 *
 * Tests for the circuit breaker implementation that protects external services
 * from cascade failures.
 */

const {
  CircuitBreakerService,
  getCircuitBreakerService,
  withCircuitBreaker,
  circuitBreaker,
  CIRCUIT_STATES,
  DEFAULT_OPTIONS,
  SERVICE_CONFIGS,
} = require('../circuit-breaker-service');

// Mock the logger and telemetry
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
  trackException: jest.fn(),
}));

describe('CircuitBreakerService', () => {
  let service;

  beforeEach(() => {
    // Create a fresh instance for each test
    service = new CircuitBreakerService();
    // Ensure circuit breakers are enabled
    service.enabled = true;
  });

  afterEach(() => {
    // Shutdown all breakers after each test
    service.shutdown();
  });

  describe('constructor', () => {
    it('should create an enabled service by default', () => {
      const svc = new CircuitBreakerService();
      expect(svc.enabled).toBe(true);
      expect(svc.breakers).toBeInstanceOf(Map);
      expect(svc.breakers.size).toBe(0);
    });

    it('should respect CIRCUIT_BREAKER_ENABLED env var', () => {
      const originalEnv = process.env.CIRCUIT_BREAKER_ENABLED;
      process.env.CIRCUIT_BREAKER_ENABLED = 'false';

      const svc = new CircuitBreakerService();
      expect(svc.enabled).toBe(false);

      process.env.CIRCUIT_BREAKER_ENABLED = originalEnv;
    });
  });

  describe('getBreaker', () => {
    it('should create a new circuit breaker for a service', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const breaker = service.getBreaker('openai', fn);

      expect(breaker).toBeDefined();
      expect(breaker.fire).toBeInstanceOf(Function);
      expect(service.breakers.size).toBe(1);
    });

    it('should return the same breaker for the same key', () => {
      const fn = jest.fn().mockResolvedValue('result');
      const breaker1 = service.getBreaker('openai', fn);
      const breaker2 = service.getBreaker('openai', fn);

      expect(breaker1).toBe(breaker2);
      expect(service.breakers.size).toBe(1);
    });

    it('should use service-specific configuration', () => {
      const fn = jest.fn().mockResolvedValue('result');
      const breaker = service.getBreaker('openai', fn);

      // OpenAI has a longer timeout (60s by default)
      expect(breaker.options.timeout).toBe(SERVICE_CONFIGS.openai.timeout);
    });

    it('should merge custom options', () => {
      const fn = jest.fn().mockResolvedValue('result');
      const customOptions = { timeout: 5000 };
      const breaker = service.getBreaker('openai', fn, customOptions);

      expect(breaker.options.timeout).toBe(5000);
    });

    it('should return pass-through when disabled', async () => {
      service.enabled = false;
      const fn = jest.fn().mockResolvedValue('result');
      const breaker = service.getBreaker('openai', fn);

      const result = await breaker.fire();
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('wrap', () => {
    it('should wrap a function with circuit breaker', async () => {
      const fn = jest.fn().mockResolvedValue('wrapped result');
      const wrapped = service.wrap('search', fn);

      const result = await wrapped();
      expect(result).toBe('wrapped result');
    });

    it('should handle failures and track stats', async () => {
      const error = new Error('Service unavailable');
      const fn = jest.fn().mockRejectedValue(error);
      const wrapped = service.wrap('search', fn, { volumeThreshold: 1 });

      await expect(wrapped()).rejects.toThrow('Service unavailable');
    });
  });

  describe('execute', () => {
    it('should execute a function through circuit breaker', async () => {
      const fn = jest.fn().mockResolvedValue('executed');
      const result = await service.execute('cosmos', fn);

      expect(result).toBe('executed');
    });

    it('should pass arguments to the function', async () => {
      const fn = jest.fn().mockImplementation((a, b) => Promise.resolve(a + b));
      const result = await service.execute('cosmos', fn, [1, 2]);

      expect(result).toBe(3);
      expect(fn).toHaveBeenCalledWith(1, 2);
    });
  });

  describe('circuit breaker states', () => {
    it('should start in closed state', () => {
      const fn = jest.fn().mockResolvedValue('result');
      const breaker = service.getBreaker('test', fn);

      expect(breaker.closed).toBe(true);
      expect(breaker.opened).toBe(false);
    });

    it('should open circuit after failures exceed threshold', async () => {
      const error = new Error('Service failed');
      const fn = jest.fn().mockRejectedValue(error);
      const breaker = service.getBreaker('test', fn, {
        volumeThreshold: 1,
        errorThresholdPercentage: 50,
        rollingCountBuckets: 1,
        rollingCountTimeout: 100,
      });

      // Trigger failures to open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.fire();
        } catch (e) {
          // Expected failures
        }
      }

      // After enough failures, circuit should open
      expect(breaker.opened).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return status of all breakers', () => {
      const fn1 = jest.fn().mockResolvedValue('result1');
      const fn2 = jest.fn().mockResolvedValue('result2');

      service.getBreaker('openai', fn1);
      service.getBreaker('search', fn2);

      const status = service.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.summary.total).toBe(2);
      expect(status.summary.closed).toBe(2);
      expect(status.summary.open).toBe(0);
      expect(Object.keys(status.breakers).length).toBe(2);
    });

    it('should include stats for each breaker', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const breaker = service.getBreaker('test', fn);

      await breaker.fire();

      const status = service.getStatus();
      const breakerStatus = Object.values(status.breakers)[0];

      expect(breakerStatus.stats.fires).toBe(1);
      expect(breakerStatus.stats.successes).toBe(1);
      expect(breakerStatus.state).toBe(CIRCUIT_STATES.CLOSED);
    });
  });

  describe('getServiceStatus', () => {
    it('should return status for a specific service', () => {
      const fn1 = jest.fn().mockResolvedValue('result1');
      const fn2 = jest.fn().mockResolvedValue('result2');

      // Use named functions to ensure different keys
      const chatFn = async () => fn1();
      Object.defineProperty(chatFn, 'name', { value: 'chat' });
      const embedFn = async () => fn2();
      Object.defineProperty(embedFn, 'name', { value: 'embed' });
      const searchFn = async () => fn1();
      Object.defineProperty(searchFn, 'name', { value: 'search' });

      service.getBreaker('openai', chatFn);
      service.getBreaker('openai', embedFn);
      service.getBreaker('search', searchFn);

      const status = service.getServiceStatus('openai');

      expect(status).toBeDefined();
      expect(status.service).toBe('openai');
      expect(status.breakers.length).toBe(2);
    });

    it('should return null for unknown service', () => {
      const status = service.getServiceStatus('unknown');
      expect(status).toBeNull();
    });
  });

  describe('hasOpenCircuit', () => {
    it('should return false when no circuits are open', () => {
      const fn = jest.fn().mockResolvedValue('result');
      service.getBreaker('test', fn);

      expect(service.hasOpenCircuit()).toBe(false);
    });
  });

  describe('getOpenCircuits', () => {
    it('should return empty array when no circuits are open', () => {
      const fn = jest.fn().mockResolvedValue('result');
      service.getBreaker('test', fn);

      const open = service.getOpenCircuits();
      expect(open).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should reset a specific circuit breaker', () => {
      // Use a named function so we know the key
      const testFn = async () => 'result';
      Object.defineProperty(testFn, 'name', { value: 'testOp' });

      const breaker = service.getBreaker('testService', testFn);
      const key = 'testService:testOp';

      // Manually open it
      breaker.open();
      expect(breaker.opened).toBe(true);

      // Reset it
      const result = service.reset(key);
      expect(result).toBe(true);
      expect(breaker.closed).toBe(true);
    });

    it('should return false for unknown breaker', () => {
      const result = service.reset('unknown:key');
      expect(result).toBe(false);
    });
  });

  describe('resetAll', () => {
    it('should reset all circuit breakers', () => {
      const fn1 = jest.fn().mockResolvedValue('result1');
      const fn2 = jest.fn().mockResolvedValue('result2');

      const breaker1 = service.getBreaker('test1', fn1);
      const breaker2 = service.getBreaker('test2', fn2);

      // Open both
      breaker1.open();
      breaker2.open();

      service.resetAll();

      expect(breaker1.closed).toBe(true);
      expect(breaker2.closed).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown all circuit breakers', () => {
      const fn = jest.fn().mockResolvedValue('result');
      service.getBreaker('test', fn);

      expect(service.breakers.size).toBe(1);

      service.shutdown();

      expect(service.breakers.size).toBe(0);
    });
  });
});

describe('getCircuitBreakerService', () => {
  it('should return singleton instance', () => {
    const instance1 = getCircuitBreakerService();
    const instance2 = getCircuitBreakerService();

    expect(instance1).toBe(instance2);
  });
});

describe('withCircuitBreaker', () => {
  it('should wrap a function with circuit breaker', async () => {
    const fn = jest.fn().mockResolvedValue('helper result');
    const wrapped = withCircuitBreaker('test', fn);

    const result = await wrapped();
    expect(result).toBe('helper result');
  });
});

describe('circuitBreaker decorator', () => {
  it('should wrap a method with circuit breaker', async () => {
    // Use a unique service name to avoid singleton cache issues
    const method = jest.fn().mockResolvedValue('method result');
    const uniqueName = 'decoratorTest' + Date.now();
    const wrapped = circuitBreaker(uniqueName, method);

    const result = await wrapped();
    expect(result).toBe('method result');
    expect(method).toHaveBeenCalled();
  });

  it('should expose breaker for fallback registration', () => {
    const method = jest.fn().mockResolvedValue('result');
    const wrapped = circuitBreaker('test', method);

    expect(wrapped.breaker).toBeDefined();
    expect(wrapped.fallback).toBeInstanceOf(Function);
  });

  it('should allow registering fallback', async () => {
    const error = new Error('Service failed');
    const method = jest.fn().mockRejectedValue(error);
    const fallbackFn = jest.fn().mockReturnValue('fallback value');

    const wrapped = circuitBreaker('testFallback', method, {
      volumeThreshold: 1,
    }).fallback(fallbackFn);

    // First call will fail and trigger fallback
    const result = await wrapped();
    expect(result).toBe('fallback value');
  });
});

describe('CIRCUIT_STATES', () => {
  it('should define all circuit states', () => {
    expect(CIRCUIT_STATES.CLOSED).toBe('closed');
    expect(CIRCUIT_STATES.OPEN).toBe('open');
    expect(CIRCUIT_STATES.HALF_OPEN).toBe('half-open');
  });
});

describe('SERVICE_CONFIGS', () => {
  it('should have configuration for all services', () => {
    expect(SERVICE_CONFIGS.openai).toBeDefined();
    expect(SERVICE_CONFIGS.search).toBeDefined();
    expect(SERVICE_CONFIGS.cosmos).toBeDefined();
    expect(SERVICE_CONFIGS.gremlin).toBeDefined();
    expect(SERVICE_CONFIGS.docIntelligence).toBeDefined();
    expect(SERVICE_CONFIGS.blob).toBeDefined();
  });

  it('should have appropriate timeouts for each service', () => {
    // OpenAI and DocIntelligence should have longer timeouts
    expect(SERVICE_CONFIGS.openai.timeout).toBeGreaterThan(SERVICE_CONFIGS.search.timeout);
    expect(SERVICE_CONFIGS.docIntelligence.timeout).toBeGreaterThan(SERVICE_CONFIGS.search.timeout);
  });
});

describe('DEFAULT_OPTIONS', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_OPTIONS.timeout).toBe(30000);
    expect(DEFAULT_OPTIONS.errorThresholdPercentage).toBe(50);
    expect(DEFAULT_OPTIONS.resetTimeout).toBe(30000);
    expect(DEFAULT_OPTIONS.volumeThreshold).toBe(5);
  });
});
