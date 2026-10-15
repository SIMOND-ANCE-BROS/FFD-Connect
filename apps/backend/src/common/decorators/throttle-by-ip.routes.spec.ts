import { Controller, UseGuards } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Throttle } from "@nestjs/throttler";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { AuthController } from "../../auth/auth.controller";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../../auth/optional-jwt-auth.guard";
import { LicensesController } from "../../licenses/licenses.controller";
import { ReportsController } from "../../reports/reports.controller";
import { ThrottlerUserGuard } from "../guards/throttler-user.guard";
import { THROTTLE_BY_IP_KEY, ThrottleByIp } from "./throttle-by-ip.decorator";

/** Prefix of the keys written by `@Throttle({ <name>: … })` (@nestjs/throttler). */
const ROUTE_LIMIT_PREFIX = "THROTTLER:LIMIT";
const SRC = join(__dirname, "..", "..");

type Handler = (...args: unknown[]) => unknown;
type ControllerClass = { name: string; prototype: Record<string, unknown> };

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith(".controller.ts") ? [path] : [];
  });
}

function controllers(): ControllerClass[] {
  return controllerFiles(SRC).flatMap((file) =>
    Object.values(require(file) as Record<string, unknown>).filter(
      (value): value is ControllerClass =>
        typeof value === "function" &&
        Reflect.hasMetadata("path", value as object),
    ),
  );
}

function guardsOf(target: object): unknown[] {
  return (
    (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ??
    []
  );
}

/**
 * Only JwtAuthGuard makes a route authenticated: OptionalJwtAuthGuard lets
 * anonymous callers through, so such a route is public.
 */
const isAuthGuard = (guard: unknown) =>
  typeof guard === "function" &&
  (guard === JwtAuthGuard ||
    (guard.prototype as unknown) instanceof JwtAuthGuard);

const hasOwnLimit = (target: object) =>
  Reflect.getMetadataKeys(target).some(
    (key) => typeof key === "string" && key.startsWith(ROUTE_LIMIT_PREFIX),
  );

/** Route handlers of a controller, inherited ones included. */
function handlersOf(ctrl: ControllerClass): [string, Handler][] {
  const seen = new Map<string, Handler>();
  for (
    let proto: unknown = ctrl.prototype;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const value = (proto as Record<string, unknown>)[name];
      if (
        name !== "constructor" &&
        typeof value === "function" &&
        !seen.has(name)
      ) {
        seen.set(name, value as Handler);
      }
    }
  }
  return [...seen];
}

function unmarkedPublicLimits(ctrls: ControllerClass[]): string[] {
  const missing: string[] = [];
  for (const ctrl of ctrls) {
    for (const [name, fn] of handlersOf(ctrl)) {
      if (!hasOwnLimit(fn) && !hasOwnLimit(ctrl)) continue;
      const authenticated = [...guardsOf(ctrl), ...guardsOf(fn)].some(
        isAuthGuard,
      );
      const byIp =
        Reflect.getMetadata(THROTTLE_BY_IP_KEY, fn) === true ||
        Reflect.getMetadata(THROTTLE_BY_IP_KEY, ctrl) === true;
      if (!authenticated && !byIp) missing.push(`${ctrl.name}.${name}`);
    }
  }
  return missing;
}

/**
 * #633: the global throttler counts a request with a valid access token per
 * user. A public route that sets its own limit is an anti-abuse limit aimed at
 * anonymous callers (login, register, Wallet links…): it must stay per IP, or
 * an attacker holding several accounts gets one budget per account.
 */
describe("@ThrottleByIp() on public routes with their own limit", () => {
  const all = controllers();

  it("finds the application controllers", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it("marks every unauthenticated route that declares @Throttle", () => {
    expect(unmarkedPublicLimits(all)).toEqual([]);
  });
});

describe("unmarkedPublicLimits (scan self-test)", () => {
  class Base {
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    inherited(): void {}
  }

  @Controller("scan-a")
  class Child extends Base {
    @UseGuards(OptionalJwtAuthGuard)
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    optional(): void {}

    @Throttle({ burst: { ttl: 1_000, limit: 2 } })
    named(): void {}

    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    authenticated(): void {}

    @ThrottleByIp()
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    marked(): void {}

    unlimited(): void {}
  }

  it("flags OptionalJwtAuthGuard, named throttlers and inherited handlers", () => {
    expect(
      unmarkedPublicLimits([Child as unknown as ControllerClass]).sort(),
    ).toEqual(["Child.inherited", "Child.named", "Child.optional"]);
  });
});

/** Dedicated limits added with #633. */
describe("dedicated route limits", () => {
  const limitOf = (fn: object) => ({
    limit: Reflect.getMetadata("THROTTLER:LIMITdefault", fn) as unknown,
    ttl: Reflect.getMetadata("THROTTLER:TTLdefault", fn) as unknown,
  });

  it("POST /auth/change-password: 5/min per user", () => {
    const fn = AuthController.prototype.changePassword;
    expect(limitOf(fn)).toEqual({ limit: 5, ttl: 60_000 });
    expect(guardsOf(fn)).toContain(ThrottlerUserGuard);
    expect(guardsOf(fn).indexOf(ThrottlerUserGuard)).toBeGreaterThan(
      guardsOf(fn).indexOf(JwtAuthGuard),
    );
  });

  it("POST /reports: 10/min per IP", () => {
    const fn = ReportsController.prototype.create;
    expect(limitOf(fn)).toEqual({ limit: 10, ttl: 60_000 });
    expect(Reflect.getMetadata(THROTTLE_BY_IP_KEY, fn)).toBe(true);
  });

  it("POST /licenses/renewal/:id/documents (paid OCR): 10/min per user", () => {
    const fn = LicensesController.prototype.uploadRenewalDocument;
    expect(limitOf(fn)).toEqual({ limit: 10, ttl: 60_000 });
    expect(guardsOf(fn)).toContain(ThrottlerUserGuard);
    expect(guardsOf(LicensesController)).toContain(JwtAuthGuard);
  });
});
