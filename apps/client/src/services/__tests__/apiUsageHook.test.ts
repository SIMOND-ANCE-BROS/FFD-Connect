import api from "../api";
import { usage } from "../analytics/usage";

describe("api → usage hook", () => {
  it("signals a successful response, not a failed one", async () => {
    const spy = jest
      .spyOn(usage, "onApiSuccess")
      .mockImplementation(() => undefined);
    const adapter = jest.fn(async (config) => {
      if (config.url === "/ok")
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
      return Promise.reject(
        Object.assign(new Error("Not found"), {
          isAxiosError: true,
          config,
          response: {
            data: {},
            status: 404,
            statusText: "Not Found",
            headers: {},
            config,
          },
        }),
      );
    });
    await api.get("/ok", { adapter });
    await api.get("/ko", { adapter }).catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
