-- Purge de rétention des données de santé (issue #62).
--
-- Migration STRICTEMENT ADDITIVE (ADR-0017 — déploiement single-revision avec
-- rollback automatique : la révision précédente doit continuer de tourner sur
-- ce schéma) : un seul CREATE INDEX, aucun DROP, aucune donnée touchée.
--
-- L'index sert la requête horaire de la purge, qui filtre sur le type et borne
-- + trie sur `createdAt`. L'index `LicenseRenewalDocument_type_idx` existant
-- n'est PAS supprimé bien qu'il en soit désormais un préfixe : un DROP n'est pas
-- additif. Son retrait est un nettoyage à faire plus tard, hors fenêtre de
-- rollback.
--
-- CREATE INDEX (et non CONCURRENTLY) : Prisma exécute la migration dans une
-- transaction, où CONCURRENTLY est interdit. La table ne contient que les
-- documents de renouvellement de licence — quelques dizaines de lignes en bêta,
-- le verrou est instantané.

-- CreateIndex
CREATE INDEX "LicenseRenewalDocument_type_createdAt_idx" ON "LicenseRenewalDocument"("type", "createdAt");
