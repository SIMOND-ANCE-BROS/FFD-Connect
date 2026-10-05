// Mock for react-native/Libraries/NativeComponent/ViewConfigIgnore
// The real file uses Flow `const` type parameter variance syntax not supported by babel-preset-expo 55
function ConditionallyIgnoredEventHandlers(value) {
  return value;
}

module.exports = { ConditionallyIgnoredEventHandlers };
