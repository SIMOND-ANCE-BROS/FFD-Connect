import { onSessionEnd, runSessionEndCleanups } from "../sessionCleanup";

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

describe("sessionCleanup", () => {
  it("exécute chaque purge enregistrée, même si l'une échoue", async () => {
    const first = jest.fn().mockRejectedValue(new Error("boom"));
    const second = jest.fn();
    const offFirst = onSessionEnd(first);
    const offSecond = onSessionEnd(second);

    await expect(runSessionEndCleanups()).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });

  it("n'exécute plus une purge désabonnée", async () => {
    const cleanup = jest.fn();
    const off = onSessionEnd(cleanup);
    off();

    await runSessionEndCleanups();

    expect(cleanup).not.toHaveBeenCalled();
  });
});
