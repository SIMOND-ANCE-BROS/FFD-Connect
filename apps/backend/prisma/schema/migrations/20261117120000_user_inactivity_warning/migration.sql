-- #991: accounts with no login for 3 years are deleted, as the privacy policy
-- (§5) announces, after a warning e-mail sent 30 days before. Additive and
-- nullable (ADR-0017): existing rows read NULL (= never warned / not claimed)
-- and the previous image ignores the columns.
--
-- "inactivityWarningSentAt": set only once the mail provider confirmed the
-- warning; the only column a deletion depends on.
ALTER TABLE "User" ADD COLUMN "inactivityWarningSentAt" TIMESTAMP(3);
-- "inactivityWarningClaimedAt": short lease taken by one replica before it
-- sends the warning (a stale lease, e.g. after a crash, is retried).
ALTER TABLE "User" ADD COLUMN "inactivityWarningClaimedAt" TIMESTAMP(3);

-- The daily selection filters on the last login date.
CREATE INDEX "User_lastLoginAt_idx" ON "User"("lastLoginAt");
