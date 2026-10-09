-- Additive only (ADR-0017): every existing row is a regular account / club.
-- No index: the flag is read through primary-key lookups (JwtStrategy) and by
-- the staging seed/purge scripts only.

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "isStoreReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isStoreReview" BOOLEAN NOT NULL DEFAULT false;
