import { Prisma } from "@prisma/client";
import { retiredLicenseNumberSelect } from "../utils/prisma-selects";

/**
 * Records that a licence stopped carrying `number` (#466), inside the caller's
 * transaction. Every path that rewrites `License.number` must call it: a QR
 * bound to the number alone (signed v1, legacy unsigned) is then refused for
 * that number at check-in, whoever holds it next. Signed v2 QR codes carry the
 * licence id and need no bookkeeping.
 *
 * Idempotent: retiring a number again (renamed back and forth) refreshes the
 * row.
 */
export async function retireLicenseNumber(
  tx: Prisma.TransactionClient,
  number: string,
  licenseId: string,
): Promise<void> {
  await tx.retiredLicenseNumber.upsert({
    where: { number },
    create: { number, licenseId },
    update: { licenseId, retiredAt: new Date() },
    select: retiredLicenseNumberSelect,
  });
}
