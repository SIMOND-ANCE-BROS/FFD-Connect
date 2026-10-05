-- Journal d'audit des impersonations (#545). L'enum "UserRole" existe déjà.
CREATE TABLE "ImpersonationLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetRole" "UserRole" NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "ImpersonationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImpersonationLog_actorId_idx" ON "ImpersonationLog"("actorId");
CREATE INDEX "ImpersonationLog_targetUserId_idx" ON "ImpersonationLog"("targetUserId");
CREATE INDEX "ImpersonationLog_startedAt_idx" ON "ImpersonationLog"("startedAt");
