-- One active booking per seat (#402) + lazy expiry of temporary holds (#401).
-- Additive: one partial unique index; the data steps only move PENDING holds
-- that can no longer be paid to the existing EXPIRED status.

-- 1. Holds past their deadline (or without one) never block a seat again.
UPDATE "SeatBooking"
SET "status" = 'EXPIRED', "updatedAt" = NOW()
WHERE "status" = 'PENDING'
  AND ("expiresAt" IS NULL OR "expiresAt" <= NOW());

-- 2. Remaining duplicate PENDING holds: keep the confirmed seat, otherwise the
-- oldest hold. (Two CONFIRMED bookings on one seat are a real double sale:
-- the index below then fails on purpose and needs a human decision.)
UPDATE "SeatBooking" AS b
SET "status" = 'EXPIRED', "updatedAt" = NOW()
WHERE b."status" = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "SeatBooking" AS o
    WHERE o."competitionId" = b."competitionId"
      AND o."itemId" = b."itemId"
      AND o."id" <> b."id"
      AND (
        o."status" = 'CONFIRMED'
        OR (o."status" = 'PENDING'
            AND (o."createdAt", o."id") < (b."createdAt", b."id"))
      )
  );

-- CreateIndex
CREATE UNIQUE INDEX "SeatBooking_active_seat_key" ON "SeatBooking"("competitionId", "itemId") WHERE (status IN ('PENDING', 'CONFIRMED'));
