import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { licenseEntryQrSelect } from "../utils/prisma-selects";
import {
  ENTRY_QR_DISABLED_MESSAGE,
  ENTRY_QR_NO_LICENSE_MESSAGE,
  EntryQrQueryService,
} from "./entry-qr.query-service";
import { EntryQrService } from "./qr/entry-qr.service";

const NOW = new Date("2026-10-16T08:00:00.000Z");
const LICENSE = {
  id: "lic-1",
  number: "FFD-123456",
  validUntil: new Date("2027-08-31T22:00:00.000Z"),
  user: { firstName: "Jean", lastName: "Dupont" },
};
const BATCH = { keyId: "k", signatures: ["s"] };

function setup(options: { canIssue?: boolean; license?: unknown } = {}) {
  const prisma = {
    license: {
      findUnique: jest
        .fn()
        .mockResolvedValue("license" in options ? options.license : LICENSE),
    },
  };
  const entryQr = {
    canIssue: jest.fn().mockReturnValue(options.canIssue ?? true),
    issueBatch: jest.fn().mockReturnValue(BATCH),
    getKeySet: jest.fn().mockReturnValue({ keys: [] }),
  };
  const service = new EntryQrQueryService(
    prisma as unknown as PrismaService,
    entryQr as unknown as EntryQrService,
  );
  return { service, prisma, entryQr };
}

describe("EntryQrQueryService", () => {
  it("issues the batch of the requester's own licence, with the minimal select", async () => {
    const { service, prisma, entryQr } = setup();
    await expect(service.getBatchForUser("user-1", NOW)).resolves.toBe(BATCH);
    expect(prisma.license.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: licenseEntryQrSelect,
    });
    expect(entryQr.issueBatch).toHaveBeenCalledWith(
      { licenseId: "lic-1", number: "FFD-123456", holderName: "DUPONT Jean" },
      LICENSE.validUntil,
      NOW,
    );
  });

  it("answers 404 (never 503: the app would try to wake the backend) when the feature is off", async () => {
    const { service, prisma } = setup({ canIssue: false });
    const call = service.getBatchForUser("user-1", NOW);
    await expect(call).rejects.toBeInstanceOf(NotFoundException);
    await expect(call).rejects.toThrow(ENTRY_QR_DISABLED_MESSAGE);
    expect(prisma.license.findUnique).not.toHaveBeenCalled();
  });

  it("answers 404 without a licence", async () => {
    const { service } = setup({ license: null });
    await expect(service.getBatchForUser("user-1", NOW)).rejects.toThrow(
      new NotFoundException(ENTRY_QR_NO_LICENSE_MESSAGE),
    );
  });

  it("answers 404 for a licence with no holder", async () => {
    const { service } = setup({ license: { ...LICENSE, user: null } });
    await expect(service.getBatchForUser("user-1", NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("answers 404 for an expired licence", async () => {
    const { service, entryQr } = setup();
    entryQr.issueBatch.mockReturnValue(null);
    await expect(service.getBatchForUser("user-1", NOW)).rejects.toThrow(
      ENTRY_QR_NO_LICENSE_MESSAGE,
    );
  });

  it("defaults to the current time", async () => {
    const { service, entryQr } = setup();
    await service.getBatchForUser("user-1");
    expect(entryQr.issueBatch.mock.calls[0][2]).toBeInstanceOf(Date);
  });

  it("exposes the public key set", () => {
    const { service } = setup();
    expect(service.getKeySet()).toEqual({ keys: [] });
  });
});
