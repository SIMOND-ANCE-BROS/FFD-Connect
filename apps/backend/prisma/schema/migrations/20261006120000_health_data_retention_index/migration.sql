-- Purge de rétention des données de santé (issue #62).
--
-- Migration STRICTEMENT ADDITIVE (ADR-0017 — déploiement single-revision avec
-- rollback automatique : la révision précédente doit continuer de tourner sur
-- ce schéma) : un ADD COLUMN nullable sans défaut et un CREATE INDEX. Aucun
-- DROP, aucune contrainte posée sur l'existant, aucune réécriture de table.
--
-- `purgeDueAt` porte la date à laquelle le document doit avoir disparu. Elle est
-- calculée à l'écriture, car elle dépend de la date d'émission enfouie dans
-- `ocrData`, que le SQL ne sait pas lire de façon fiable.
--
-- VOLONTAIREMENT AUCUN BACKFILL ICI. Il faudrait caster `ocrData->>'date'`, un
-- texte issu de l'OCR d'un document fourni par l'utilisateur : une valeur de
-- forme correcte mais absurde (« 2026-99-99 », que produirait un « 99/99/2026 »
-- présent dans le document source) ferait échouer le cast, donc la migration,
-- donc le démarrage du conteneur. Les lignes antérieures sont datées au fil de
-- l'eau par la purge, en TypeScript, où une date invalide retombe simplement
-- sur la règle de repli.
--
-- CREATE INDEX (et non CONCURRENTLY) : Prisma exécute la migration dans une
-- transaction, où CONCURRENTLY est interdit. La table ne contient que les
-- documents de renouvellement de licence, le verrou est instantané.

-- AlterTable
ALTER TABLE "LicenseRenewalDocument" ADD COLUMN     "purgeDueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LicenseRenewalDocument_type_purgeDueAt_idx" ON "LicenseRenewalDocument"("type", "purgeDueAt");
