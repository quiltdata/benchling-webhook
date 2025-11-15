module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'node20',
        resolveJsonModule: true
      }
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*)\\.ts$)'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  cacheDirectory: '<rootDir>/.jest-cache',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'bin/**/*.ts',
    'scripts/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/*.test.ts',
    // Exclude interactive CLI commands from coverage (require manual testing)
    '!bin/commands/setup-wizard.ts',
    '!bin/commands/sync-secrets.ts',
    '!bin/commands/deploy.ts',
    // Exclude main entry point (hard to test)
    '!bin/benchling-webhook.ts',
    // Exclude utilities with low integration test coverage
    '!lib/utils/stack-inference.ts',
    '!lib/xdg-config.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 48,
      functions: 63,
      lines: 59,
      statements: 59
    }
  }
};
