-- Refresh-token families (#687): every token rotated from the same login
-- shares a familyId, so reusing an already-rotated token revokes the whole
-- chain without touching the user's other devices.
--
-- Additive only (ADR-0017): a nullable column and an index; the previous image
-- never reads them. No backfill on purpose: a token issued before this
-- migration keeps familyId NULL and its family is its own id (the service
-- falls back to `id`), so existing sessions stay valid and the deploy runs no
-- full-table UPDATE at boot. Its first rotation stamps the child with the
-- legacy token's id, which joins the chain to its root.

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "familyId" TEXT;

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_revoked_idx" ON "RefreshToken"("familyId", "revoked");
