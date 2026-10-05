module.exports = {
  isDevice: true,
  deviceType: 2,
  modelName: "test",
  osName: "iOS",
  osVersion: "17.0",
  osBuildId: "1",
  supportedCpuArchitectures: [],
  getDeviceTypeAsync: jest.fn(() => Promise.resolve(2)),
};
