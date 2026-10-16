-- #652 (review): right to erasure for imported results. Additive only
-- (ADR-0017): two nullable columns, one table, one index.
-- - "Result"."partnerUserId": second recognised member of the couple, so a
--   partner deleting their account is found and scrubbed.
-- - "Competition"."resultsNotifiedAt": atomic claim of the « Résultats
--   disponibles » notification (sent once even when two imports race).
-- - "ErasedResultIdentity": keyed fingerprints of deleted accounts' licence
--   numbers, so a later import never re-publishes their name.

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "resultsNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Result" ADD COLUMN     "partnerUserId" TEXT;

-- CreateTable
CREATE TABLE "ErasedResultIdentity" (
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErasedResultIdentity_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateIndex
CREATE INDEX "Result_partnerUserId_idx" ON "Result"("partnerUserId");
