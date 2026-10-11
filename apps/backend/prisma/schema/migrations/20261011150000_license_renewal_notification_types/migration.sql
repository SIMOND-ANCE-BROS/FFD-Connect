-- Types de notification du renouvellement de licence (#269).
--
-- Migration STRICTEMENT ADDITIVE (ADR-0017 — déploiement single-revision avec
-- rollback automatique), et livrée SEULE : aucun code de cette révision
-- n'écrit ces valeurs. La révision qui les émet ne part qu'une fois celle-ci
-- déployée, si bien qu'un rollback de l'émetteur retombe sur une image dont le
-- client Prisma les connaît déjà (cf. « Limite connue — valeurs d'enum
-- ajoutées » dans docs/exploitation/deploiement-azure.md).
--
-- Les valeurs ne sont pas utilisées dans cette même transaction (contrainte
-- PostgreSQL sur ADD VALUE).

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LICENSE_RENEWAL_TO_REVIEW';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LICENSE_RENEWAL_DECISION';
