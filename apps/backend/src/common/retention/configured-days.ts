import { ConfigService } from "@nestjs/config";

/**
 * Integer number of days in [min, max] read from the config, or `fallback`
 * (unset, not an integer, out of bounds). Shared by the retention purges
 * (#731, #741); env.validation.ts refuses an invalid value at boot anyway.
 */
export function configuredDays(
  configService: ConfigService,
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const raw: unknown = configService.get(key);
  const days = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof days === "number" &&
    Number.isInteger(days) &&
    days >= min &&
    days <= max
    ? days
    : fallback;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
