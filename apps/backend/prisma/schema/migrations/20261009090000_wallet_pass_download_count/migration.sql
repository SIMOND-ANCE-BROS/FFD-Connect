-- AlterTable
-- Additive only (ADR-0017): existing tokens start at 0 downloads.
ALTER TABLE "WalletPassDownloadToken" ADD COLUMN     "downloadCount" INTEGER NOT NULL DEFAULT 0;
