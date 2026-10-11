-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "contentHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Track_contentHash_key" ON "Track"("contentHash");
