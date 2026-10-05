const NewRelic = {
  startAgent: jest.fn(),
  setJSAppVersion: jest.fn(),
  setAttribute: jest.fn(),
  addCustomAttributes: jest.fn(),
  recordCustomEvent: jest.fn(),
  recordError: jest.fn(() => Promise.resolve()),
  logDebug: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  noticeHttpTransaction: jest.fn(),
  crashNow: jest.fn(),
};

module.exports = NewRelic;
module.exports.default = NewRelic;
