import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { generateKeyPairSync } from "crypto";
import {
  buildEntryQr,
  ENTRY_QR_BATCH_HOURS,
  ENTRY_QR_STEP_SECONDS,
  entryQrStep,
  parseEntryQr,
  signEntryQrStep,
} from "./entry-qr";
import {
  ACTIVE_TEST_KEY_LABEL,
  ENTRY_QR_GOLDEN_VECTOR as GOLDEN,
  RETIRED_TEST_KEY_LABEL,
  testEntryQrPem,
  testEntryQrPrivateKey,
} from "./entry-qr-test-keys.mock";
import { EntryQrService } from "./entry-qr.service";
import { parisEndOfDay } from "./license-qr";

const PEM = testEntryQrPem(ACTIVE_TEST_KEY_LABEL);
const SUBJECT = GOLDEN.subject;
const NOW = new Date("2026-10-16T08:00:10.000Z");
const FAR_VALIDITY = new Date("2027-08-31T22:00:00.000Z");

function makeService(env: Record<string, string | undefined>) {
  const config = {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
  return new EntryQrService(config);
}

function qrFromBatch(service: EntryQrService, index: number, now = NOW) {
  const batch = service.issueBatch(SUBJECT, FAR_VALIDITY, now);
  if (!batch) throw new Error("expected a batch");
  const qr = buildEntryQr(
    batch.keyId,
    SUBJECT,
    batch.firstStep + index,
    batch.signatures[index],
  );
  const parsed = parseEntryQr(qr);
  if (parsed.kind !== "entry") throw new Error("expected an entry QR");
  return { batch, payload: parsed.payload };
}

describe("EntryQrService", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("configuration", () => {
    it("is off without a key, and says so without failing the boot", () => {
      const service = makeService({});
      expect(service.canIssue()).toBe(false);
      expect(service.canVerify()).toBe(false);
      expect(service.getKeySet().keys).toEqual([]);
      expect(service.issueBatch(SUBJECT, FAR_VALIDITY, NOW)).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Rotating entry QR disabled"),
      );
    });

    it("treats a blank key as absent", () => {
      expect(makeService({ ENTRY_QR_SIGNING_KEY: "   " }).canIssue()).toBe(
        false,
      );
    });

    it("loads an Ed25519 PKCS#8 PEM and publishes its public key", () => {
      const service = makeService({ ENTRY_QR_SIGNING_KEY: PEM });
      expect(service.canIssue()).toBe(true);
      expect(service.canVerify()).toBe(true);
      expect(service.getKeySet()).toEqual({
        version: 3,
        stepSeconds: 30,
        toleranceSteps: 1,
        keys: [
          { kid: GOLDEN.keyId, publicKey: GOLDEN.publicKey, active: true },
        ],
      });
    });

    it("accepts a single-line PEM with literal \\n", () => {
      const service = makeService({
        ENTRY_QR_SIGNING_KEY: PEM.replace(/\n/g, "\\n"),
      });
      expect(service.canIssue()).toBe(true);
    });

    it("ignores a key that is not PEM, without logging it", () => {
      const service = makeService({
        ENTRY_QR_SIGNING_KEY: "not-a-key-material",
      });
      expect(service.canIssue()).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).not.toContain(
        "not-a-key-material",
      );
    });

    it("ignores a private key of another type", () => {
      const { privateKey } = generateKeyPairSync("x25519");
      const service = makeService({
        ENTRY_QR_SIGNING_KEY: privateKey
          .export({ format: "pem", type: "pkcs8" })
          .toString(),
      });
      expect(service.canIssue()).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("unexpected key type x25519"),
      );
    });

    it("publishes and accepts retired keys, skipping invalid and duplicate ones", () => {
      const service = makeService({
        ENTRY_QR_SIGNING_KEY: PEM,
        ENTRY_QR_RETIRED_PUBLIC_KEYS: ` ${GOLDEN.retiredPublicKey}, ,garbage,${GOLDEN.publicKey},${GOLDEN.retiredPublicKey}`,
      });
      expect(service.getKeySet().keys).toEqual([
        { kid: GOLDEN.keyId, publicKey: GOLDEN.publicKey, active: true },
        {
          kid: expect.any(String),
          publicKey: GOLDEN.retiredPublicKey,
          active: false,
        },
      ]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("can verify with retired keys only (signing key removed)", () => {
      const service = makeService({
        ENTRY_QR_RETIRED_PUBLIC_KEYS: GOLDEN.publicKey,
      });
      expect(service.canIssue()).toBe(false);
      expect(service.canVerify()).toBe(true);
    });

    it("returns a copy of the published keys", () => {
      const service = makeService({ ENTRY_QR_SIGNING_KEY: PEM });
      service.getKeySet().keys.pop();
      expect(service.getKeySet().keys).toHaveLength(1);
    });
  });

  describe("issueBatch", () => {
    const service = () => makeService({ ENTRY_QR_SIGNING_KEY: PEM });

    it("signs one token per 30-second step over 12 hours", () => {
      const batch = service().issueBatch(SUBJECT, FAR_VALIDITY, NOW);
      const steps = (ENTRY_QR_BATCH_HOURS * 3600) / ENTRY_QR_STEP_SECONDS;
      expect(batch).toMatchObject({
        version: 3,
        keyId: GOLDEN.keyId,
        licenseId: SUBJECT.licenseId,
        number: SUBJECT.number,
        holderName: SUBJECT.holderName,
        stepSeconds: 30,
        toleranceSteps: 1,
        firstStep: entryQrStep(NOW),
      });
      // NOW is 10 s into its step: the 12 h horizon ends inside a step.
      expect(batch?.signatures).toHaveLength(steps + 1);
      expect(batch?.coversUntil.getTime()).toBeGreaterThanOrEqual(
        NOW.getTime() + ENTRY_QR_BATCH_HOURS * 3600 * 1000,
      );
      expect(new Set(batch?.signatures).size).toBe(batch?.signatures.length);
    });

    it("signs exactly the steps it claims", () => {
      const s = service();
      const { batch, payload } = qrFromBatch(s, 100);
      expect(payload.t).toBe(batch.firstStep + 100);
      const at = new Date(payload.t * ENTRY_QR_STEP_SECONDS * 1000 + 5_000);
      expect(s.verify(payload, at)).toBe("VALID");
      expect(
        signEntryQrStep(
          testEntryQrPrivateKey(ACTIVE_TEST_KEY_LABEL),
          batch.keyId,
          SUBJECT,
          payload.t,
        ),
      ).toBe(payload.sig);
    });

    it("never reaches past the end of the licence validity day (Paris)", () => {
      const validUntil = new Date("2026-10-16T10:00:00.000Z");
      const afternoon = new Date("2026-10-16T15:00:10.000Z");
      const batch = service().issueBatch(SUBJECT, validUntil, afternoon);
      const end = parisEndOfDay("2026-10-16");
      expect(batch?.coversUntil.getTime()).toBe(end.getTime());
      const lastStep =
        (batch?.firstStep ?? 0) + (batch?.signatures.length ?? 0) - 1;
      expect((lastStep + 1) * ENTRY_QR_STEP_SECONDS * 1000).toBe(end.getTime());
    });

    it("issues nothing for an expired licence", () => {
      const expired = new Date("2026-10-14T10:00:00.000Z");
      expect(service().issueBatch(SUBJECT, expired, NOW)).toBeNull();
    });

    it("uses the current time by default", () => {
      const batch = service().issueBatch(SUBJECT, FAR_VALIDITY);
      expect(batch?.firstStep).toBe(entryQrStep(new Date()));
    });
  });

  describe("verify", () => {
    it("accepts a token of the batch during its step, refuses it later", () => {
      const s = makeService({ ENTRY_QR_SIGNING_KEY: PEM });
      const { payload } = qrFromBatch(s, 0);
      expect(s.verify(payload, NOW)).toBe("VALID");
      expect(s.verify(payload, new Date(NOW.getTime() + 90_000))).toBe("STALE");
    });

    it("accepts a token signed by a retired key after a rotation", () => {
      const old = makeService({
        ENTRY_QR_SIGNING_KEY: testEntryQrPem(RETIRED_TEST_KEY_LABEL),
      });
      const { payload } = qrFromBatch(old, 0);
      const rotated = makeService({
        ENTRY_QR_SIGNING_KEY: PEM,
        ENTRY_QR_RETIRED_PUBLIC_KEYS: GOLDEN.retiredPublicKey,
      });
      expect(rotated.verify(payload, NOW)).toBe("VALID");
      expect(
        makeService({ ENTRY_QR_SIGNING_KEY: PEM }).verify(payload, NOW),
      ).toBe("INVALID_SIGNATURE");
    });

    it("cannot verify anything when off", () => {
      const { payload } = qrFromBatch(
        makeService({ ENTRY_QR_SIGNING_KEY: PEM }),
        0,
      );
      expect(makeService({}).verify(payload, NOW)).toBe("INVALID_SIGNATURE");
    });
  });
});
