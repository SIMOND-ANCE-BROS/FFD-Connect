import { httpDelete, HttpError } from "../httpInterceptor";

const mockError = jest.fn();
jest.mock("../logger", () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => mockError(...args),
    warn: jest.fn(),
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
  beforeEach(() => mockError.mockClear());

  it("throws an expected status without logging it", async () => {
    respondWith(409);
    const err = await httpDelete("/api/tracks/t1", {
      quietStatuses: [409],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(409);
    expect(mockError).not.toHaveBeenCalled();
  });

  it("still logs the other statuses", async () => {
    respondWith(500);
    await expect(
      httpDelete("/api/tracks/t1", { quietStatuses: [409] }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(mockError).toHaveBeenCalledTimes(1);
  });
});
