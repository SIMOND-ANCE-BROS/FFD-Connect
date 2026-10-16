-- Rotating entry QR made mandatory per competition (#668, ADR-0024): when
-- set, the check-in refuses static v1/v2 QRs (Wallet pass, older apps).
-- Additive, NOT NULL with a default so existing rows and the previous image
-- keep working (ADR-0017).
ALTER TABLE "Competition" ADD COLUMN "requireRotatingQr" BOOLEAN NOT NULL DEFAULT false;
