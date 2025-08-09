
import 'jest-extended';

// Extend Jest matchers
import '@testing-library/jest-dom';

// Global test configuration
beforeEach(() => {
  // Reset any global state before each test
  jest.clearAllMocks();
});

afterEach(() => {
  // Cleanup after each test
  jest.resetAllMocks();
});

// Increase test timeout for integration tests
jest.setTimeout(30000);

// Mock console methods in tests to reduce noise
const originalConsole = console;
beforeAll(() => {
  global.console = {
    ...console,
    // Uncomment to disable console output in tests
    // log: jest.fn(),
    // info: jest.fn(),
    // warn: jest.fn(),
    // error: jest.fn(),
  };
});

afterAll(() => {
  global.console = originalConsole;
});

// Global test utilities
global.testUtils = {
  // Add common test utilities here
  generateTestUser: () => ({
    email: `test-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    name: 'Test User',
    role: 'EMPLOYEE' as const,
  }),
  
  generateTestToken: () => 'test-jwt-token',
  
  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
};

// Type declaration for global test utilities
declare global {
  var testUtils: {
    generateTestUser: () => {
      email: string;
      password: string;
      name: string;
      role: 'ADMIN' | 'EMPLOYEE';
    };
    generateTestToken: () => string;
    sleep: (ms: number) => Promise<void>;
  };
}
