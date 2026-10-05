/**
 * Jest config for Stryker mutation testing.
 *
 * Stryker copies files into `.stryker-tmp`, which breaks the relative import
 * `../../packages/jest-config/backend` used in jest.config.js. This file
 * inlines the base config so Stryker's sandbox is self-contained.
 *
 * Keep in sync with ../../packages/jest-config/backend.js — only the base
 * settings are duplicated here; coverage thresholds are irrelevant for
 * mutation testing so they are omitted.
 */

module.exports = {
  // --- Inlined from packages/jest-config/backend.js ---
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".*\\.spec\\.ts$",
  collectCoverageFrom: [
    "**/*.(t|j)s",
    "!**/*.spec.ts",
    "!**/*.e2e-spec.ts",
    "!**/test/**",
  ],
  coveragePathIgnorePatterns: [
    "node_modules",
    "test-config",
    ".module.ts",
    ".dto.ts",
    ".entity.ts",
    "main.ts",
    ".mock.ts",
    "index.ts",
    "coverage",
    "env.validation",
    "ffd.config",
    "prisma-selects",
  ],
  testEnvironment: "node",
  maxWorkers: "50%",

  // --- Backend-specific (from jest.config.js, minus coverage thresholds) ---
  displayName: "backend",
  rootDir: ".",
  roots: ["<rootDir>/src", "<rootDir>/scripts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.stryker.js"],
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  cacheDirectory: "<rootDir>/.jest-cache",
};
