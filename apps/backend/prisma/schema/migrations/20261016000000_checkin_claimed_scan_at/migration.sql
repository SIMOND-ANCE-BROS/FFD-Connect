-- Offline check-in replay (#24, ADR-0023): the scan time CLAIMED by an
-- offline scanner, kept apart from the authoritative server-side checkInTime.
-- Additive and nullable (ADR-0017).
ALTER TABLE "Registration" ADD COLUMN "checkInClaimedScanAt" TIMESTAMP(3);
