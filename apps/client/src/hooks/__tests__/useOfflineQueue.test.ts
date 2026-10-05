import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderHook, act } from "@testing-library/react-native";
import { AppState } from "react-native";
import {
  dispatchMutation,
  MAX_REPLAY_ATTEMPTS,
  useOfflineQueue,
} from "../useOfflineQueue";
import { queryClient } from "../../services/queryClient";
import { useOfflineQueueStore } from "../../stores/offlineQueue.store";

// NetInfo mock
jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: jest.fn(() => jest.fn()), // returns unsubscribe
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

// api mock (used by the default endpoint-dispatch branch)
const mockApi = {
  post: jest.fn().mockResolvedValue({ ok: true }),
  patch: jest.fn().mockResolvedValue({ ok: true }),
  delete: jest.fn().mockResolvedValue({ ok: true }),
};
jest.mock("../../services/api", () => ({
  __esModule: true,
  // Getter: the module is imported (hoisted) before mockApi is initialised.
  get default() {
    return mockApi;
  },
}));

// queryClient mock so invalidateQueries is observable
jest.mock("../../services/queryClient", () => ({
  queryClient: { invalidateQueries: jest.fn().mockResolvedValue(undefined) },
}));

const QUEUE_KEY = "@ffd/offline-queue";

beforeEach(async () => {
  await AsyncStorage.clear();
  useOfflineQueueStore.getState().setItems([]);
  jest.clearAllMocks();
});

describe("useOfflineQueue", () => {
  it("enqueues a mutation when offline", async () => {
    const { result } = await renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /competitions/123/register",
        payload: { partnerName: "Jean" },
        queryKeysToInvalidate: [["competitions"]],
      });
    });
    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    expect(stored).not.toBeNull();
    const queue = JSON.parse(stored!) as unknown[];
    expect(queue).toHaveLength(1);
  });

  it("processes queue on reconnect and calls mutationFn", async () => {
    const NetInfo = require("@react-native-community/netinfo");
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null =
      null;
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: { isConnected: boolean }) => void) => {
        reconnectCallback = cb;
        return jest.fn();
      },
    );

    const mutationFn = jest.fn().mockResolvedValue({ ok: true });
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));

    // Enqueue a mutation
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /competitions/123/register",
        payload: { partnerName: "Jean" },
        queryKeysToInvalidate: [["competitions"]],
      });
    });

    // Simulate reconnect
    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      // Wait for async processing
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutationFn).toHaveBeenCalledWith(
      {
        endpoint: "POST /competitions/123/register",
        payload: { partnerName: "Jean" },
      },
      expect.objectContaining({ endpoint: "POST /competitions/123/register" }),
    );
    // invalidates the query keys after a successful replay
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competitions"],
    });
  });

  it("shows conflict toast on 409 and clears queue entry", async () => {
    const NetInfo = require("@react-native-community/netinfo");
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null =
      null;
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: { isConnected: boolean }) => void) => {
        reconnectCallback = cb;
        return jest.fn();
      },
    );

    const conflictError = Object.assign(new Error("Conflict"), {
      response: { status: 409 },
    });
    const mutationFn = jest.fn().mockRejectedValue(conflictError);
    const onConflict = jest.fn();
    const { result } = await renderHook(() =>
      useOfflineQueue({ mutationFn, onConflict }),
    );

    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /competitions/123/register",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(onConflict).toHaveBeenCalled();
    // Queue should be cleared after conflict
    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = stored ? (JSON.parse(stored) as unknown[]) : [];
    expect(queue).toHaveLength(0);
  });

  it("does nothing on reconnect when the queue is empty", async () => {
    const NetInfo = require("@react-native-community/netinfo");
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null =
      null;
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: { isConnected: boolean }) => void) => {
        reconnectCallback = cb;
        return jest.fn();
      },
    );

    const mutationFn = jest.fn();
    await renderHook(() => useOfflineQueue({ mutationFn }));

    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(mutationFn).not.toHaveBeenCalled();
  });

  it("ignores the network event while still disconnected", async () => {
    const NetInfo = require("@react-native-community/netinfo");
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null =
      null;
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: { isConnected: boolean }) => void) => {
        reconnectCallback = cb;
        return jest.fn();
      },
    );

    const mutationFn = jest.fn().mockResolvedValue({ ok: true });
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));

    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /x",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    await act(async () => {
      reconnectCallback?.({ isConnected: false });
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(mutationFn).not.toHaveBeenCalled();
  });

  it("keeps the mutation in the queue on a non-409 failure", async () => {
    const NetInfo = require("@react-native-community/netinfo");
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null =
      null;
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: { isConnected: boolean }) => void) => {
        reconnectCallback = cb;
        return jest.fn();
      },
    );

    const serverError = Object.assign(new Error("boom"), {
      response: { status: 500 },
    });
    const mutationFn = jest.fn().mockRejectedValue(serverError);
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));

    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /retry",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      await new Promise((r) => setTimeout(r, 40));
    });

    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = stored ? (JSON.parse(stored) as unknown[]) : [];
    expect(queue).toHaveLength(1);
  });

  it("keeps the mutation when the error has no response status", async () => {
    const NetInfo = require("@react-native-community/netinfo");
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null =
      null;
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: { isConnected: boolean }) => void) => {
        reconnectCallback = cb;
        return jest.fn();
      },
    );

    const mutationFn = jest.fn().mockRejectedValue(new Error("plain error"));
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));

    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /retry",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      await new Promise((r) => setTimeout(r, 40));
    });

    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = stored ? (JSON.parse(stored) as unknown[]) : [];
    expect(queue).toHaveLength(1);
  });

  it("treats corrupt queue JSON as an empty queue", async () => {
    const NetInfo = require("@react-native-community/netinfo");
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null =
      null;
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: { isConnected: boolean }) => void) => {
        reconnectCallback = cb;
        return jest.fn();
      },
    );

    await AsyncStorage.setItem(QUEUE_KEY, "{not-json");

    const mutationFn = jest.fn();
    await renderHook(() => useOfflineQueue({ mutationFn }));

    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      await new Promise((r) => setTimeout(r, 30));
    });

    // corrupt payload parsed as empty -> nothing replayed, no throw
    expect(mutationFn).not.toHaveBeenCalled();
  });
});

