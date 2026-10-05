const dims = { width: 375, height: 812, scale: 2, fontScale: 1 };
const Dimensions = {
  get: jest.fn().mockReturnValue(dims),
  set: jest.fn(),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  removeEventListener: jest.fn(),
};

// Satisfy top-level set calls in RN internals
Dimensions.set = jest.fn();
Dimensions.screen = dims;
Dimensions.window = dims;

module.exports = Dimensions;
