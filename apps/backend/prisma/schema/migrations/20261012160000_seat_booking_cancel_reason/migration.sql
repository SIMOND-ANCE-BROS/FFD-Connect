-- #403: why a seat booking was released (refund / dispute). Additive, nullable.
ALTER TABLE "SeatBooking" ADD COLUMN "cancelReason" TEXT;
