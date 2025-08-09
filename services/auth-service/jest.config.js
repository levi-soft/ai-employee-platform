
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'Auth Service',
  testEnvironment: 'node',
  preset: 'ts-jest',
  
  // Root directory for this service
  rootDir: '.',
  
  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/tests/**/*.test.ts',
  ],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/../../tests/setup/jest-setup.ts'],
  
  // Module name mapping for this service
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@ai-platform/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@ai-platform/shared-utils$': '<rootDir>/../../packages/shared-utils/src',
  },
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  
  // Transform configuration
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  
  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  
  // Test timeout
  testTimeout: 10000,
};
