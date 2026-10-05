// MUST be imported first in index.js — runs before any other module loads.
// React Native 0.83 React Fabric (ReactFabric-dev.js:13452) calls
// `console.timeStamp()` in prepareFreshStack. This is a Chrome DevTools API
// not implemented in Hermes; without this polyfill every React commit crashes
// with "TypeError: console.timeStamp is not a function".
if (typeof console !== "undefined" && typeof console.timeStamp !== "function") {
  console.timeStamp = function timeStamp() {};
}

// Reanimated 4 only installs _getAnimationTimestamp on UI runtime. JS-thread
// callers of withSpring/withTiming hit valueSetter which calls this and
// crashes. Safe identity fallback for JS thread.
if (typeof global._getAnimationTimestamp !== "function") {
  global._getAnimationTimestamp = () => Date.now();
}
