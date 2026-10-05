module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts', '!**/*.e2e-spec.ts', '!**/test/**'],
  coveragePathIgnorePatterns: [
    'node_modules',
    'test-config',
    'scripts/',
    '.module.ts',
    '.dto.ts',
    '.entity.ts',
    'main.ts',
    '.mock.ts',
    'index.ts',
    'coverage',
    'env.validation',
    'ffd.config',
    'prisma-selects',
  ],
  testEnvironment: 'node',
  maxWorkers: '50%',
  // Default global floor (apps/backend/jest.config.js overrides `global` when using path thresholds).
  coverageThreshold: {
    global: {
      statements: 77,
      branches: 59,
      functions: 78,
      lines: 78,
    },
  },
  // Default cache directory relative to the consumer's rootDir (usually src or app root)
  // cacheDirectory: '<rootDir>/../.jest-cache',
};
