import type { DanceCapability } from "@ffd-connect/shared";

/**
 * Runtime list of the dance capabilities (ADR-0026, #1022).
 *
 * The source of truth is `DANCE_CAPABILITIES` in `@ffd-connect/shared`, but
 * the backend may only import TYPES from that package: `nest build` rewrites
 * the `@ffd-connect/shared` path alias into a relative path to
 * `packages/shared`, which does not exist in the production image (and the
 * package is not linked in node_modules with `symlink=false`), so a value
 * import would crash at boot.
 *
 * This record keeps the copy honest at compile time: a capability missing
 * here, or one unknown to the shared type, fails `tsc`. The spec also checks
 * the order against the shared list.
 */
const CAPABILITY_FLAGS: Record<DanceCapability, true> = {
  COUPLE: true,
  TEAM: true,
  PASSPORT: true,
  COMPETITION_LEVELS: true,
  TEMPO_PLAYER: true,
  COMPETITION_SKATING: true,
};

/** Every capability known to this version of the backend, in shared order. */
export const KNOWN_DANCE_CAPABILITIES = Object.keys(
  CAPABILITY_FLAGS,
) as DanceCapability[];

/** True when the stored value is a capability this backend knows. */
export function isKnownDanceCapability(
  value: string,
): value is DanceCapability {
  return Object.hasOwn(CAPABILITY_FLAGS, value);
}

/**
 * Known capabilities of a domain, in stored order, without duplicates. A
 * value this version of the code does not know (written by a newer revision,
 * or a typo in the data) is dropped rather than served: clients only act on
 * capabilities they can rely on.
 */
export function knownCapabilities(
  stored: readonly string[],
): DanceCapability[] {
  return [...new Set(stored.filter(isKnownDanceCapability))];
}
