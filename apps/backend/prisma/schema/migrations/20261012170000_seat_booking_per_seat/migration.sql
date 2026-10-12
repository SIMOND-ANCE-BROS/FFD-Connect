-- Per-seat booking, pending cap, payment resume and refund-owed marker (#428).
--
-- Additive and backwards compatible (ADR-0017): nullable columns (or a
-- constant default), new partial unique indexes and CHECK constraints that
-- only constrain non-NULL values. The previous revision only writes rows
-- with "seatIndex" / "pendingSlot" NULL: "SeatBooking_active_item_legacy_key"
-- gives those rows exactly the guarantee of the index it replaces (one active
-- booking per element), so a rollback keeps working AMONG ITS OWN ROWS. It
-- does not see per-seat rows: once seats were sold per seat, a rolled-back
-- revision may sell a whole element next to them, and ignores payments made
-- on replaced checkout intents — roll forward rather than stay rolled back.

-- AlterTable
ALTER TABLE "SeatBooking" ADD COLUMN     "checkoutCreatedAt" TIMESTAMP(3),
ADD COLUMN     "checkoutRedirectUrl" TEXT,
ADD COLUMN     "pendingSlot" SMALLINT,
ADD COLUMN     "refundOwedAt" TIMESTAMP(3),
ADD COLUMN     "refundOwedPaymentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "seatIndex" INTEGER,
ADD COLUMN     "supersededPaymentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A seat index is never negative; a pending slot is one of the 4 slots 0..3
-- (at most 4 PENDING bookings per user and competition, with the index below).
ALTER TABLE "SeatBooking" ADD CONSTRAINT "SeatBooking_seatIndex_check" CHECK ("seatIndex" IS NULL OR "seatIndex" >= 0);
ALTER TABLE "SeatBooking" ADD CONSTRAINT "SeatBooking_pendingSlot_check" CHECK ("pendingSlot" IS NULL OR "pendingSlot" BETWEEN 0 AND 3);

-- CreateIndex
CREATE UNIQUE INDEX "SeatBooking_active_seat_index_key" ON "SeatBooking"("competitionId", "itemId", "seatIndex") WHERE ((status = ANY (ARRAY['PENDING'::"BookingStatus", 'CONFIRMED'::"BookingStatus"])) AND ("seatIndex" IS NOT NULL));

-- CreateIndex: existing rows all have "seatIndex" NULL and already satisfy
-- the stricter index dropped below, so this cannot fail.
CREATE UNIQUE INDEX "SeatBooking_active_item_legacy_key" ON "SeatBooking"("competitionId", "itemId") WHERE ((status = ANY (ARRAY['PENDING'::"BookingStatus", 'CONFIRMED'::"BookingStatus"])) AND ("seatIndex" IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "SeatBooking_pending_cap_key" ON "SeatBooking"("competitionId", "userId", "pendingSlot") WHERE (status = 'PENDING'::"BookingStatus");

-- DropIndex: one active booking per ELEMENT would forbid selling two seats of
-- one table; replaced by the two indexes above.
DROP INDEX "SeatBooking_active_seat_key";
