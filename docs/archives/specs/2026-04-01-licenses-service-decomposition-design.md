# Licenses Service Decomposition — Design

**Date:** 2026-04-01
**Status:** Approved

## Contexte

`LicensesService` (426 lignes) mélange 2 responsabilités : les opérations stables sur la licence (lecture, renouvellement direct OCR) et le workflow document en cours de développement (5 méthodes, feature non finalisée). Le controller (`LicensesController`) injecte uniquement `LicensesService`.

Objectif : extraire le workflow renewal dans un `LicenseRenewalService` dédié, sans changer le comportement observable.

## Architecture cible

```
LicensesController
  ├── LicensesService          (stable — getLicense, validateStaffLicense, renewLicense)
  └── LicenseRenewalService    (WIP — start, getMyRenewal, uploadDocument, submit, approve)
```

## Tâche 1 : Créer LicenseRenewalService

**Fichier :** `apps/backend/src/licenses/license-renewal.service.ts`

Extraire depuis `LicensesService` :

- `startRenewalRequest(userId)` — crée ou récupère une demande DRAFT
- `getMyRenewalRequest(userId)` — retourne la demande la plus récente ou null
- `uploadRenewalDocument(userId, requestId, type, filePath)` — upload + OCR + validation
- `submitRenewalRequest(userId, requestId)` — DRAFT → PENDING puis appelle `approveRenewalRequest` en interne
- `approveRenewalRequest(requestId)` — PENDING → APPROVED + upsert licence
- `assertMedicalCertificateDateValid(ocrData, context)` (privée)
- `getNextSeasonEndDate()` (privée)

Constante module-level à migrer : `MEDICAL_CERTIFICATE_MAX_AGE_MONTHS = 12`

**Dépendances :** `PrismaService`, `OcrService`

**Spec :** `license-renewal.service.spec.ts` — copier les describes `startRenewalRequest`, `getMyRenewalRequest`, `uploadRenewalDocument`, `submitRenewalRequest`, `approveRenewalRequest` depuis `licenses.service.spec.ts`.

## Tâche 2 : Slim down LicensesService

`LicensesService` ne garde que :

- `getLicense(userId)` — récupère la licence d'un utilisateur
- `validateStaffLicense(licenseNumber)` — validation mock WDSF/Legacy
- `renewLicense(userId, certificatePath)` — renouvellement direct via OCR

Supprimer : les 5 méthodes renewal, `assertMedicalCertificateDateValid`, `getNextSeasonEndDate`, `MEDICAL_CERTIFICATE_MAX_AGE_MONTHS`.

`LicensesService` n'injecte **pas** `LicenseRenewalService` — les deux sont indépendants.

**Dépendances :** `PrismaService`, `OcrService` (inchangé)

**Spec :** `licenses.service.spec.ts` — supprimer les describes `startRenewalRequest`, `getMyRenewalRequest`, `uploadRenewalDocument`, `submitRenewalRequest`, `approveRenewalRequest` (déplacés dans `license-renewal.service.spec.ts`).

## Tâche 3 : Mettre à jour LicensesModule

```typescript
@Module({
  imports: [PrismaModule],
  controllers: [LicensesController],
  providers: [LicensesService, LicenseRenewalService, OcrService],
  exports: [LicensesService, LicenseRenewalService],
})
export class LicensesModule {}
```

## Tâche 4 : Mettre à jour LicensesController

Ajouter l'injection de `LicenseRenewalService` :

```typescript
constructor(
  private readonly licensesService: LicensesService,
  private readonly licenseRenewalService: LicenseRenewalService,
) {}
```

Routing des appels :

| Endpoint                | Service cible                                 |
| ----------------------- | --------------------------------------------- |
| `getMyLicense`          | `licensesService.getLicense`                  |
| `uploadLicense`         | `licensesService.renewLicense`                |
| `renewLicense`          | `licensesService.renewLicense`                |
| `validateStaffLicense`  | `licensesService.validateStaffLicense`        |
| `startRenewal`          | `licenseRenewalService.startRenewalRequest`   |
| `getMyRenewal`          | `licenseRenewalService.getMyRenewalRequest`   |
| `uploadRenewalDocument` | `licenseRenewalService.uploadRenewalDocument` |
| `submitRenewal`         | `licenseRenewalService.submitRenewalRequest`  |
| `approveRenewal`        | `licenseRenewalService.approveRenewalRequest` |

## Contraintes

- Zéro changement de comportement observable
- `LicensesController` est le seul consommateur — aucune mise à jour externe nécessaire
- Tests : toutes les suites doivent passer après chaque tâche
- TypeScript strict — typecheck propre obligatoire en fin de tâche 4
