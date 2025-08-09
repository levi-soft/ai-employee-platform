
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'AI Employee Platform',
  testEnvironment: 'node',
  preset: 'ts-jest',
  
  // Root configuration for monorepo
  projects: [
    '<rootDir>/services/*/jest.config.js',
    '<rootDir>/apps/*/jest.config.js',
    '<rootDir>/packages/*/jest.config.js',
    // Integration test project
    {
      displayName: 'Integration Tests',
      testMatch: ['<rootDir>/tests/integration/**/*.test.{ts,tsx}'],
      testEnvironment: 'node',
      preset: 'ts-jest',
      setupFilesAfterEnv: ['<rootDir>/tests/setup/jest-setup.ts'],
      globalSetup: '<rootDir>/tests/setup/global-setup.ts',
      globalTeardown: '<rootDir>/tests/setup/global-teardown.ts',
      testTimeout: 60000, // Longer timeout for integration tests
      moduleNameMapping: {
        '^@ai-platform/shared-types$': '<rootDir>/packages/shared-types/src',
        '^@ai-platform/shared-utils$': '<rootDir>/packages/shared-utils/src',
        '^@ai-platform/ui-components$': '<rootDir>/packages/ui-components/src',
        '^@ai-platform/api-client$': '<rootDir>/packages/api-client/src',
      },
      transform: {
        '^.+\\.(ts|tsx)$': 'ts-jest',
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    },
  ],
  
  // Global setup and teardown
  globalSetup: '<rootDir>/tests/setup/global-setup.ts',
  globalTeardown: '<rootDir>/tests/setup/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest-setup.ts'],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/index.ts',
    '!**/__tests__/**',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/.next/**',
  ],
  
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'json', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  
  // Module resolution
  moduleNameMapping: {
    '^@ai-platform/shared-types$': '<rootDir>/packages/shared-types/src',
    '^@ai-platform/shared-utils$': '<rootDir>/packages/shared-utils/src',
    '^@ai-platform/ui-components$': '<rootDir>/packages/ui-components/src',
    '^@ai-platform/api-client$': '<rootDir>/packages/api-client/src',
  },
  
  // Test patterns
  testMatch: [
    '<rootDir>/tests/**/*.test.{ts,tsx}',
    '<rootDir>/**/src/**/*.test.{ts,tsx}',
    '<rootDir>/**/tests/**/*.test.{ts,tsx}',
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/.next/',
    '<rootDir>/coverage/',
    '<rootDir>/tests/integration/', // Handled by integration test project
    '<rootDir>/tests/performance/', // Handled separately
  ],
  
  // Transform configuration
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // Verbose output
  verbose: true,
  
  // Test timeout
  testTimeout: 10000,
  
  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
