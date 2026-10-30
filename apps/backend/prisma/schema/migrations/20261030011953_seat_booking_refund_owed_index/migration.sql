-- Refunds-due lists (club GET /clubs/me/refunds-due #516, admin
-- GET /admin/refunds-due #627) filter on "refundOwedAt" IS NOT NULL and sort
-- by ("refundOwedAt", "id") for pagination (#675). Partial index: only the
-- few bookings with a refund owed are indexed. Additive only (ADR-0017): the
-- previous image never needs it and keeps working with it.

-- CreateIndex
CREATE INDEX "SeatBooking_refund_owed_idx" ON "SeatBooking"("refundOwedAt", "id") WHERE ("refundOwedAt" IS NOT NULL);
