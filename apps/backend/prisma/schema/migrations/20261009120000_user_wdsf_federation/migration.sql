-- AlterTable
-- Additive only (ADR-0017): already linked WDSF licenses keep a NULL
-- federation, derived from the nationality when the profile is read.
ALTER TABLE "User" ADD COLUMN     "wdsfFederation" TEXT;
