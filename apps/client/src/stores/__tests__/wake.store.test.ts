import { useWakeStore } from "../wake.store";

describe("wake.store", () => {
  beforeEach(() => {
    useWakeStore.setState({ waking: false, visible: false, elapsed: 0 });
  });

  it("defaults to not waking and overlay hidden", () => {
    expect(useWakeStore.getState().waking).toBe(false);
    expect(useWakeStore.getState().visible).toBe(false);
    expect(useWakeStore.getState().elapsed).toBe(0);
  });

  it("setWaking(true) flips waking and resets elapsed", () => {
    useWakeStore.getState().setElapsed(42);
    useWakeStore.getState().setWaking(true);
    expect(useWakeStore.getState().waking).toBe(true);
    expect(useWakeStore.getState().elapsed).toBe(0);
  });

  it("setWaking(true) keeps the current visibility (silent wake stays silent)", () => {
    useWakeStore.getState().setWaking(true);
    expect(useWakeStore.getState().visible).toBe(false);
  });

  it("setVisible(true) reveals the overlay mid-wake", () => {
    useWakeStore.getState().setWaking(true);
    useWakeStore.getState().setVisible(true);
    expect(useWakeStore.getState().visible).toBe(true);
  });

  it("setWaking(false) clears waking and hides the overlay", () => {
    useWakeStore.getState().setWaking(true);
    useWakeStore.getState().setVisible(true);
    useWakeStore.getState().setWaking(false);
    expect(useWakeStore.getState().waking).toBe(false);
    expect(useWakeStore.getState().visible).toBe(false);
  });

  it("setElapsed updates the counter", () => {
    useWakeStore.getState().setElapsed(7);
    expect(useWakeStore.getState().elapsed).toBe(7);
  });
});
