import { act, renderHook } from "@testing-library/react-native";
import { io } from "socket.io-client";
import { useLiveTiming } from "../useLiveTiming";

const handlers: Partial<Record<string, (data?: unknown) => void>> = {};
const socketMock = {
  on: jest.fn((event: string, cb: (data?: unknown) => void) => {
    handlers[event] = cb;
  }),
  emit: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock("socket.io-client", () => ({
  io: jest.fn(),
}));

describe("useLiveTiming", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(handlers).forEach((key) => delete handlers[key]);
    (io as jest.Mock).mockReturnValue(socketMock);
  });

  it("connects and updates state from socket events", async () => {
    const { result } = await renderHook(() => useLiveTiming("comp-1"));

    await act(() => {
      handlers.connect?.();
    });

    expect(result.current.state.isConnected).toBe(true);
    expect(socketMock.emit).toHaveBeenCalledWith("joinCompetition", "comp-1");

    await act(() => {
      handlers.delay_update?.({ competitionId: "comp-1", delayMinutes: 5 });
    });
    expect(result.current.state.delayMinutes).toBe(5);
  });

  it("disconnects on unmount", async () => {
    const { unmount } = await renderHook(() => useLiveTiming("comp-2"));
    await unmount();

    expect(socketMock.emit).toHaveBeenCalledWith("leaveCompetition", "comp-2");
    expect(socketMock.disconnect).toHaveBeenCalled();
  });

  it("updates currentHeat from heat_update event", async () => {
    const { result } = await renderHook(() => useLiveTiming("comp-1"));

    await act(() => {
      handlers.connect?.();
    });

    const heatData = {
      id: "heat-1",
      competitionId: "comp-1",
      eventId: "ev-1",
      status: "RUNNING",
    };

    await act(() => {
      handlers.heat_update?.(heatData);
    });

    expect(result.current.state.currentHeat).toEqual(heatData);
  });

  it("updates lastResult from result_published event", async () => {
    const { result } = await renderHook(() => useLiveTiming("comp-1"));

    await act(() => {
      handlers.connect?.();
    });

    const resultData = {
      id: "res-1",
      competitionId: "comp-1",
      eventId: "ev-1",
      results: [{ coupleId: "c1", position: 1 }],
    };

    await act(() => {
      handlers.result_published?.(resultData);
    });

    expect(result.current.state.lastResult).toEqual(resultData);
  });

  it("ignores delay_update when competitionId does not match", async () => {
    const { result } = await renderHook(() => useLiveTiming("comp-1"));

    await act(() => {
      handlers.connect?.();
    });

    await act(() => {
      handlers.delay_update?.({
        competitionId: "other-comp",
        delayMinutes: 10,
      });
    });

    expect(result.current.state.delayMinutes).toBe(0);
  });

  it("updates isConnected to false on disconnect event", async () => {
    const { result } = await renderHook(() => useLiveTiming("comp-1"));

    await act(() => {
      handlers.connect?.();
    });
    expect(result.current.state.isConnected).toBe(true);

    await act(() => {
      handlers.disconnect?.();
    });
    expect(result.current.state.isConnected).toBe(false);
  });

  it("does not connect when competitionId is undefined", async () => {
    await renderHook(() => useLiveTiming(undefined));
    expect(io).not.toHaveBeenCalled();
  });

  it("reconnect action re-establishes connection", async () => {
    const { result } = await renderHook(() => useLiveTiming("comp-1"));

    await act(() => {
      handlers.connect?.();
    });
    (io as jest.Mock).mockClear();

    await act(() => {
      result.current.actions.reconnect();
    });

    expect(io).toHaveBeenCalled();
  });
});
