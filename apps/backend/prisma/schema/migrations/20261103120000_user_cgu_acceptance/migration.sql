-- CGU acceptance recorded per ACCOUNT (#894): it was only kept on the device,
-- so a second account signing in on the same phone was never asked.
-- Additive and nullable: existing rows read NULL (= never accepted server-side,
-- so the app asks each account once) and the previous image ignores the
-- columns (ADR-0017). Read by primary key only: no index.
ALTER TABLE "User" ADD COLUMN "cguAcceptedVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "cguAcceptedAt" TIMESTAMP(3);
