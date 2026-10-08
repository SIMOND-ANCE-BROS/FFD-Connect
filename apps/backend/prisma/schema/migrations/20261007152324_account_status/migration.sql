-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_disabledAt_idx" ON "User"("disabledAt");
