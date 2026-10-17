import { EventEmitter } from "events";
import type { Request, Response } from "express";
import {
  ImpersonationActionLogMiddleware,
  routeTemplateOf,
  UNMATCHED_ROUTE,
} from "./impersonation-action-log.middleware";
import type { ImpersonationActionLogService } from "./impersonation-action-log.service";

describe("ImpersonationActionLogMiddleware (#761)", () => {
  const record = jest.fn().mockResolvedValue(undefined);
  const middleware = new ImpersonationActionLogMiddleware({
    record,
  } as unknown as ImpersonationActionLogService);

  const impersonated = {
    userId: "target",
    impersonatedBy: "admin-1",
    impersonationLogId: "log-1",
  };

  /** Runs one request through the middleware, then lets `apply` act on it. */
  function run(
    method: string,
    apply: (req: Record<string, unknown>, res: Response) => void = () => {},
  ) {
    const req: Record<string, unknown> = { method };
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
    }) as unknown as Response;
    const next = jest.fn();
    middleware.use(req as unknown as Request, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    apply(req, res);
    res.emit("close");
    return { req, res };
  }

  beforeEach(() => {
    record.mockClear();
  });

  it("journals a write made under impersonation, with its route template and status", () => {
    run("patch", (req, res) => {
      req.user = impersonated;
      req.route = { path: "/api/v1/competitions/:id/unregister" };
      res.statusCode = 403;
    });
    expect(record).toHaveBeenCalledWith({
      impersonationLogId: "log-1",
      method: "PATCH",
      route: "/competitions/:id/unregister",
      statusCode: 403,
    });
  });

  it("journals only once even if close fires again", () => {
    const { res } = run("POST", (req) => {
      req.user = impersonated;
      req.route = { path: "/api/v1/clubs/me/partnerships" };
    });
    res.emit("close");
    expect(record).toHaveBeenCalledTimes(1);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("ignores %s requests", (method) => {
    run(method, (req) => {
      req.user = impersonated;
      req.route = { path: "/api/v1/users/me" };
    });
    expect(record).not.toHaveBeenCalled();
  });

  it("ignores the account's own writes and unauthenticated requests", () => {
    run("POST", (req) => {
      req.user = { userId: "u1" };
    });
    run("POST");
    expect(record).not.toHaveBeenCalled();
  });

  it("ignores an impersonation claim without a journal row", () => {
    run("POST", (req) => {
      req.user = { userId: "target", impersonatedBy: "admin-1" };
    });
    // A session id without impersonatedBy is not an impersonation either.
    run("POST", (req) => {
      req.user = { userId: "target", impersonationLogId: "log-1" };
    });
    expect(record).not.toHaveBeenCalled();
  });

  describe("routeTemplateOf", () => {
    const of = (route: unknown) =>
      routeTemplateOf({ route } as unknown as Request);

    it("strips the global prefix", () => {
      expect(of({ path: "/api/v1/users/me" })).toBe("/users/me");
      expect(of({ path: "/api/v1" })).toBe("/");
    });

    it("keeps a path outside the prefix as is", () => {
      expect(of({ path: "/health" })).toBe("/health");
    });

    it("never falls back to the raw URL when no route matched", () => {
      expect(of(undefined)).toBe(UNMATCHED_ROUTE);
      expect(of({ path: /regex/ })).toBe(UNMATCHED_ROUTE);
    });
  });
});
