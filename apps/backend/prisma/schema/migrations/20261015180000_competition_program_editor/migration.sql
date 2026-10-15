-- #442: persist the events (épreuves) and schedule entered in the club
-- competition editor. Additive only (ADR-0017): nullable columns, or arrays
-- defaulting to empty, that an older revision simply ignores.

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "programEditedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "ageGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "openLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "position" INTEGER;

-- AlterTable
ALTER TABLE "ScheduleItem" ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "position" INTEGER,
ADD COLUMN     "startClock" TEXT;

