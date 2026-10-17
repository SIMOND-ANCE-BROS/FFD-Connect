-- Last privacy policy version the user was told about and acknowledged
-- (#734, policy §11). Information, not consent: distinct from the CGU version.
-- Additive and nullable: existing rows read NULL (= never told, so they see
-- the notice once) and the previous image ignores the column (ADR-0017).
-- Read by primary key only: no index.
ALTER TABLE "User" ADD COLUMN "privacyPolicySeenVersion" TEXT;
