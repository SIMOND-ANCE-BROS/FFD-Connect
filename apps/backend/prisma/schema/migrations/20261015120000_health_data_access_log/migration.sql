-- #63: access journal for health data (GDPR art. 9 and 32). Additive only
-- (ADR-0017): a new table and its indexes, nothing dropped or altered. No
-- foreign key on purpose: a trace outlives the accounts it names.

-- CreateTable
CREATE TABLE "HealthDataAccessLog" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthDataAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthDataAccessLog_subjectUserId_createdAt_idx" ON "HealthDataAccessLog"("subjectUserId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthDataAccessLog_actorUserId_createdAt_idx" ON "HealthDataAccessLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthDataAccessLog_createdAt_idx" ON "HealthDataAccessLog"("createdAt");
