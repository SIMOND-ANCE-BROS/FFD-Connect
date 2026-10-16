import { render } from "@testing-library/react-native";
import React, { useRef } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import {
  A11Y_FOCUS_DELAY_MS,
  type A11yFocusTarget,
  focusAccessibility,
  useFocusOnChange,
  useRestoreFocusOnClose,
} from "../a11yFocus";

describe("a11yFocus", () => {
  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    // AccessibilityInfo is already a jest mock in the RN preset: reset calls.
    jest.clearAllMocks();
    jest.useFakeTimers();
    sendSpy = jest
      .spyOn(AccessibilityInfo, "sendAccessibilityEvent")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("focusAccessibility", () => {
    it("sends a focus event to the target after the delay", () => {
      const target = {} as A11yFocusTarget;
      focusAccessibility(() => target, 200);
      expect(sendSpy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(200);
      expect(sendSpy).toHaveBeenCalledWith(target, "focus");
    });

    it("does nothing when the target is not mounted", () => {
      focusAccessibility(() => null);
      jest.advanceTimersByTime(A11Y_FOCUS_DELAY_MS);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("can be cancelled before the delay elapses", () => {
      const cancel = focusAccessibility(() => null, 100);
      cancel();
      jest.advanceTimersByTime(100);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("swallows errors from an unmounted host instance", () => {
      sendSpy.mockImplementation(() => {
        throw new Error("unmounted");
      });
      const target = {} as A11yFocusTarget;
      focusAccessibility(() => target, 0);
      expect(() => jest.advanceTimersByTime(0)).not.toThrow();
    });
  });

  describe("useRestoreFocusOnClose", () => {
    const Harness = ({ visible }: { visible: boolean }) => {
      const ref = useRef<View>(null);
      useRestoreFocusOnClose(visible, ref, 0);
      return (
        <View ref={ref} accessible>
          <Text>Ouvrir</Text>
        </View>
      );
    };

    it("focuses the trigger only when the modal goes from open to closed", async () => {
      const { rerender } = await render(<Harness visible={false} />);
      jest.advanceTimersByTime(0);
      expect(sendSpy).not.toHaveBeenCalled();

      await rerender(<Harness visible />);
      jest.advanceTimersByTime(0);
      expect(sendSpy).not.toHaveBeenCalled();

      await rerender(<Harness visible={false} />);
      jest.advanceTimersByTime(0);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0][1]).toBe("focus");
    });
  });

  describe("useFocusOnChange", () => {
    const Harness = ({ step }: { step: number }) => {
      const ref = useRef<Text>(null);
      useFocusOnChange(step, ref, 0);
      return <Text ref={ref}>Étape {step}</Text>;
    };

    it("does not steal focus on the first render, then follows each change", async () => {
      const { rerender } = await render(<Harness step={1} />);
      jest.advanceTimersByTime(0);
      expect(sendSpy).not.toHaveBeenCalled();

      await rerender(<Harness step={2} />);
      jest.advanceTimersByTime(0);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });
});
