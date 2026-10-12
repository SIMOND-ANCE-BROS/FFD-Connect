-- GDPR right to erasure (#382): data-only migration, no schema change.
-- Result.userId has no FK, so results of accounts deleted before this fix
-- still carry the former id and the couple's name. Same treatment as
-- AccountDeletionService: the row stays (other couples' ranking), userId is
-- set to the tombstone DELETED_USER_ID (nil UUID, never a real User.id) and
-- details is reduced to the non-identifying keys (totalParticipants, status,
-- marks).
-- userId stays NOT NULL on purpose: a previous image's Prisma client reads
-- it as a required String and would crash on NULL after a deploy rollback.
-- Idempotent: tombstoned rows are excluded.
UPDATE "Result" r
SET
  "userId" = '00000000-0000-0000-0000-000000000000',
  "details" = CASE
    WHEN jsonb_typeof(r."details") = 'object' THEN (
      SELECT COALESCE(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
      FROM jsonb_each(r."details") AS d
      WHERE d.key IN ('totalParticipants', 'status', 'marks')
    )
    ELSE '{}'::jsonb
  END
WHERE r."userId" <> '00000000-0000-0000-0000-000000000000'
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = r."userId");
