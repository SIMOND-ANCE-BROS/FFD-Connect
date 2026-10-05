import * as fs from "fs";
import * as os from "os";

/**
 * Where a Linux container publishes its memory ceiling. Azure Container Apps
 * runs cgroup v2 (first path); the v1 path is kept for older hosts. Neither
 * exists on a macOS dev machine, where `readContainerMemoryLimit` returns null
 * and the caller falls back to the host's RAM.
 */
const CGROUP_LIMIT_FILES = [
  "/sys/fs/cgroup/memory.max", // cgroup v2
  "/sys/fs/cgroup/memory/memory.limit_in_bytes", // cgroup v1
] as const;

export type MemoryLimitSource = "cgroup" | "os";

export interface MemoryLimit {
  /** The ceiling, in bytes. */
  bytes: number;
  /** "cgroup" = a real container limit. "os" = no cap found, host RAM used. */
  source: MemoryLimitSource;
}

/**
 * The container's memory limit in bytes, or null when the process is not
 * capped by a cgroup: file absent (dev machine), cgroup v2 `max`, or a
 * sentinel larger than the host's RAM — how both cgroup versions spell
 * "unlimited" (v1 writes 0x7FFFFFFFFFFFF000).
 */
export function readContainerMemoryLimit(): number | null {
  for (const file of CGROUP_LIMIT_FILES) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8").trim();
    } catch {
      continue; // Not this cgroup version — or not a Linux container at all.
    }
    if (raw === "max") {
      return null; // cgroup v2, explicitly uncapped.
    }
    const bytes = Number(raw);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      continue;
    }
    return bytes > os.totalmem() ? null : bytes;
  }
  return null;
}

/**
 * The ceiling the process is actually judged against: the container limit when
 * there is one, the host's RAM otherwise. `source` says which, so a reader can
 * tell a real container figure from a dev-machine approximation.
 */
export function resolveMemoryLimit(): MemoryLimit {
  const containerLimit = readContainerMemoryLimit();
  return containerLimit !== null
    ? { bytes: containerLimit, source: "cgroup" }
    : { bytes: os.totalmem(), source: "os" };
}

/**
 * `value / total` as a percentage with one decimal, so a process using 0.4 % of
 * a large machine does not read as a flat 0.
 */
export function toPercent(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.round((value / total) * 1000) / 10;
}
