import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

/** Prisma client or transaction client, delegates the re-link writes. */
export type LicenceLinkWriter = Pick<
  PrismaClient,
  "license" | "retiredLicenseNumber"
>;

/**
 * Links an existing, unclaimed licence to a newly registered account (#881),
 * under a NEW licence id.
 *
 * A licence outlives the account that held it (`ON DELETE SET NULL`), with
 * the same id and number, and registration only checks the number. Every QR
 * bound to the licence id — static v2, Apple Wallet pass (serial = licence
 * id), rotating v3 batch — would otherwise designate the new account. A fresh
 * id makes the check-in see them as issued for another licence: refused in
 * `enforce`, and in `warn` resolved to the licence they were issued for,
 * which no longer exists. The new holder's own QR codes are issued after the
 * link, with the new id.
 *
 * The retired numbers recorded for the licence follow it (they are the
 * numbers it carried, #466 / #652).
 *
 * `userId: null` in the filter makes the link conditional: a concurrent
 * registration that linked the licence first leaves 0 matching rows (the
 * second UPDATE waits for the first one's row lock, then re-checks the
 * filter).
 *
 * Returns the new licence id, or null when the licence was already linked —
 * the caller answers 409 and rolls its transaction back.
 */
export async function linkUnclaimedLicence(
  tx: LicenceLinkWriter,
  licenceId: string,
  userId: string,
): Promise<string | null> {
  const newId = randomUUID();
  const { count } = await tx.license.updateMany({
    where: { id: licenceId, userId: null },
    data: { id: newId, userId },
  });
  if (count === 0) return null;
  await tx.retiredLicenseNumber.updateMany({
    where: { licenseId: licenceId },
    data: { licenseId: newId },
  });
  return newId;
}
