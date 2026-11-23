import { act } from "@testing-library/react-native";

/**
 * Lets FlashList finish its first load inside act before RNTL unmounts the
 * screen, so a test that asserts right after the render ends without an
 * « update to FlashList … not wrapped in act » warning (#986).
 *
 * Why: FlashList v2 reports its first layout from a requestAnimationFrame
 * (useOnListLoad → setIsLoaded(true)), and its view holders can re-render in
 * the same frame. A test that is already done by then lets that frame fire
 * between its last assertion and the cleanup, outside act — or not, depending
 * on the worker's load, so the warning comes and goes.
 *
 * Call it inside the suite's `describe`: the `afterEach` it registers there
 * runs before RNTL's cleanup, which RNTL adds at the root when it is imported
 * (jest-circus runs a nested block's afterEach hooks before the root ones).
 * Real timers only: under jest fake timers the frame would never fire.
 */
export function settleFlashListAfterEach(): void {
  afterEach(async () => {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}
