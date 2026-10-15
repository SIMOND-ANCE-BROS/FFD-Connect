-- #61: parental consent of minors (GDPR art. 8 / 9), e-mail double opt-in.
-- Additive only (ADR-0017): a new table, nothing dropped or altered.
CREATE TABLE "ParentalConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "parentEmailHash" TEXT NOT NULL,
    "parentEmailMasked" TEXT NOT NULL,
    "cguVersion" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ParentalConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParentalConsent_tokenHash_key" ON "ParentalConsent"("tokenHash");

-- CreateIndex
CREATE INDEX "ParentalConsent_userId_status_idx" ON "ParentalConsent"("userId", "status");

-- CreateIndex
CREATE INDEX "ParentalConsent_userId_requestedAt_idx" ON "ParentalConsent"("userId", "requestedAt");

-- AddForeignKey
ALTER TABLE "ParentalConsent" ADD CONSTRAINT "ParentalConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