describe("useOfflineQueue — replay policy", () => {
  type NetState = {
    isConnected: boolean;
    isInternetReachable?: boolean | null;
  };
  let emit: (state: NetState) => void = () => {};

  beforeEach(() => {
    const NetInfo = require("@react-native-community/netinfo");
    NetInfo.addEventListener.mockImplementation(
      (cb: (state: NetState) => void) => {
        emit = cb;
        return jest.fn();
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const reconnect = async (state: NetState = { isConnected: true }) => {
    await act(async () => {
      emit(state);
      await new Promise((r) => setTimeout(r, 40));
    });
  };

  const stored = async () => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as { endpoint: string }[]) : [];
  };

  it("replays a queue persisted before an app restart", async () => {
    await AsyncStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([
        {
          id: "persisted-1",
          endpoint: "POST /competitions/c1/register",
          payload: { eventId: "e1" },
          queryKeysToInvalidate: [["myRegistrations"]],
          enqueuedAt: 1,
        },
      ]),
    );
    const mutationFn = jest.fn().mockResolvedValue(undefined);
    await renderHook(() => useOfflineQueue({ mutationFn }));
    // Hydrated into the store on mount: pending UI survives restarts.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(useOfflineQueueStore.getState().items).toHaveLength(1);

    await reconnect();
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(await stored()).toHaveLength(0);
    expect(useOfflineQueueStore.getState().items).toHaveLength(0);
  });

  it("calls onReplaySuccess and lets onReplayError drop an entry", async () => {
    const rejected = Object.assign(new Error("bad"), {
      response: { status: 400 },
    });
    const mutationFn = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(rejected);
    const onReplaySuccess = jest.fn();
    const onReplayError = jest.fn().mockReturnValue("drop");
    const onConflict = jest.fn();
    const { result } = await renderHook(() =>
      useOfflineQueue({
        mutationFn,
        onReplaySuccess,
        onReplayError,
        onConflict,
      }),
    );
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /a",
        payload: {},
        queryKeysToInvalidate: [],
      });
      await result.current.enqueue({
        endpoint: "POST /b",
        payload: {},
        queryKeysToInvalidate: [["myRegistrations"]],
      });
    });

    await reconnect();

    expect(onReplaySuccess).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "POST /a" }),
    );
    expect(onReplayError).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "POST /b" }),
      rejected,
    );
    expect(onConflict).not.toHaveBeenCalled();
    // A drop invalidates too, so the UI rolls back to server truth.
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["myRegistrations"],
    });
    expect(await stored()).toHaveLength(0);
  });

  it("keeps the entry and stops the batch on a retry decision", async () => {
    const mutationFn = jest.fn().mockRejectedValue(new Error("offline"));
    const onReplayError = jest.fn().mockReturnValue("retry");
    const { result } = await renderHook(() =>
      useOfflineQueue({ mutationFn, onReplayError }),
    );
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /a",
        payload: {},
        queryKeysToInvalidate: [],
      });
      await result.current.enqueue({
        endpoint: "POST /b",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    await reconnect();

    // No hammering: nothing else is attempted after a transient failure.
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect((await stored()).map((m) => m.endpoint)).toEqual([
      "POST /a",
      "POST /b",
    ]);
  });

  it("falls back to the default policy when onReplayError returns undefined", async () => {
    const conflict = Object.assign(new Error("dup"), {
      response: { status: 409 },
    });
    const mutationFn = jest.fn().mockRejectedValue(conflict);
    const onConflict = jest.fn();
    const { result } = await renderHook(() =>
      useOfflineQueue({
        mutationFn,
        onConflict,
        onReplayError: () => undefined,
      }),
    );
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /x",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });
    await reconnect();
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(await stored()).toHaveLength(0);
  });

  it("runs a single replay for a burst of connectivity events", async () => {
    let release: () => void = () => {};
    const mutationFn = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /x",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });
    await act(async () => {
      emit({ isConnected: true });
      emit({ isConnected: true });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mutationFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(await stored()).toHaveLength(0);
  });

  it("ignores 'connected' events without internet", async () => {
    const mutationFn = jest.fn().mockResolvedValue(undefined);
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /x",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });
    await reconnect({ isConnected: true, isInternetReachable: false });
    expect(mutationFn).not.toHaveBeenCalled();
  });

  it("replays when the app returns to the foreground while connected", async () => {
    let onAppState: (s: string) => void = () => {};
    const remove = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, cb) => {
      onAppState = cb;
      return { remove };
    });
    const mutationFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const { result, unmount } = await renderHook(() =>
      useOfflineQueue({ mutationFn }),
    );
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /x",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });
    await reconnect(); // transient failure: entry kept
    expect(await stored()).toHaveLength(1);

    await act(async () => {
      onAppState("background");
      onAppState("active");
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(await stored()).toHaveLength(0);

    await unmount();
    expect(remove).toHaveBeenCalled();
  });

  it("dispatches POST, PATCH and DELETE through the api client", async () => {
    await dispatchMutation({ endpoint: "POST /a", payload: { x: 1 } });
    await dispatchMutation({ endpoint: "PATCH /b", payload: { y: 2 } });
    await dispatchMutation({ endpoint: "DELETE /c", payload: null });
    expect(mockApi.post).toHaveBeenCalledWith("/a", { x: 1 });
    expect(mockApi.patch).toHaveBeenCalledWith("/b", { y: 2 });
    expect(mockApi.delete).toHaveBeenCalledWith("/c");
  });

  it("uses the default dispatch when no mutationFn is given", async () => {
    const { result } = await renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /competitions/c1/register",
        payload: { eventId: "e1" },
        queryKeysToInvalidate: [],
      });
    });
    await reconnect();
    expect(mockApi.post).toHaveBeenCalledWith("/competitions/c1/register", {
      eventId: "e1",
    });
  });

  it("lets the batch through when the server answered (the fault is one entry)", async () => {
    // A server that answers proves the network works: blocking everything
    // behind the offending entry would strand unrelated actions.
    const answered = Object.assign(new Error("boom"), {
      response: { status: 500 },
    });
    const mutationFn = jest.fn(async (m: { endpoint: string }) => {
      if (m.endpoint === "POST /a") throw answered;
      return { ok: true };
    });
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /a",
        payload: {},
        queryKeysToInvalidate: [],
      });
      await result.current.enqueue({
        endpoint: "POST /b",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    await reconnect();

    expect(mutationFn).toHaveBeenCalledTimes(2);
    // The failing entry stays; the healthy one is gone.
    expect((await stored()).map((m) => m.endpoint)).toEqual(["POST /a"]);
  });

  it("drops a poison entry after MAX_REPLAY_ATTEMPTS (#416)", async () => {
    const onReplayExhausted = jest.fn();
    const mutationFn = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("always 500"), { response: { status: 500 } }),
      );
    const { result } = await renderHook(() =>
      useOfflineQueue({ mutationFn, onReplayExhausted }),
    );
    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /poison",
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    for (let i = 0; i < MAX_REPLAY_ATTEMPTS; i++) await reconnect();

    expect(onReplayExhausted).toHaveBeenCalledTimes(1);
    expect(await stored()).toEqual([]);
  });

  it("replays straight away when enqueuing while still connected (#416)", async () => {
    // A timeout leaves NetInfo on "connected": no reconnect event will ever
    // fire, so the entry would sit there until the app is backgrounded.
    const mutationFn = jest.fn().mockResolvedValue({ ok: true });
    const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));
    await reconnect(); // mark the hook as connected, queue still empty

    await act(async () => {
      await result.current.enqueue({
        endpoint: "POST /late",
        payload: {},
        queryKeysToInvalidate: [],
      });
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(await stored()).toEqual([]);
  });
});

