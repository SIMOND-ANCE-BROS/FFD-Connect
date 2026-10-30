import { Prisma } from "@prisma/client";
import { retiredLicenseNumberSelect } from "../utils/prisma-selects";
import {
  retireLicenseNumber,
  retireLicenseNumberOperation,
} from "./retired-license-number";

describe("retired licence numbers (#466, #491)", () => {
  const upsert = jest.fn();
  const prisma = { retiredLicenseNumber: { upsert } };

  beforeEach(() => {
    upsert.mockReset();
    upsert.mockReturnValue("pending-upsert");
  });

  it("builds an idempotent upsert keyed by the number, without awaiting it", () => {
    const op = retireLicenseNumberOperation(
      prisma as never,
      "SCAN-TEST-1",
      "lic-1",
    );

    expect(op).toBe("pending-upsert");
    expect(upsert).toHaveBeenCalledWith({
      where: { number: "SCAN-TEST-1" },
      create: { number: "SCAN-TEST-1", licenseId: "lic-1" },
      update: { licenseId: "lic-1", retiredAt: expect.any(Date) },
      select: retiredLicenseNumberSelect,
    });
  });

  it("retireLicenseNumber runs the same write inside the caller's transaction", async () => {
    upsert.mockResolvedValue({ number: "OLD-1" });

    await retireLicenseNumber(
      prisma as unknown as Prisma.TransactionClient,
      "OLD-1",
      "lic-2",
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { number: "OLD-1" },
        create: { number: "OLD-1", licenseId: "lic-2" },
      }),
    );
  });

  it("propagates a failed write so the caller's transaction rolls back", async () => {
    upsert.mockRejectedValue(new Error("db down"));

    await expect(
      retireLicenseNumber(
        prisma as unknown as Prisma.TransactionClient,
        "OLD-1",
        "lic-2",
      ),
    ).rejects.toThrow("db down");
  });
});
