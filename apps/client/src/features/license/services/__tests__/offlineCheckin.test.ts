import { Alert } from "react-native";
import { EntryQrApi } from "../../../../services/api/entry-qr-api";
import { enqueueMutation } from "../../../../services/offlineQueueStorage";
import type { PendingMutation } from "../../../../services/offlineQueueStorage";
import type { EntryQrKeySet } from "../../utils/entryQr";
import { loadEntryQrKeys, saveEntryQrKeys } from "../../utils/entryQrStorage";
import api from "../../../../services/api";
import {
  loadQueue,
  removeMutations,
} from "../../../../services/offlineQueueStorage";
import {
  CHECKIN_KIND,
  checkInOffline,
  handleCheckinReplayError,
  OFFLINE_CHECKIN_MAX_AGE_MS,
  OFFLINE_CHECKIN_MESSAGES,
  OfflineCheckinExpiredError,
  purgeExpiredCheckins,
  refreshEntryQrKeys,
  replayCheckin,
} from "../offlineCheckin";

jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
jest.mock("../../../../services/api/entry-qr-api", () => ({
  EntryQrApi: { getKeys: jest.fn() },
}));
jest.mock("../../../../services/offlineQueueStorage", () => ({
  enqueueMutation: jest.fn(),
  loadQueue: jest.fn(),
  removeMutations: jest.fn(),
}));
jest.mock("../../utils/entryQrStorage", () => ({
  loadEntryQrKeys: jest.fn(),
  saveEntryQrKeys: jest.fn(),
}));

/** Golden vector shared with the backend (see entryQr.test.ts). */
const KEY_SET: EntryQrKeySet = {
  version: 3,
  stepSeconds: 30,
  toleranceSteps: 1,
  keys: [
    {
      kid: "b3N-LHLYjEQ",
      publicKey: "9-F1bePZBCVLj1_wx1vDM4oUqMIMXMz2xnV_qPPSWMU",
      active: true,
    },
  ],
};
const STEP = 59612345;
const QR = JSON.stringify({
  v: 3,
  k: "b3N-LHLYjEQ",
  id: "FFD-123456",
  lid: "3f0c6d2e-1111-4222-8333-944445555666",
  nm: "DUPONT Jean",
  t: STEP,
  sig: "3h1jMAEGstTWD3uvtfG1NXqD0IR7dctIYDbx0B_lhnR4LbxgWl3h91Aurw1say6UvJav1q1iUT8TkHRukZERCg",
});
const NOW = new Date((STEP * 30 + 5) * 1000);

const loadKeys = loadEntryQrKeys as jest.Mock;
const enqueue = enqueueMutation as jest.Mock;