it("does not replay an entry the user cancelled mid-replay (#416)", async () => {
  // The replay loop iterates a SNAPSHOT. Collapsing only skips in-flight
  // ids, and only the entry being dispatched is in-flight — so a producer
  // can remove a later entry from storage while the loop still holds it.
  // Dispatching it then sends an action the user has just cancelled.
  const NetInfo = require("@react-native-community/netinfo");
  let reconnect: ((s: { isConnected: boolean }) => void) | null = null;
  NetInfo.addEventListener.mockImplementation(
    (cb: (s: { isConnected: boolean }) => void) => {
      reconnect = cb;
      return jest.fn();
    },
  );

  // First dispatch hangs until we release it — that is the slow wake.
  let releaseFirst: () => void = () => undefined;
  const firstInFlight = new Promise<void>((r) => {
    releaseFirst = r;
  });
  let seenFirst = false;
  const mutationFn = jest.fn(async () => {
    if (!seenFirst) {
      seenFirst = true;
      await firstInFlight;
    }
    return { ok: true };
  });

  const { result } = await renderHook(() => useOfflineQueue({ mutationFn }));

  await act(async () => {
    await result.current.enqueue({
      endpoint: "POST /competitions/e1/register",
      payload: {},
      queryKeysToInvalidate: [["competitions"]],
      collapseKey: "e1",
    });
    await result.current.enqueue({
      endpoint: "POST /competitions/e2/register",
      payload: {},
      queryKeysToInvalidate: [["competitions"]],
      collapseKey: "e2",
    });
  });

  await act(async () => {
    reconnect?.({ isConnected: true });
    await new Promise((r) => setTimeout(r, 20));

    // e1 is in flight; the user taps "unregister" on e2. Its pending
    // registration is not in flight, so it collapses out of storage.
    const outcome = await result.current.enqueue({
      endpoint: "DELETE /competitions/e2/register",
      payload: {},
      queryKeysToInvalidate: [["competitions"]],
      collapseKey: "e2",
    });
    expect(outcome).toBe("collapsed");

    releaseFirst();
    await new Promise((r) => setTimeout(r, 50));
  });

  const sent = mutationFn.mock.calls.map(
    (c) => (c[0] as { endpoint: string }).endpoint,
  );
  expect(sent).toContain("POST /competitions/e1/register");
  // The cancelled registration must never go out.
  expect(sent).not.toContain("POST /competitions/e2/register");
});
