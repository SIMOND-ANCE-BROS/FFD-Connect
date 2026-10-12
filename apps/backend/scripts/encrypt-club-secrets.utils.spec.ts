import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import {
  encryptSecret,
  isEncryptedSecret,
} from "../src/common/crypto/secret-cipher";
import { SecretCipherService } from "../src/common/crypto/secret-cipher.service";
import { clubHelloAssoSecretContext as ctx } from "../src/common/crypto/secret-contexts";
import {
  ClubSecretRow,
  ClubSecretStore,
  migrateClubSecrets,
} from "./encrypt-club-secrets.utils";

const key = randomBytes(32);
const previous = randomBytes(32);

const cipher = (withKey = true) =>
  new SecretCipherService({
    get: (name: string) =>
      ({
        SECRETS_ENCRYPTION_KEY: withKey ? key.toString("base64") : undefined,
        SECRETS_ENCRYPTION_KEY_PREVIOUS: previous.toString("base64"),
      })[name],
  } as unknown as ConfigService);

/** In-memory store with id-cursor pagination, like the Prisma query. */
function memoryStore(rows: ClubSecretRow[]): ClubSecretStore & {
  rows: ClubSecretRow[];
} {
  return {
    rows,
    findPage: async (cursor, take) => {
      const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
      const start = cursor ? sorted.findIndex((r) => r.id === cursor) + 1 : 0;
      return sorted.slice(start, start + take);
    },
    replaceSecret: async (id, prev, next) => {
      const row = rows.find((r) => r.id === id);
      if (row?.helloAssoClientSecret !== prev) return 0;
      row.helloAssoClientSecret = next;
      return 1;
    },
  };
}

describe("migrateClubSecrets (#389)", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("encrypts plaintext and previous-key secrets, keeps the rest, across pages", async () => {
    const store = memoryStore([
      { id: "a", helloAssoClientSecret: "plain-a" },
      { id: "b", helloAssoClientSecret: encryptSecret("sec-b", key, ctx("b")) },
      {
        id: "c",
        helloAssoClientSecret: encryptSecret("sec-c", previous, ctx("c")),
      },
      { id: "d", helloAssoClientSecret: null },
      {
        id: "e",
        helloAssoClientSecret: encryptSecret("x", randomBytes(32), ctx("e")),
      },
    ]);
    const c = cipher();

    const report = await migrateClubSecrets(store, c, 2);

    expect(report).toEqual({
      scanned: 4,
      migrated: 2,
      upToDate: 1,
      skipped: 0,
      failed: ["e"],
    });
    const byId = Object.fromEntries(
      store.rows.map((r) => [r.id, r.helloAssoClientSecret]),
    );
    expect(c.decrypt(byId.a as string, ctx("a"))).toEqual({
      plaintext: "plain-a",
      needsReEncryption: false,
    });
    expect(c.decrypt(byId.c as string, ctx("c")).plaintext).toBe("sec-c");
    expect(c.decrypt(byId.c as string, ctx("c")).needsReEncryption).toBe(false);
    expect(byId.d).toBeNull();
    expect(JSON.stringify(report)).not.toContain("plain-a");
  });

  it("is idempotent: a second run migrates nothing", async () => {
    const store = memoryStore([{ id: "a", helloAssoClientSecret: "plain-a" }]);
    await migrateClubSecrets(store, cipher());
    const first = store.rows[0].helloAssoClientSecret;

    const report = await migrateClubSecrets(store, cipher());

    expect(report.migrated).toBe(0);
    expect(report.upToDate).toBe(1);
    expect(store.rows[0].helloAssoClientSecret).toBe(first);
    expect(isEncryptedSecret(first as string)).toBe(true);
  });

  it("counts a row changed concurrently as skipped", async () => {
    const store = memoryStore([{ id: "a", helloAssoClientSecret: "plain-a" }]);
    store.replaceSecret = async () => 0;

    const report = await migrateClubSecrets(store, cipher());

    expect(report.skipped).toBe(1);
    expect(report.migrated).toBe(0);
  });

  it("fails a ciphertext moved to another club (context bound)", async () => {
    const store = memoryStore([
      { id: "a", helloAssoClientSecret: encryptSecret("sec-b", key, ctx("b")) },
    ]);

    const report = await migrateClubSecrets(store, cipher());

    expect(report.failed).toEqual(["a"]);
    expect(report.migrated).toBe(0);
  });

  it("refuses to run without a key", async () => {
    await expect(
      migrateClubSecrets(memoryStore([]), cipher(false)),
    ).rejects.toThrow("SECRETS_ENCRYPTION_KEY is not set");
  });
});
