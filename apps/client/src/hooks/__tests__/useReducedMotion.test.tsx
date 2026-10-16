import { act, renderHook } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { useMotionEnabled, useReducedMotion } from "../useReducedMotion";

const mockUseTheme = jest.fn();
jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => mockUseTheme(),
}));

type Listener = (value: boolean) => void;

describe("useReducedMotion", () => {
  let listener: Listener | null;
  const remove = jest.fn();

  beforeEach(() => {
    listener = null;
    remove.mockClear();
    mockUseTheme.mockReturnValue({ animationsEnabled: true });
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation((_event, handler) => {
        listener = handler as Listener;
        return { remove } as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the OS setting on mount", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("follows the OS setting when it changes, and unsubscribes", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false);
    const { result, unmount } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    await act(async () => {
      listener?.(true);
    });
    expect(result.current).toBe(true);

    await unmount();
    expect(remove).toHaveBeenCalled();
  });

  it("keeps animations when the OS query fails", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockRejectedValue(new Error("unavailable"));
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  describe("useMotionEnabled", () => {
    it("needs both the in-app toggle and the OS setting", async () => {
      jest
        .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
        .mockResolvedValue(false);
      const { result } = await renderHook(() => useMotionEnabled());
      expect(result.current).toBe(true);

      await act(async () => {
        listener?.(true);
      });
      expect(result.current).toBe(false);
    });

    it("is off when the user disabled animations in the app", async () => {
      mockUseTheme.mockReturnValue({ animationsEnabled: false });
      jest
        .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
        .mockResolvedValue(false);
      const { result } = await renderHook(() => useMotionEnabled());
      expect(result.current).toBe(false);
    });
  });
});
