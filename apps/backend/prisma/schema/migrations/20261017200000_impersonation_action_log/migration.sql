-- Journal of the writes made during a support access (#761): one row per
-- non-GET request under an impersonation token (method, route template,
-- HTTP status). Additive only (ADR-0017): a new table, the previous image
-- never reads it. Rows go with their session (ON DELETE CASCADE), so the
-- ImpersonationLog retention purge (#731) removes them in the same pass.

-- CreateTable
CREATE TABLE "ImpersonationActionLog" (
    "id" TEXT NOT NULL,
    "impersonationLogId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationActionLog_impersonationLogId_at_idx" ON "ImpersonationActionLog"("impersonationLogId", "at");

-- AddForeignKey
ALTER TABLE "ImpersonationActionLog" ADD CONSTRAINT "ImpersonationActionLog_impersonationLogId_fkey" FOREIGN KEY ("impersonationLogId") REFERENCES "ImpersonationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