describe("offlineCheckin (#24)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadKeys.mockResolvedValue(KEY_SET);
    enqueue.mockResolvedValue("enqueued");
  });

  describe("refreshEntryQrKeys", () => {
    it("caches freshly downloaded keys", async () => {
      (EntryQrApi.getKeys as jest.Mock).mockResolvedValue(KEY_SET);
      await expect(refreshEntryQrKeys()).resolves.toBe(KEY_SET);
      expect(saveEntryQrKeys).toHaveBeenCalledWith(KEY_SET);
    });

    it("falls back to the cache offline or when the feature is off", async () => {
      (EntryQrApi.getKeys as jest.Mock).mockResolvedValueOnce(null);
      await expect(refreshEntryQrKeys()).resolves.toBe(KEY_SET);
      (EntryQrApi.getKeys as jest.Mock).mockResolvedValueOnce({
        ...KEY_SET,
        keys: [],
      });
      await expect(refreshEntryQrKeys()).resolves.toBe(KEY_SET);
      expect(saveEntryQrKeys).not.toHaveBeenCalled();
    });
  });

  describe("checkInOffline", () => {
    it("verifies a fresh QR and queues the check-in with its scan time", async () => {
      const result = await checkInOffline({
        qrData: QR,
        endpoint: "POST /competitions/c1/checkin",
        competitionId: "c1",
        now: NOW,
      });
      expect(result).toEqual({
        status: "VALID",
        holderName: "DUPONT Jean",
        licenseNumber: "FFD-123456",
        queued: true,
      });
      expect(enqueue).toHaveBeenCalledWith({
        endpoint: "POST /competitions/c1/checkin",
        payload: { qrData: QR, scannedAt: NOW.toISOString() },
        queryKeysToInvalidate: [],
        kind: CHECKIN_KIND,
        collapseKey: "checkin:c1:3f0c6d2e-1111-4222-8333-944445555666",
        meta: { holderName: "DUPONT Jean" },
      });
    });

    it("adds the volunteer fields to the queued payload", async () => {
      await checkInOffline({
        qrData: QR,
        endpoint: "POST /competitions/checkin/volunteer",
        payload: { competitionId: "c1", token: "t" },
        competitionId: "c1",
        now: NOW,
      });
      expect(enqueue.mock.calls[0][0].payload).toEqual({
        competitionId: "c1",
        token: "t",
        qrData: QR,
        scannedAt: NOW.toISOString(),
      });
    });

    it("counts a second scan of the same licence as queued", async () => {
      enqueue.mockResolvedValue("duplicate");
      const result = await checkInOffline({
        qrData: QR,
        endpoint: "POST /competitions/c1/checkin",
        competitionId: "c1",
        now: NOW,
      });
      expect(result.queued).toBe(true);
    });

    it("reports a collapsed entry as not queued", async () => {
      enqueue.mockResolvedValue("collapsed");
      const result = await checkInOffline({
        qrData: QR,
        endpoint: "POST /competitions/c1/checkin",
        competitionId: "c1",
        now: NOW,
      });
      expect(result.queued).toBe(false);
    });

    it("only verifies when nothing can be queued", async () => {
      const result = await checkInOffline({
        qrData: QR,
        endpoint: null,
        now: NOW,
      });
      expect(result).toMatchObject({ status: "VALID", queued: false });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("never queues a stale QR", async () => {
      const result = await checkInOffline({
        qrData: QR,
        endpoint: "POST /competitions/c1/checkin",
        competitionId: "c1",
        now: new Date((STEP + 4) * 30 * 1000),
      });
      expect(result).toEqual({
        status: "STALE",
        holderName: "DUPONT Jean",
        licenseNumber: "FFD-123456",
        queued: false,
      });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("cannot vouch for a static QR", async () => {
      const result = await checkInOffline({
        qrData: '{"v":2,"id":"FFD-1"}',
        endpoint: "POST /competitions/c1/checkin",
        competitionId: "c1",
        now: NOW,
      });
      expect(result).toEqual({
        status: "NOT_ENTRY_QR",
        holderName: undefined,
        licenseNumber: undefined,
        queued: false,
      });
    });

    it("says so when no key was ever downloaded", async () => {
      loadKeys.mockResolvedValue(null);
      await expect(
        checkInOffline({ qrData: QR, endpoint: null, now: NOW }),
      ).resolves.toEqual({ status: "NO_KEYS", queued: false });
      loadKeys.mockResolvedValue({ ...KEY_SET, keys: [] });
      await expect(
        checkInOffline({ qrData: QR, endpoint: null }),
      ).resolves.toEqual({ status: "NO_KEYS", queued: false });
    });
  });

  describe("handleCheckinReplayError", () => {
    const mutation = (meta?: Record<string, string>): PendingMutation => ({
      id: "m1",
      endpoint: "POST /competitions/c1/checkin",
      payload: {},
      queryKeysToInvalidate: [],
      enqueuedAt: 0,
      kind: CHECKIN_KIND,
      meta,
    });
    const httpError = (status: number, message?: string) => ({
      response: { status, data: message ? { message } : {} },
    });

    beforeEach(() => {
      jest.spyOn(Alert, "alert").mockImplementation(() => {});
    });

    it("leaves other kinds to their own handler", () => {
      expect(
        handleCheckinReplayError(
          { ...mutation(), kind: "registration" },
          httpError(400),
        ),
      ).toBeUndefined();
    });

    it.each([null, 408, 429, 500, 503])(
      "retries a transient failure (%p)",
      (status) => {
        const err =
          status === null ? new Error("Network Error") : httpError(status);
        expect(handleCheckinReplayError(mutation(), err)).toBe("retry");
        expect(Alert.alert).not.toHaveBeenCalled();
      },
    );

    it("drops a refusal and tells the staff who was refused and why", () => {
      expect(
        handleCheckinReplayError(
          mutation({ holderName: "DUPONT Jean" }),
          httpError(404, "Aucune inscription confirmée pour cette compétition"),
        ),
      ).toBe("drop");
      expect(Alert.alert).toHaveBeenCalledWith(
        "Check-in hors ligne refusé",
        "DUPONT Jean : Aucune inscription confirmée pour cette compétition",
      );
    });

    it("drops a refusal without message", () => {
      expect(handleCheckinReplayError(mutation(), httpError(400))).toBe("drop");
      expect(Alert.alert).toHaveBeenCalledWith(
        "Check-in hors ligne refusé",
        "refusé par le serveur",
      );
    });

    it("drops an expired replay and says so", () => {
      expect(
        handleCheckinReplayError(
          mutation({ holderName: "DUPONT Jean" }),
          new OfflineCheckinExpiredError(),
        ),
      ).toBe("drop");
      expect(Alert.alert).toHaveBeenCalledWith(
        "Check-in hors ligne refusé",
        `DUPONT Jean : ${OFFLINE_CHECKIN_MESSAGES.REPLAY_EXPIRED}`,
      );
    });
  });

  describe("replayCheckin", () => {
    const NOW_MS = Date.parse("2026-10-16T12:00:00.000Z");
    const queued = (ageMs: number): PendingMutation => ({
      id: "m1",
      endpoint: "POST /competitions/checkin/volunteer",
      payload: { token: "t", qrData: "qr" },
      queryKeysToInvalidate: [],
      enqueuedAt: NOW_MS - ageMs,
      kind: CHECKIN_KIND,
      meta: { holderName: "DUPONT Jean" },
    });
    const request = (m: PendingMutation) => ({
      endpoint: m.endpoint,
      payload: m.payload,
    });
    const post = api.post as jest.Mock;

    beforeEach(() => {
      jest.spyOn(Alert, "alert").mockImplementation(() => {});
    });

    it("sends a recent entry to its endpoint, silently on success", async () => {
      post.mockResolvedValue({
        data: { registrations: [{ status: "SUCCESS" }] },
      });
      const m = queued(60_000);
      await replayCheckin(request(m), m, new Date(NOW_MS));
      expect(post).toHaveBeenCalledWith("/competitions/checkin/volunteer", {
        token: "t",
        qrData: "qr",
      });
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    it("warns that the token may have been used twice on ALREADY_CHECKED_IN", async () => {
      post.mockResolvedValue({
        data: { registrations: [{ status: "ALREADY_CHECKED_IN" }] },
      });
      const m = queued(60_000);
      await replayCheckin(request(m), m, new Date(NOW_MS));
      expect(Alert.alert).toHaveBeenCalledWith(
        OFFLINE_CHECKIN_MESSAGES.ALREADY_CHECKED_IN_TITLE,
        `DUPONT Jean ${OFFLINE_CHECKIN_MESSAGES.ALREADY_CHECKED_IN}`,
      );
    });

    it("names nobody when the entry has no holder, and tolerates an empty answer", async () => {
      post.mockResolvedValueOnce({
        data: { registrations: [{ status: "ALREADY_CHECKED_IN" }] },
      });
      const m = { ...queued(0), meta: undefined };
      await replayCheckin(request(m), m, new Date(NOW_MS));
      expect(Alert.alert).toHaveBeenCalledWith(
        OFFLINE_CHECKIN_MESSAGES.ALREADY_CHECKED_IN_TITLE,
        `Ce licencié ${OFFLINE_CHECKIN_MESSAGES.ALREADY_CHECKED_IN}`,
      );
      post.mockResolvedValueOnce({ data: {} });
      await expect(
        replayCheckin(request(m), m, new Date(NOW_MS)),
      ).resolves.toBeUndefined();
    });

    it("never sends an entry older than 12 h", async () => {
      const m = queued(OFFLINE_CHECKIN_MAX_AGE_MS + 1);
      await expect(
        replayCheckin(request(m), m, new Date(NOW_MS)),
      ).rejects.toBeInstanceOf(OfflineCheckinExpiredError);
      expect(post).not.toHaveBeenCalled();
    });

    it("purges expired check-ins (and their volunteer tokens) only", async () => {
      (loadQueue as jest.Mock).mockResolvedValue([
        queued(OFFLINE_CHECKIN_MAX_AGE_MS + 1),
        { ...queued(60_000), id: "fresh" },
        {
          ...queued(OFFLINE_CHECKIN_MAX_AGE_MS + 1),
          id: "registration",
          kind: "registration",
        },
      ]);
      await expect(purgeExpiredCheckins(new Date(NOW_MS))).resolves.toBe(1);
      expect(removeMutations).toHaveBeenCalledWith(["m1"]);
      (loadQueue as jest.Mock).mockResolvedValue([]);
      await expect(purgeExpiredCheckins()).resolves.toBe(0);
    });
  });
});
