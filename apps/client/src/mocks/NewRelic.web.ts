/**
 * Web stub for newrelic-react-native-agent.
 * The library uses requireNativeComponent which is not available on web.
 * All methods are no-ops on web.
 */

const NewRelic = {
  logDebug: (_message: string) => {},
  logInfo: (_message: string) => {},
  logWarn: (_message: string) => {},
  logError: (_message: string) => {},
  recordError: (_error: Error) => {},
  crashNow: (_message?: string) => {},
  noticeHttpTransaction: () => {},
  noticeNetworkFailure: () => {},
  recordMetric: () => {},
  recordCustomEvent: () => {},
  setUserId: (_userId: string) => {},
  setAttribute: () => {},
  removeAttribute: () => {},
  incrementAttribute: () => {},
  startInteraction: (_interactionName: string) => Promise.resolve(""),
  endInteraction: (_interactionId: string) => {},
  setInteractionName: (_interactionName: string) => {},
  startTimer: (_metricName: string) => {},
  stopTimer: (_metricName: string) => {},
};

export default NewRelic;
