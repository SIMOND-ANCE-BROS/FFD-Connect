// Expo SDK 57 installs a lazy "winter" runtime (WinterCG) that replaces the
// global `fetch`/`Response`/`Request`/`Headers` with getters backed by a native
// module (expo/src/winter/fetch → NativeResponse). In the Jest/node environment
// that native module is null, so triggering the getter throws
// "Cannot read properties of null (reading 'NativeResponse')". MSW's
// `hasConfigurableGlobal` probe *invokes* the getter to check it, which crashes
// every suite that calls server.listen(). jest.polyfills.js stashed the plain
// Node globals before expo loaded — re-pin them here as non-lazy values so the
// probe never triggers expo's getter.
if (globalThis.__nodeFetchGlobals) {
  for (const [name, impl] of Object.entries(globalThis.__nodeFetchGlobals)) {
    if (typeof impl === "function") {
      Object.defineProperty(globalThis, name, {
        value: impl,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}

// MSW Server setup — must be in setupFilesAfterFramework to use Jest globals
const { server } = require("./src/mocks/msw/server");

// Configure @tanstack/query-core notifyManager to flush synchronously so that
// its internal setTimeout(cb, 0) scheduler does not leave open handles after
// the last test in a worker finishes.
try {
  const { notifyManager } = require("@tanstack/query-core");
  notifyManager.setScheduler((cb) => cb());
} catch {
  // notifyManager unavailable in suites that fully mock @tanstack/react-query
}

// Wrap setImmediate to track handles created during this suite.
// The React scheduler (schedulePerformWorkUntilDeadline) captures setImmediate
// at module load time; since setupFilesAfterEnv runs before the test file
// loads its modules, our wrapper is in place when the scheduler initialises.
const _realSetImmediate = global.setImmediate;
let _autoUnref = false; // flipped in afterAll to unref all subsequent handles
const _immediateHandles = new Set();

global.setImmediate = (fn, ...args) => {
  const handle = _realSetImmediate(fn, ...args);
  if (handle && typeof handle.unref === "function") {
    if (_autoUnref) {
      // Post-suite: unref immediately so the handle does not keep the worker alive.
      handle.unref();
    } else {
      _immediateHandles.add(handle);
    }
  }
  return handle;
};

// Wrap setTimeout to track handles created during this suite.
// React Native's setUpTimers replaces global.setImmediate with a lazy getter
// that points to JSTimers.queueReactNativeMicrotask, which internally calls
// setTimeout(fn, 0). The React scheduler captures this RN shim, so scheduler
// handles are Timeout type (not Immediate). We unref them on suite teardown.
const _realSetTimeout = global.setTimeout;
const _timeoutHandles = new Set();

global.setTimeout = (fn, delay, ...args) => {
  const handle = _realSetTimeout(fn, delay, ...args);
  if (handle && typeof handle.unref === "function") {
    if (_autoUnref) {
      handle.unref();
    } else {
      _timeoutHandles.add(handle);
    }
  }
  return handle;
};

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
afterAll(() => {
  // Enable auto-unref so every subsequent setImmediate/setTimeout handle (from
  // scheduler chains triggered by remaining async work) is immediately unrefed.
  _autoUnref = true;
  // Unref all handles already tracked during the suite.
  for (const handle of _immediateHandles) {
    if (typeof handle.unref === "function") handle.unref();
  }
  _immediateHandles.clear();
  for (const handle of _timeoutHandles) {
    if (typeof handle.unref === "function") handle.unref();
  }
  _timeoutHandles.clear();
  // Restore globals for the next suite in this worker.
  global.setImmediate = _realSetImmediate;
  global.setTimeout = _realSetTimeout;
});
