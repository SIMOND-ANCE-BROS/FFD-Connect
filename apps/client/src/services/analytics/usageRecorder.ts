/**
 * Mesure d'audience anonyme (lot 5). Tampon local + identifiant d'installation
 * aléatoire renouvelé chaque mois, jamais lié au compte. L'envoi ne se fait
 * QUE quand le backend est déjà réveillé (juste après une réponse API réussie,
 * ou au passage en arrière-plan si une réponse a réussi il y a moins de 5 min) :
 * jamais de minuterie, jamais de réveil du backend scale-to-zero.
 */
import type { AnalyticsEventName } from "./types";

export type UsageSpace = "LICENSEE" | "CLUB" | "STAFF" | "ADMIN" | "GUEST";
export interface UsageContext {
  space: UsageSpace;
  storeReview: boolean;
}
export interface UsageInput {
  name: AnalyticsEventName;
  screen?: string;
  competitionId?: string;
  durationSec?: number;
  occurredAt?: Date;
}
export interface UsageRecord {
  installId: string;
  name: AnalyticsEventName;
  screen?: string;
  occurredAt: string;
  platform: "ios" | "android";
  appVersion: string;
  space: UsageSpace;
  competitionId?: string;
  durationSec?: number;
}
export interface UsageStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface UsageDeps {
  storage: UsageStorage;
  now: () => Date;
  random: () => number;
  /** null on web: nothing is recorded. */
  platform: "ios" | "android" | null;
  appVersion: string;
  context: () => UsageContext;
  /** POSTs the batch; resolves the HTTP status (0 on network error). */
  send: (events: UsageRecord[]) => Promise<number>;
}
export interface UsageRecorder {
  record(input: UsageInput): Promise<void>;
  /** Marks the backend awake; resolves when the flush it may trigger is done. */
  onApiSuccess(): Promise<void>;
  onBackground(): Promise<void>;
  setEnabled(on: boolean): Promise<void>;
  isEnabled(): Promise<boolean>;
  clear(): Promise<void>;
}

export const USAGE_KEYS = {
  buffer: "usage_buffer",
  install: "usage_install",
  optOut: "usage_opt_out",
} as const;
export const USAGE_LIMITS = {
  buffer: 500,
  batch: 200,
  flushEveryMs: 120_000,
  backgroundWindowMs: 300_000,
  maxDurationSec: 1800,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCREEN = /^[A-Za-z0-9_]{1,64}$/;

/** UUID v4 from a uniform random source: not a secret, only a counting key. */
export function uuidV4(random: () => number): string {
  const h = Array.from({ length: 32 }, () => Math.floor(random() * 16));
  h[12] = 4;
  h[16] = (h[16] & 0x3) | 0x8;
  const s = h.map((x) => x.toString(16)).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const monthOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const toMinute = (d: Date) =>
  new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();

export function createUsageRecorder(deps: UsageDeps): UsageRecorder {
  const { storage } = deps;
  let lastSuccessAt = Number.NEGATIVE_INFINITY;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  // Serialises every storage read-modify-write (record, flush, opt-out).
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const readBuffer = async (): Promise<UsageRecord[]> => {
    try {
      const raw = await storage.getItem(USAGE_KEYS.buffer);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as UsageRecord[]) : [];
    } catch {
      return [];
    }
  };
  const writeBuffer = (events: UsageRecord[]) =>
    events.length
      ? storage.setItem(USAGE_KEYS.buffer, JSON.stringify(events))
      : storage.removeItem(USAGE_KEYS.buffer);

  const isEnabled = async () =>
    (await storage.getItem(USAGE_KEYS.optOut)) !== "1";

  const installId = async (now: Date): Promise<string> => {
    const month = monthOf(now);
    try {
      const raw = await storage.getItem(USAGE_KEYS.install);
      const saved = raw
        ? (JSON.parse(raw) as { id?: string; month?: string })
        : null;
      if (saved?.id && saved.month === month) return saved.id;
    } catch {
      // corrupted entry: draw a new one
    }
    const id = uuidV4(deps.random);
    await storage.setItem(USAGE_KEYS.install, JSON.stringify({ id, month }));
    return id;
  };

  const record = (input: UsageInput) =>
    serial(async () => {
      if (!deps.platform) return;
      const ctx = deps.context();
      if (ctx.storeReview || !(await isEnabled())) return;
      const now = deps.now();
      const event: UsageRecord = {
        installId: await installId(now),
        name: input.name,
        occurredAt: toMinute(input.occurredAt ?? now),
        platform: deps.platform,
        appVersion: deps.appVersion,
        space: ctx.space,
      };
      if (input.screen && SCREEN.test(input.screen))
        event.screen = input.screen;
      if (input.competitionId && UUID.test(input.competitionId)) {
        event.competitionId = input.competitionId;
      }
      if (input.durationSec !== undefined) {
        event.durationSec = Math.max(
          0,
          Math.min(USAGE_LIMITS.maxDurationSec, Math.round(input.durationSec)),
        );
      }
      const buffer = await readBuffer();
      buffer.push(event);
      await writeBuffer(buffer.slice(-USAGE_LIMITS.buffer));
    });

  const flush = () =>
    serial(async () => {
      const buffer = await readBuffer();
      if (!buffer.length) return;
      const batch = buffer.slice(0, USAGE_LIMITS.batch);
      // The 2-minute spacing counts from the attempt: a failing backend is not hammered.
      lastFlushAt = deps.now().getTime();
      const status = await deps.send(batch).catch(() => 0);
      if ((status >= 200 && status < 300) || status === 400) {
        await writeBuffer(buffer.slice(batch.length));
      }
    });

  return {
    record,
    isEnabled,
    onApiSuccess() {
      const now = deps.now().getTime();
      lastSuccessAt = now;
      return now - lastFlushAt >= USAGE_LIMITS.flushEveryMs
        ? flush()
        : Promise.resolve();
    },
    onBackground() {
      return deps.now().getTime() - lastSuccessAt <=
        USAGE_LIMITS.backgroundWindowMs
        ? flush()
        : Promise.resolve();
    },
    setEnabled: (on) =>
      serial(async () => {
        if (on) {
          await storage.removeItem(USAGE_KEYS.optOut);
          return;
        }
        await storage.setItem(USAGE_KEYS.optOut, "1");
        await storage.removeItem(USAGE_KEYS.buffer);
        await storage.removeItem(USAGE_KEYS.install);
      }),
    clear: () => serial(() => storage.removeItem(USAGE_KEYS.buffer)),
  };
}
