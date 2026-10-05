-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "blacklisted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "titleMasked" BOOLEAN NOT NULL DEFAULT false;
