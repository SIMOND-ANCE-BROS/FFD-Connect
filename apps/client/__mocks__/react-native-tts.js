module.exports = {
  getInitStatus: jest.fn(() => Promise.resolve("success")),
  speak: jest.fn(),
  stop: jest.fn(),
  setDefaultLanguage: jest.fn(),
  setDefaultRate: jest.fn(),
};
