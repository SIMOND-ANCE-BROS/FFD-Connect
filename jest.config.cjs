// Root config: orchestrator only. It does not run tests itself; it runs the
// Backend and Client projects. "Root" in the Jest UI is this config.
module.exports = {
  projects: ["<rootDir>/apps/backend", "<rootDir>/apps/client"],
  coverageProvider: "v8",
  coverageReporters: ["text", "lcov", "clover"],
};
