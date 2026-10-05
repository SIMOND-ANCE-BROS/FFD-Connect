/**
 * Shared console configuration for Jest tests
 *
 * Silences console.log and console.warn by default to reduce noise.
 * Allows filtering console.error by a list of known expected error patterns.
 *
 * Usage:
 * require('@repo/jest-config/setup/console')(['Pattern 1', 'Pattern 2']);
 */
module.exports = function setupConsole(knownTestErrors = []) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  if (process.env.JEST_SILENT !== 'false') {
    console.log = jest.fn();
    console.warn = jest.fn();

    console.error = jest.fn((...args) => {
      const message = args[0]?.toString() || '';

      if (knownTestErrors.some((pattern) => message.includes(pattern))) {
        return;
      }

      originalError(...args);
    });
  } else {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
};
