-- RGPD export (#251): read a user's bug reports.
-- CreateIndex
CREATE INDEX "BugReport_userId_createdAt_idx" ON "BugReport"("userId", "createdAt");
