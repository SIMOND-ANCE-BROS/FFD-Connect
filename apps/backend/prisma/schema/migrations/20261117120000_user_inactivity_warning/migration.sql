-- #991: accounts with no login for 3 years are deleted, as the privacy policy
-- (§5) announces, after a warning e-mail sent 30 days before. The warning date
-- is tracked per account. Additive and nullable (ADR-0017): existing rows read
-- NULL (= never warned) and the previous image ignores the column.
ALTER TABLE "User" ADD COLUMN "inactivityWarningSentAt" TIMESTAMP(3);

-- The daily selection filters on the last login date.
CREATE INDEX "User_lastLoginAt_idx" ON "User"("lastLoginAt");
