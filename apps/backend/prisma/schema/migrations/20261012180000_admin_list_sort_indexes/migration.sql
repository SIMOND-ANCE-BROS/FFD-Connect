-- #443: back-office lists sorted from their column headers. Additive only:
-- the default orders (users / tracks by creation date) and the name / title
-- sorts get an index; the other sortable columns were already indexed or sit
-- on small tables (clubs, moderation, renewals, audit log).
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "User_lastName_firstName_idx" ON "User"("lastName", "firstName");
CREATE INDEX "Track_createdAt_idx" ON "Track"("createdAt");
CREATE INDEX "Track_title_idx" ON "Track"("title");
