// Jest mock for expo-secure-store (native module). Default: empty secure store.
// Individual tests can override these jest.fns as needed.
module.exports = {
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
};
