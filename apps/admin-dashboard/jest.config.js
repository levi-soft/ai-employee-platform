
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'Admin Dashboard',
  testEnvironment: 'jsdom',
  preset: 'ts-jest',
  
  // Root directory for this app
  rootDir: '.',
  
  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/*.test.{ts,tsx}',
    '<rootDir>/tests/**/*.test.{ts,tsx}',
  ],
  
  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/../../tests/setup/jest-setup.ts',
    '<rootDir>/tests/setup.ts',
  ],
  
  // Module name mapping for Next.js
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@ai-platform/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@ai-platform/shared-utils$': '<rootDir>/../../packages/shared-utils/src',
    '^@ai-platform/ui-components$': '<rootDir>/../../packages/ui-components/src',
    '^@ai-platform/api-client$': '<rootDir>/../../packages/api-client/src',
  },
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
  ],
  
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  
  // Transform configuration
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // Handle static files
  moduleNameMapping: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/../../tests/__mocks__/file-mock.js',
  },
  
  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  
  // Test timeout
  testTimeout: 10000,
};
