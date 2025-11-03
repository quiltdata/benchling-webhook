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
  cacheDirectory: '<rootDir>/.jest-cache'
};
