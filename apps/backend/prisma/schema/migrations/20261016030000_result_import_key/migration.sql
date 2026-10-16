-- #652: competition results import. Additive only (ADR-0017): one nullable
-- column + one unique index. Existing rows keep NULL, and Postgres treats
-- NULLs as distinct, so the index never conflicts with them.
-- "importKey" is a keyed fingerprint (HMAC) of the couple in the imported
-- file, normalised round included (never the name in clear): re-running an
-- import updates the same rows.

-- AlterTable
ALTER TABLE "Result" ADD COLUMN     "importKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Result_eventId_importKey_key" ON "Result"("eventId", "importKey");
