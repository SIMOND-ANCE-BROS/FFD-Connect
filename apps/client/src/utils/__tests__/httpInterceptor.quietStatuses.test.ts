import { httpDelete, HttpError } from "../httpInterceptor";

// HTTP failures are logged at warn since #589 (the caller reports them);
// error and warn share one spy so a regression to either level is caught.
const mockLog = jest.fn();
jest.mock("../logger", () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => mockLog(...args),
    warn: (...args: unknown[]) => mockLog(...args),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

function respondWith(status: number) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Error",
    headers: new Headers(),
    json: jest.fn().mockResolvedValue({ message: "Refusé" }),
    text: jest.fn(),
  });
}

describe("httpRequest — quietStatuses", () => {
  beforeEach(() => mockLog.mockClear());

  it("throws an expected status without logging it", async () => {
    respondWith(409);
    const err = await httpDelete("/api/tracks/t1", {
      quietStatuses: [409],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(409);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("still logs the other statuses", async () => {
    respondWith(500);
    await expect(
      httpDelete("/api/tracks/t1", { quietStatuses: [409] }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(mockLog).toHaveBeenCalledTimes(1);
  });
});
