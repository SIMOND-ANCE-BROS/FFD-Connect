-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "screen" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "competitionId" TEXT,
    "durationSec" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageDaily" (
    "day" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "screen" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("day","hour","name","screen","platform","appVersion","space")
);

-- CreateTable
CREATE TABLE "UsageDailyActive" (
    "day" DATE NOT NULL,
    "platform" TEXT NOT NULL,
    "installs" INTEGER NOT NULL,

    CONSTRAINT "UsageDailyActive_pkey" PRIMARY KEY ("day","platform")
);

-- CreateTable
CREATE TABLE "UsageRollupState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastDay" DATE NOT NULL,

    CONSTRAINT "UsageRollupState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageEvent_occurredAt_idx" ON "UsageEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_installId_occurredAt_idx" ON "UsageEvent"("installId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageDaily_day_idx" ON "UsageDaily"("day");
