module.exports = {
  useSharedValue: jest.fn((v) => ({ value: v })),
  useAnimatedStyle: jest.fn(() => ({})),
  withTiming: jest.fn(),
  withSpring: jest.fn(),
  runOnJS: jest.fn((fn) => fn),
  Easing: {
    inOut: jest.fn(),
    quad: jest.fn(),
  },
  createAnimatedComponent: (c) => c,
};
