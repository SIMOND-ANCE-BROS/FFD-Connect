const path = require("path");
const baseConfig = require("../../packages/jest-config/backend");

/** Directory prefix for Jest PATH thresholds (aggregates coverage under that folder). */
const srcDir = (...parts) => path.join(__dirname, "src", ...parts) + path.sep;

module.exports = {
  ...baseConfig,
  displayName: "backend",
  rootDir: ".",
  roots: ["<rootDir>/src", "<rootDir>/scripts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  cacheDirectory: "<rootDir>/.jest-cache",
  // Path thresholds aggregate per folder. Files matched below are excluded from `global`, so the global
  // floor applies only to the rest of `src/` (typically larger domain services).
  coverageThreshold: {
    ...baseConfig.coverageThreshold,
    global: {
      statements: 58,
      branches: 52,
      functions: 65,
      lines: 57,
    },
    [srcDir("prisma")]: {
      statements: 96,
      // TS emitDecoratorMetadata emits `typeof ConfigService !== "undefined" && ...`
      // in the __decorate call — Istanbul counts it as 2 extra branches that are
      // structurally unreachable (import always succeeds). Real logic is 100% covered.
      branches: 85,
      functions: 96,
      lines: 96,
    },
    [srcDir("auth")]: {
      statements: 94,
      branches: 75,
      functions: 88,
      lines: 94,
    },
    [path.join(__dirname, "src", "auth", "auth.service.ts")]: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    // Pure, safety-critical helpers behind the minor/adult decision (#60):
    // an uncovered branch here is a wrong answer about someone's age.
    [srcDir("common", "birth-date")]: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    // Same reasoning for the health-data retention rule (#62): this file turns
    // a PUBLISHED promise ("deleted at most 12 months after the certificate
    // expires") into a date. An uncovered branch is either a broken public
    // commitment or a document destroyed while still needed.
    [path.join(
      __dirname,
      "src",
      "licenses",
      "medical-certificate-retention.util.ts",
    )]: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    [srcDir("common", "filters")]: {
      statements: 96,
      branches: 78,
      functions: 96,
      lines: 96,
    },
    [srcDir("common", "guards")]: {
      statements: 94,
      branches: 82,
      functions: 95,
      lines: 94,
    },
    [srcDir("common", "utils")]: {
      statements: 96,
      branches: 95,
      functions: 96,
      lines: 96,
    },
    [srcDir("common", "decorators")]: {
      statements: 96,
      branches: 95,
      functions: 96,
      lines: 96,
    },
    [srcDir("health")]: {
      statements: 96,
      branches: 72,
      functions: 96,
      lines: 96,
    },
    [srcDir("payment")]: {
      statements: 80,
      branches: 72,
      functions: 95,
      lines: 82,
    },
    [path.join(__dirname, "src", "clubs", "clubs.service.ts")]: {
      branches: 71,
      functions: 88,
      lines: 90,
      statements: 87,
    },
    [srcDir("competitions", "services")]: {
      branches: 72,
      functions: 72,
      lines: 88,
      statements: 88,
    },
    [path.join(
      __dirname,
      "src",
      "competitions",
      "services",
      "competition-registration.service.ts",
    )]: {
      branches: 87,
      functions: 72,
      lines: 92,
      statements: 90,
    },
    [path.join(__dirname, "src", "licenses", "licenses.service.ts")]: {
      branches: 79,
      functions: 85,
      lines: 88,
      statements: 86,
    },
    [path.join(__dirname, "src", "payment", "payment.service.ts")]: {
      branches: 78,
      functions: 92,
      lines: 92,
      statements: 90,
    },
    // --- Lock in existing coverage for previously unthresholded modules ---
    [srcDir("notifications")]: {
      statements: 90,
      branches: 72,
      functions: 88,
      lines: 90,
    },
    [srcDir("tracks")]: {
      statements: 93,
      branches: 72,
      functions: 93,
      lines: 93,
    },
    [srcDir("tts")]: {
      statements: 96,
      branches: 85,
      functions: 100,
      lines: 96,
    },
    [srcDir("users")]: {
      statements: 96,
      branches: 85,
      functions: 100,
      lines: 96,
    },
    [srcDir("reports")]: {
      statements: 94,
      branches: 64,
      functions: 100,
      lines: 94,
    },
    [srcDir("wdsf")]: {
      statements: 95,
      branches: 80,
      functions: 95,
      lines: 95,
    },
    [srcDir("redis")]: {
      statements: 95,
      branches: 82,
      functions: 95,
      lines: 95,
    },
    [srcDir("career")]: {
      statements: 85,
      branches: 64,
      functions: 85,
      lines: 85,
    },
  },
};
