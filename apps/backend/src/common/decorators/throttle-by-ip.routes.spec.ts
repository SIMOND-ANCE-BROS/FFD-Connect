import { GUARDS_METADATA } from "@nestjs/common/constants";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../../auth/optional-jwt-auth.guard";
import { THROTTLE_BY_IP_KEY } from "./throttle-by-ip.decorator";

/** Metadata key written by `@Throttle({ default: … })` (@nestjs/throttler). */
const ROUTE_LIMIT_KEY = "THROTTLER:LIMITdefault";
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

const isAuthGuard = (guard: unknown) =>
  typeof guard === "function" &&
  [JwtAuthGuard, OptionalJwtAuthGuard].some(
    (auth) => guard === auth || (guard.prototype as unknown) instanceof auth,
  );

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
    const missing: string[] = [];
    for (const ctrl of all) {
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = ctrl.prototype[name];
        if (name === "constructor" || typeof handler !== "function") continue;
        const fn = handler as Handler;
        const ownLimit =
          Reflect.hasMetadata(ROUTE_LIMIT_KEY, fn) ||
          Reflect.hasMetadata(ROUTE_LIMIT_KEY, ctrl);
        if (!ownLimit) continue;
        const authenticated = [...guardsOf(ctrl), ...guardsOf(fn)].some(
          isAuthGuard,
        );
        const byIp =
          Reflect.getMetadata(THROTTLE_BY_IP_KEY, fn) === true ||
          Reflect.getMetadata(THROTTLE_BY_IP_KEY, ctrl) === true;
        if (!authenticated && !byIp) missing.push(`${ctrl.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
