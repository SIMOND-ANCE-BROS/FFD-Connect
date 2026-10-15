-- #388 (ADR-0023): payment connector chosen by each organising club, and the
-- connector that issued a booking's external payment ids.
-- Additive only (ADR-0017): new enum + two nullable columns. The DEFAULT fills
-- existing rows with HELLOASSO, the only connector so far, so no backfill is
-- needed; the HelloAsso credential columns of "Club" are kept as they are.
-- No index: both columns are only read on a row already fetched by id.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('HELLOASSO');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "paymentProvider" "PaymentProvider" DEFAULT 'HELLOASSO';

-- AlterTable
ALTER TABLE "SeatBooking" ADD COLUMN     "paymentProvider" "PaymentProvider" DEFAULT 'HELLOASSO';
