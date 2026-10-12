-- GDPR right to erasure (#382): a competition result outlives the deleted
-- account (it keeps the ranking of the other couples) but must no longer
-- point to the person. Backwards-compatible: only relaxes NOT NULL.
-- AlterTable
ALTER TABLE "Result" ALTER COLUMN "userId" DROP NOT NULL;

-- Data: results of accounts deleted before this fix (Result.userId has no FK,
-- so they still carry the former id and the couple's name). Same treatment as
-- AccountDeletionService: userId -> NULL, details reduced to the
-- non-identifying keys (totalParticipants, status, marks).
UPDATE "Result" r
SET
  "userId" = NULL,
  "details" = CASE
    WHEN jsonb_typeof(r."details") = 'object' THEN (
      SELECT COALESCE(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
      FROM jsonb_each(r."details") AS d
      WHERE d.key IN ('totalParticipants', 'status', 'marks')
    )
    ELSE '{}'::jsonb
  END
WHERE r."userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = r."userId");
