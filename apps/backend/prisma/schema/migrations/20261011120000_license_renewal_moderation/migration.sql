-- Modération humaine des demandes de renouvellement (#266, épic #19, ADR-0021).
--
-- STRICTEMENT ADDITIVE (ADR-0017) : cinq colonnes nullables, deux index, une
-- clé étrangère ON DELETE SET NULL. Aucune colonne supprimée ni renommée : la
-- révision précédente, en cas de rollback, ignore simplement ces colonnes.
-- Pas d'enum PostgreSQL pour le motif de refus (validé côté TypeScript), pas
-- d'index unique partiel.

-- AlterTable
ALTER TABLE "LicenseRenewalRequest" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewComment" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LicenseRenewalRequest_status_submittedAt_idx" ON "LicenseRenewalRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "LicenseRenewalRequest_reviewedById_idx" ON "LicenseRenewalRequest"("reviewedById");

-- AddForeignKey
ALTER TABLE "LicenseRenewalRequest" ADD CONSTRAINT "LicenseRenewalRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rattrapage : une demande déjà soumise (tout statut sauf DRAFT) prend comme
-- date de soumission sa dernière modification, meilleure approximation
-- disponible. Idempotent (ne touche que les lignes encore à NULL), sans cast,
-- ne peut pas échouer.
UPDATE "LicenseRenewalRequest"
SET "submittedAt" = "updatedAt"
WHERE "status" <> 'DRAFT' AND "submittedAt" IS NULL;
