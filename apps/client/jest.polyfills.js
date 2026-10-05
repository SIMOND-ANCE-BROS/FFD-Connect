/**
 * Jest Polyfills for React 19 / RN 0.86
 * This file must run before anything else.
 */

// Stash Node's native fetch/Response/Request/Headers BEFORE React Native / Expo
// SDK 57 import. Expo's "winter" runtime later replaces these globals with lazy
// getters backed by a native module that is null under Jest; jest.msw-setup.js
// restores these plain implementations so MSW's global probe does not crash.
// See jest.msw-setup.js for the full explanation.
globalThis.__nodeFetchGlobals = {
  fetch: globalThis.fetch,
  Response: globalThis.Response,
  Request: globalThis.Request,
  Headers: globalThis.Headers,
};

const setImmediatePolyfill = (fn, ...args) => setTimeout(fn, 0, ...args);
const clearImmediatePolyfill = (id) => clearTimeout(id);

// Use Object.defineProperty to ensure they are available even if the environment is locked down
[global, globalThis, process].forEach((target) => {
  if (target) {
    // setImmediate
    if (typeof target.setImmediate === "undefined") {
      Object.defineProperty(target, "setImmediate", {
        value: setImmediatePolyfill,
        writable: true,
        configurable: true,
      });
    }
    // clearImmediate
    if (typeof target.clearImmediate === "undefined") {
      Object.defineProperty(target, "clearImmediate", {
        value: clearImmediatePolyfill,
        writable: true,
        configurable: true,
      });
    }
    // IS_REACT_ACT_ENVIRONMENT
    Object.defineProperty(target, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      writable: true,
      configurable: true,
    });
  }
});

// Configure process.env as well
process.env.IS_REACT_ACT_ENVIRONMENT = "true";

// Increase global timeout for complex React 19 tests
if (typeof jest !== "undefined") {
  jest.setTimeout(15000);
}

// Polyfill process.nextTick if missing (sometimes needed by promise libs)
if (typeof process !== "undefined" && !process.nextTick) {
  process.nextTick = setImmediatePolyfill;
}

console.log(
  "DEBUG: Jest Polyfills Loaded (setImmediate, IS_REACT_ACT_ENVIRONMENT)",
);
