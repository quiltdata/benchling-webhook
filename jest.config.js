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
  cacheDirectory: '<rootDir>/.jest-cache'
};
