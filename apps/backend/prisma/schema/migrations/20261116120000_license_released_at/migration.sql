-- #897: a licence released by the deletion of the account that held it is
-- no longer auto-linked at registration. Additive, nullable (ADR-0017): an
-- earlier backend ignores the column. No backfill: licences released before
-- this migration are recognised through "ErasedResultIdentity".
ALTER TABLE "License" ADD COLUMN "releasedAt" TIMESTAMP(3);
