-- CreateEnum
CREATE TYPE "EventsSource" AS ENUM ('GENERIC', 'DESCRIPTION', 'CIRCULAR');

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "eventsFingerprint" TEXT,
ADD COLUMN     "eventsSource" "EventsSource";
