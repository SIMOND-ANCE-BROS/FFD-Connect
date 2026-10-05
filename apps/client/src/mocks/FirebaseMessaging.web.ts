/**
 * Web stub for @react-native-firebase/messaging.
 *
 * Push notifications are native-only here, but NotificationHandler is now
 * reachable from AuthService (through pushRegistration), and Metro resolves
 * requires statically — so without this stub the real native module would be
 * pulled into the web bundle and break it. Wired for web only, in
 * metro.config.js MOCKS.
 *
 * pushRegistration also refuses to run off ios/android, so nothing here is
 * ever exercised; it exists to keep the bundle resolvable.
 */

const AuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
} as const;

const noop = (): void => {};

const messaging = () => ({
  requestPermission: () => Promise.resolve(AuthorizationStatus.DENIED),
  getToken: () => Promise.resolve(""),
  deleteToken: () => Promise.resolve(),
  setBackgroundMessageHandler: noop,
  onMessage: () => noop,
  onNotificationOpenedApp: () => noop,
  onTokenRefresh: () => noop,
  getInitialNotification: () => Promise.resolve(null),
  subscribeToTopic: () => Promise.resolve(),
  unsubscribeFromTopic: () => Promise.resolve(),
});

messaging.AuthorizationStatus = AuthorizationStatus;

export { AuthorizationStatus };
export default messaging;
