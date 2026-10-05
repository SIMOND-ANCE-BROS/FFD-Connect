-- Paso doble : timecodes (secondes) des appels/coups affichés sur le lecteur.
-- Édités par un admin ; défaut liste vide (estimation client depuis le tempo).
ALTER TABLE "Track" ADD COLUMN "clashTimecodes" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[];
