import { Prisma, PrismaClient } from "@prisma/client";
import { retiredLicenseNumberSelect } from "../utils/prisma-selects";

/** Prisma client or transaction client, retired-number delegate only. */
export type RetiredLicenseNumberWriter = Pick<
  PrismaClient,
  "retiredLicenseNumber"
>;

/**
 * Same write as retireLicenseNumber, NOT awaited: for a batch transaction
 * (`prisma.$transaction([...])`) that frees the number itself — a licence
 * deleted with its number retires it in that same transaction (#491).
 *
 * Idempotent: retiring a number again (renamed back and forth, deleted after
 * a rename) refreshes the row.
 */
export function retireLicenseNumberOperation(
  prisma: RetiredLicenseNumberWriter,
  number: string,
  licenseId: string,
): Prisma.PrismaPromise<{ number: string }> {
  return prisma.retiredLicenseNumber.upsert({
    where: { number },
    create: { number, licenseId },
    update: { licenseId, retiredAt: new Date() },
    select: retiredLicenseNumberSelect,
  });
}

/**
 * Records that a licence stopped carrying `number` (#466), inside the caller's
 * transaction. Every path that frees a number must retire it: a rewrite of
 * `License.number` (here) or the deletion of the licence
 * (retireLicenseNumberOperation, #491). A QR bound to the number alone
 * (signed v1, legacy unsigned) is then refused for that number at check-in,
 * whoever holds it next. Signed v2 QR codes carry the licence id and need no
 * bookkeeping.
 *
 * Idempotent: retiring a number again (renamed back and forth) refreshes the
 * row.
 */
export async function retireLicenseNumber(
  tx: Prisma.TransactionClient,
  number: string,
  licenseId: string,
): Promise<void> {
  await retireLicenseNumberOperation(tx, number, licenseId);
}
