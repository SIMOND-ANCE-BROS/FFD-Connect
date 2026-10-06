import * as ReactNative from "react-native";

type ReactNativeExport = keyof typeof ReactNative;

/**
 * Loads react-native components up front, in a synchronous `beforeAll`, so
 * their one-time module cost is not billed to the first test of the file.
 *
 * Why: react-native exports its components through lazy getters, so a
 * component's module is first required when a render reads it — inside the
 * first test. Some of the preset's mocks (@react-native/jest-preset, `Modal`,
 * `ScrollView`) `jest.requireActual` the real component to extend it, which
 * drags in Animated, VirtualizedLists, AppContainer/LogBox… Measured with a
 * cold transform cache: ScrollView ~3.6 s, Modal ~4.7 s. Under full-suite load
 * (every worker plus the backend tests in the pre-push hook) that grows past
 * the 15 s test timeout (jest.polyfills.js) and the first test of the file
 * fails, while the same file passes when run alone.
 *
 * A synchronous hook cannot time out (jest-circus settles it before the timer
 * can fire), so the cost moves out of any test's budget without bumping a
 * timeout. Pass only the components the rendered tree actually uses.
 */
export function preloadReactNative(...names: ReactNativeExport[]): void {
  beforeAll(() => {
    for (const name of names) {
      // Reading the export runs its lazy getter, i.e. the require.
      if (ReactNative[name] === undefined) {
        throw new Error(`react-native has no "${String(name)}" export`);
      }
    }
  });
}
