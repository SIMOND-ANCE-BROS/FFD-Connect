-- #466: licence numbers retired by an administrator's rename (#448). A QR
-- bound to the number alone (signed v1, legacy unsigned) is refused for a
-- retired number, which may have been reassigned to someone else. Additive
-- only: a new table, nothing dropped or altered.
CREATE TABLE "RetiredLicenseNumber" (
    "number" TEXT NOT NULL,
    "licenseId" TEXT,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetiredLicenseNumber_pkey" PRIMARY KEY ("number")
);

-- Backfill: renames already done from the back-office (PR #463) are in the
-- audit log (`before.licenseNumber`). The licence id is not recorded there:
-- the target user's current licence is the best match.
INSERT INTO "RetiredLicenseNumber" ("number", "licenseId", "retiredAt")
SELECT DISTINCT ON (a."before"->>'licenseNumber')
       a."before"->>'licenseNumber',
       l."id",
       a."createdAt"
FROM "AdminAuditLog" a
LEFT JOIN "License" l ON l."userId" = a."targetId"
WHERE a."action" = 'USER_IDENTIFIERS_UPDATE'
  AND COALESCE(a."before"->>'licenseNumber', '') <> ''
ORDER BY a."before"->>'licenseNumber', a."createdAt" DESC
ON CONFLICT ("number") DO NOTHING;
