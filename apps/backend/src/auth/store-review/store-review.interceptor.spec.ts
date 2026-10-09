import { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { lastValueFrom, of } from "rxjs";
import {
  STORE_REVIEW_PASSTHROUGH_KEY,
  STORE_REVIEW_SIMULATION_KEY,
  StoreReviewPassthrough,
  StoreReviewSimulation,
} from "./store-review.decorator";
import {
  DEMO_MODE_HEADER,
  DEMO_MODE_SIMULATED,
  StoreReviewInterceptor,
} from "./store-review.interceptor";
import { simulatedDeleteCount } from "./store-review-responses";

interface FakeReq {
  method: string;
  path: string;
  route?: { path: string };
  params?: Record<string, string>;
  body?: unknown;
  user?: { userId?: string; storeReview?: boolean };
}

class Routes {
  @StoreReviewPassthrough()
  passthrough(): void {}

  @StoreReviewSimulation(simulatedDeleteCount)
  custom(): void {}

  plain(): void {}
}

describe("StoreReviewInterceptor", () => {
  const interceptor = new StoreReviewInterceptor(new Reflector());
  const setHeader = jest.fn();
  const handled = { real: true };
  let handle: jest.Mock;

  const context = (
    req: FakeReq,
    handler: () => void = Routes.prototype.plain,
    type = "http",
  ): ExecutionContext =>
    ({
      getType: () => type,
      getHandler: () => handler,
      getClass: () => Routes,
      switchToHttp: () => ({
        // Express always sets `params` (empty without route parameters).
        getRequest: () => ({ params: {}, ...req }),
        getResponse: () => ({ setHeader }),
      }),
    }) as unknown as ExecutionContext;

  const run = (ctx: ExecutionContext) =>
    lastValueFrom(
      interceptor.intercept(ctx, { handle: () => handle() } as CallHandler),
    );

  const reviewer = { userId: "review-1", storeReview: true };

  beforeEach(() => {
    setHeader.mockClear();
    handle = jest.fn(() => of(handled));
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "simulates a %s of the store-review account without running the handler",
    async (method) => {
      const result = await run(
        context({
          method,
          path: "/api/v1/users/me",
          route: { path: "/api/v1/users/me" },
          params: {},
          body: { firstName: "Ann" },
          user: reviewer,
        }),
      );
      expect(handle).not.toHaveBeenCalled();
      expect(setHeader).toHaveBeenCalledWith(
        DEMO_MODE_HEADER,
        DEMO_MODE_SIMULATED,
      );
      expect(result).toMatchObject({
        firstName: "Ann",
        success: true,
        simulated: true,
      });
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])(
    "lets a %s of the store-review account run",
    async (method) => {
      await expect(
        run(context({ method, path: "/x", user: reviewer })),
      ).resolves.toEqual(handled);
      expect(handle).toHaveBeenCalled();
      expect(setHeader).not.toHaveBeenCalled();
    },
  );

  it("masks other people's personal data in what the account reads", async () => {
    handle = jest.fn(() =>
      of({
        data: [
          { id: "u2", email: "jane@x.fr", lastName: "Doe" },
          { id: "review-1", email: "licensee@test.com", lastName: "Licencié" },
        ],
      }),
    );
    await expect(
      run(context({ method: "GET", path: "/admin/users", user: reviewer })),
    ).resolves.toEqual({
      data: [
        { id: "u2", email: "masque@exemple.invalid", lastName: "D." },
        { id: "review-1", email: "licensee@test.com", lastName: "Licencié" },
      ],
    });
  });

  it("does not mask the reads of a regular account", async () => {
    const body = { id: "u2", email: "jane@x.fr" };
    handle = jest.fn(() => of(body));
    await expect(
      run(
        context({
          method: "GET",
          path: "/admin/users/u2",
          user: { userId: "admin-1", storeReview: false },
        }),
      ),
    ).resolves.toBe(body);
  });

  it("lets a regular account write", async () => {
    await expect(
      run(
        context({
          method: "POST",
          path: "/x",
          user: { userId: "u1", storeReview: false },
        }),
      ),
    ).resolves.toBe(handled);
  });

  it("lets an unauthenticated request run (login, refresh, logout…)", async () => {
    await expect(
      run(context({ method: "POST", path: "/auth/login" })),
    ).resolves.toBe(handled);
  });

  it("ignores non-HTTP contexts", async () => {
    await expect(
      run(
        context(
          { method: "POST", path: "/x", user: reviewer },
          Routes.prototype.plain,
          "rpc",
        ),
      ),
    ).resolves.toBe(handled);
  });

  it("runs a route marked @StoreReviewPassthrough for real", async () => {
    await expect(
      run(
        context(
          { method: "POST", path: "/auth/impersonate", user: reviewer },
          Routes.prototype.passthrough,
        ),
      ),
    ).resolves.toEqual(handled);
    expect(handle).toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });

  it("uses the route's @StoreReviewSimulation body", async () => {
    await expect(
      run(
        context(
          { method: "DELETE", path: "/notifications", user: reviewer },
          Routes.prototype.custom,
        ),
      ),
    ).resolves.toEqual({ count: 0, success: true, simulated: true });
  });

  it("uses the route :id and tolerates missing params, body and userId", async () => {
    const result = (await run(
      context({
        method: "PATCH",
        path: "/tracks/t1",
        params: { id: "t1" },
        user: { storeReview: true },
      }),
    )) as Record<string, unknown>;
    expect(result.id).toBe("t1");

    const noParams = (await run(
      context({ method: "POST", path: "/reports", user: reviewer }),
    )) as Record<string, unknown>;
    expect(typeof noParams.id).toBe("string");
  });

  it("stores its metadata under the documented keys", () => {
    const reflector = new Reflector();
    expect(
      reflector.get<boolean>(
        STORE_REVIEW_PASSTHROUGH_KEY,
        Routes.prototype.passthrough,
      ),
    ).toBe(true);
    expect(
      reflector.get(STORE_REVIEW_SIMULATION_KEY, Routes.prototype.custom),
    ).toBe(simulatedDeleteCount);
  });
});
