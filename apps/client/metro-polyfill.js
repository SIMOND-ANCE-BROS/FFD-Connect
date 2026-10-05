// Injected by metro.config.js as a Metro-level polyfill — runs before any
// __r() entry point, including InitializeCore (208) which loads ReactFabric.
//
// React Native 0.83 React Fabric calls `console.timeStamp()` (Chrome DevTools
// API not in Hermes) at module-load time to capture supportsUserTiming, and
// then again at every render. Our app/polyfills.js runs AFTER ReactFabric, too
// late to set supportsUserTiming=false. Polyfilling at Metro level (before
// the module runtime) ensures supportsUserTiming sees a real function.
// Note: only ReactFabric-DEV uses console.timeStamp. Production renderer
// (ReactFabric-prod.js) does not call it — production builds don't need this
// polyfill, but it's harmless to keep. In dev, Hermes treats the `console`
// object as a HostObject and may not honor non-writable descriptors, so the
// polyfill cannot fully prevent every error. The polyfill is best-effort for
// dev; production is the reliable target.
if (typeof console !== "undefined") {
  Object.defineProperty(console, "timeStamp", {
    value: function timeStamp() {},
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // Break the recursive error loop. RN's ExceptionsManager.installConsoleErrorReporter
  // only wraps console.error if `console._errorOriginal` is falsy. Pre-setting it to
  // a no-op skips the wrap entirely — console.error stays as Hermes default, so when
  // ReactFabric-dev's console.timeStamp call fails (and other dev-only errors), the
  // error log doesn't trigger a wrapped reactConsoleErrorHandler that calls a
  // missing _errorOriginal, which would otherwise infinite-loop and freeze the JS
  // thread (blocking touch events and rendering, hence the "white screen" + dead
  // tabs symptom). Trade-off: redbox error overlay is disabled. Worth it.
  console._errorOriginal = function () {};
}
