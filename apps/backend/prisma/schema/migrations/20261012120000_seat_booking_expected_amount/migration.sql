-- HelloAsso webhook checks (#381): server-side expected amount of a seat
-- booking, in cents. Additive and nullable (backwards compatible).
-- AlterTable
ALTER TABLE "SeatBooking" ADD COLUMN "expectedAmountCents" INTEGER;
