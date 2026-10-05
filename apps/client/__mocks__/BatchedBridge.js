const BatchedBridge = {
  registerCallableModule: jest.fn(),
  registerLazyCallableModule: jest.fn(),
  setReactNativeMicrotasksCallback: jest.fn(),
  createDebugLookup: jest.fn(),
  callFunctionReturnFlushedQueue: jest.fn(),
};

BatchedBridge.default = BatchedBridge;

module.exports = BatchedBridge;
