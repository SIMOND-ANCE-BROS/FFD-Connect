-- #886: a login that verified the old password just before a password reset
-- could insert its refresh token after the reset's revocation and keep a
-- 30-day session. The reset now stamps "tokensValidAfter"; logins whose
-- credentials were checked before it, and refresh tokens created before it,
-- are refused. Additive and nullable (ADR-0017): existing rows read NULL
-- (= never reset) and the previous image ignores the column.
ALTER TABLE "User" ADD COLUMN "tokensValidAfter" TIMESTAMP(3);
