import {
  entryQrControllerGetEntryQrKeys,
  entryQrControllerGetMyEntryQr,
} from "../../../api/generated";
import { EntryQrApi, EntryQrNetworkError } from "../entry-qr-api";

jest.mock("../../../api/generated", () => ({
  entryQrControllerGetMyEntryQr: jest.fn(),
  entryQrControllerGetEntryQrKeys: jest.fn(),
}));

const getBatch = entryQrControllerGetMyEntryQr as jest.Mock;
const getKeys = entryQrControllerGetEntryQrKeys as jest.Mock;

describe("EntryQrApi (#24)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getMyBatch", () => {
    it("returns the batch", async () => {
      const batch = { keyId: "k", signatures: [] };
      getBatch.mockResolvedValue({ data: batch, response: { status: 200 } });
      await expect(EntryQrApi.getMyBatch()).resolves.toEqual({
        kind: "batch",
        batch,
      });
    });

    it.each([401, 403, 404])(
      "reports %i as no batch for this account",
      async (status) => {
        getBatch.mockResolvedValue({ error: {}, response: { status } });
        await expect(EntryQrApi.getMyBatch()).resolves.toEqual({
          kind: "unavailable",
          status,
        });
      },
    );

    it.each([500, 503, undefined])(
      "treats %p as a transient failure",
      async (status) => {
        getBatch.mockResolvedValue({
          error: {},
          response: status ? { status } : undefined,
        });
        await expect(EntryQrApi.getMyBatch()).rejects.toBeInstanceOf(
          EntryQrNetworkError,
        );
      },
    );

    it("treats a thrown request as a transient failure", async () => {
      getBatch.mockRejectedValue(new TypeError("Network request failed"));
      await expect(EntryQrApi.getMyBatch()).rejects.toThrow(
        "Entry QR request failed",
      );
    });
  });

  describe("getKeys", () => {
    it("returns the key set", async () => {
      const keys = { keys: [] };
      getKeys.mockResolvedValue({ data: keys });
      await expect(EntryQrApi.getKeys()).resolves.toBe(keys);
    });

    it("returns null on error or without network", async () => {
      getKeys.mockResolvedValueOnce({ error: {} });
      await expect(EntryQrApi.getKeys()).resolves.toBeNull();
      getKeys.mockRejectedValueOnce(new Error("offline"));
      await expect(EntryQrApi.getKeys()).resolves.toBeNull();
    });
  });
});
