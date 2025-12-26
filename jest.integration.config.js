const base = require('./jest.config');

module.exports = {
  ...base,
  collectCoverage: false,
  collectCoverageFrom: undefined,
  coverageDirectory: undefined,
  coverageReporters: undefined,
  coverageThreshold: undefined,
};
