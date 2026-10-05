-- Préférences de notification par type (issue #37).
--
-- Migration STRICTEMENT ADDITIVE (ADR-0017 — déploiement single-revision avec
-- rollback automatique : la révision précédente doit continuer de tourner sur
-- ce schéma) :
--   * aucun DROP, aucun RENAME, aucune contrainte posée sur des données
--     existantes ;
--   * `Notification.type` est NULLABLE et sans DEFAULT — l'ajout est une simple
--     écriture de catalogue en PostgreSQL (pas de réécriture de table, pas de
--     verrou long), les lignes existantes restent valides et le code de la
--     révision précédente, qui ne renseigne pas la colonne, continue d'insérer ;
--   * `NotificationPreference` n'est pas pré-remplie : l'absence de ligne
--     signifie « défaut du catalogue » (apps/backend/src/notifications/
--     notification-catalog.ts), si bien qu'un compte existant se comporte comme
--     un compte neuf sans aucune migration de données.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REGISTRATION_STATUS', 'COMPETITION_RESULTS', 'NEW_COMPETITION', 'CLUB_MEMBER_REGISTRATION', 'CLUB_PARTNERSHIP', 'TRACK_REPORT', 'DIAGNOSTIC_TEST');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "type" "NotificationType";

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Porte l'unicité (une décision par type et par utilisateur, cible de l'upsert)
-- ET la lecture du catalogue d'un utilisateur : l'index composite sert aussi les
-- requêtes préfixées par "userId", inutile d'en ajouter un second.
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- AddForeignKey
-- Cascade : les préférences sont des données personnelles, elles disparaissent
-- avec le compte (RGPD art. 17, cf. UsersService.deleteMyAccount).
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
