-- Motif « proposer la suppression d'une musique » (#446).
--
-- Migration STRICTEMENT ADDITIVE (ADR-0017 — déploiement single-revision avec
-- rollback automatique), et livrée SEULE : aucun code de cette révision
-- n'écrit cette valeur (les DTO de proposition et de signalement la refusent).
-- La révision qui l'émet ne part qu'une fois celle-ci déployée, si bien qu'un
-- rollback de l'émetteur retombe sur une image dont le client Prisma la
-- connaît déjà (cf. « Limite connue — valeurs d'enum ajoutées » dans
-- docs/exploitation/deploiement-azure.md).
--
-- La valeur n'est pas utilisée dans cette même transaction (contrainte
-- PostgreSQL sur ADD VALUE).

-- AlterEnum
ALTER TYPE "TrackCorrectionReason" ADD VALUE 'DELETE';
