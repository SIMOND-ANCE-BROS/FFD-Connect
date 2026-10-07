-- Propositions de correction des métadonnées d'une piste (file de modération).
--
-- Migration STRICTEMENT ADDITIVE (ADR-0017 — déploiement single-revision avec
-- rollback automatique : la révision précédente doit continuer de tourner sur
-- ce schéma) :
--   * deux nouveaux enums et une nouvelle table, aucune colonne touchée sur les
--     tables existantes ;
--   * `NotificationType` gagne une valeur (ADD VALUE) : la révision précédente
--     ne la lit ni ne l'écrit, et la valeur n'est pas utilisée dans cette même
--     transaction (contrainte PostgreSQL sur ADD VALUE) ;
--   * FK utilisateur en ON DELETE SET NULL (RGPD : la suppression du compte
--     n'est pas bloquée et ne laisse pas l'auteur identifiable).

-- CreateEnum
CREATE TYPE "TrackCorrectionReason" AS ENUM ('TITLE', 'ARTIST', 'DANCE', 'MPM', 'PASO_CLASH', 'OTHER');

-- CreateEnum
CREATE TYPE "TrackCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TRACK_CORRECTION_DECISION';

-- CreateTable
CREATE TABLE "TrackCorrection" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "proposedById" TEXT,
    "reason" "TrackCorrectionReason" NOT NULL,
    "proposedTitle" TEXT,
    "proposedArtist" TEXT,
    "proposedStyle" TEXT,
    "proposedBpm" DOUBLE PRECISION,
    "proposesClashes" BOOLEAN NOT NULL DEFAULT false,
    "proposedClashTimecodes" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "message" TEXT,
    "status" "TrackCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackCorrection_status_createdAt_idx" ON "TrackCorrection"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TrackCorrection_trackId_idx" ON "TrackCorrection"("trackId");

-- CreateIndex
CREATE INDEX "TrackCorrection_proposedById_idx" ON "TrackCorrection"("proposedById");

-- AddForeignKey
ALTER TABLE "TrackCorrection" ADD CONSTRAINT "TrackCorrection_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackCorrection" ADD CONSTRAINT "TrackCorrection_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackCorrection" ADD CONSTRAINT "TrackCorrection_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
