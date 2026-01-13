// Jest test setup file
// This file is run before each test file

// Set test environment variables
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise during tests
// Comment these out if you need to debug tests
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Global test timeout
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
  // Add any global cleanup here
});
