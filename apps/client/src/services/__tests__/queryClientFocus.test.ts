import { QueryObserver, focusManager } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

type AppStateListener = (status: AppStateStatus) => void;

const appStateListeners: AppStateListener[] = [];
const removeSpy = jest.fn();

jest
  .spyOn(AppState, "addEventListener")
  .mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return { remove: removeSpy };
  });

// Required after the spy: the module wires focusManager at import time.
const { queryClient, focusFromAppState } =
  require("../queryClient") as typeof import("../queryClient");

const emit = (status: AppStateStatus) => {
  appStateListeners.forEach((listener) => listener(status));
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("focusFromAppState (#300)", () => {
  it("maps active to focused and background to unfocused", () => {
    expect(focusFromAppState("active")).toBe(true);
    expect(focusFromAppState("background")).toBe(false);
  });

  it("ignores transient iOS states (Face ID, Control Center…)", () => {
    expect(focusFromAppState("inactive")).toBeUndefined();
    expect(focusFromAppState(null)).toBeUndefined();
    expect(focusFromAppState(undefined)).toBeUndefined();
  });
});

describe("queryClient — refetch au retour au premier plan (#300)", () => {
  let unmount: () => void;
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    queryClient.mount();
    unmount = () => queryClient.unmount();
    emit("active");
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    unmount();
    queryClient.clear();
  });

  const observe = async (staleTime: number) => {
    const queryFn = jest.fn().mockResolvedValue({ ok: true });
    const observer = new QueryObserver(queryClient, {
      queryKey: ["focus-test", staleTime],
      queryFn,
      staleTime,
    });
    unsubscribe = observer.subscribe(() => undefined);
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(1);
    return queryFn;
  };

  it("is wired to AppState", () => {
    expect(AppState.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("refetches a stale mounted query once when the app comes back", async () => {
    const queryFn = await observe(0);

    emit("inactive");
    emit("background");
    expect(focusManager.isFocused()).toBe(false);
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(1);

    emit("active");
    emit("active");
    await flush();
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("does not refetch on a transient inactive -> active (Face ID prompt)", async () => {
    const queryFn = await observe(0);

    emit("inactive");
    emit("active");
    await flush();

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("does not refetch a query that is still fresh (staleTime)", async () => {
    const queryFn = await observe(60_000);

    emit("background");
    emit("active");
    await flush();

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
