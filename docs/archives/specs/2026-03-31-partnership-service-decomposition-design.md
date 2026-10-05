# Partnership Service Decomposition — Design

**Date:** 2026-03-31
**Status:** Approved

## Contexte

`PartnershipService` (604 lignes) mélange 3 responsabilités : requêtes de lecture, cycle de vie des couples (écriture/notifications), et logique FFD pure (calcul niveau/catégorie suggérés embarqué dans `createPartnership`).

Objectif : décomposer en 2 services + 1 util, sans changer le point d'entrée du controller.

## Architecture cible

```
ClubsController
  └── PartnershipService         (slimmé — écriture + cycle de vie)
        ├── PartnershipQueryService   (nouveau — 3 méthodes lecture)
        └── partnership-suggestion.util.ts  (nouveau — calcul pur)
```

`PartnershipService` reste l'unique injection dans `ClubsController` — aucun changement controller.

## Tâche 1 : Créer partnership-suggestion.util.ts

**Fichier :** `apps/backend/src/clubs/partnership-suggestion.util.ts`

Extraire depuis `PartnershipService.createPartnership` :

- `LEVEL_ORDER` (constante module-level déjà présente dans service)
- `levelOrder(l)` (fonction module-level déjà présente)
- `computePartnershipSuggestion(u1, u2, startDate)` → `{ coupleAgeGroup, suggestedLevel, suggestedCategories }`

`u1` et `u2` sont des objets avec : `birthDate`, `passportLevelLatin`, `passportLevelStandard`, `category`, `competitionLevel`.

**Dépendances :** `age-group.util`, `level-accession.util` — zéro dépendance NestJS.

**Spec :** `partnership-suggestion.util.spec.ts` — tests unitaires sur combinaisons de niveaux et catégories.

## Tâche 2 : Créer PartnershipQueryService

**Fichier :** `apps/backend/src/clubs/partnership-query.service.ts`

Extraire depuis `PartnershipService` :

- `getPartnerships(organizerUserId, activeOnly?)` — liste des partenariats du club
- `getClubsForPartnership(organizerUserId)` — liste des clubs disponibles (hors propre club)
- `getMembersForPartnership(organizerUserId, secondaryClubId?)` — membres disponibles (non déjà en couple)

**Dépendances :** `PrismaService`, `ClubsService`

**Spec :** `partnership-query.service.spec.ts` — copier les describes `getPartnerships`, `getClubsForPartnership`, `getMembersForPartnership` depuis `partnership.service.spec.ts`.

## Tâche 3 : Slim down PartnershipService

`PartnershipService` garde uniquement :

- `createPartnership(organizerUserId, dto)` — remplace la logique inline par `computePartnershipSuggestion(u1, u2, startDate)`
- `endPartnership(organizerUserId, partnershipId, dto)`
- `validatePartnership(organizerUserId, partnershipId, accepted)`
- `notifyClubOrganizersForClub(club, notification)` (privée — inchangée)

**Dépendances :** `PrismaService`, `ClubsService`, `NotificationsService`

Note : `PartnershipService` n'injecte PAS `PartnershipQueryService` — les 3 méthodes de lecture sont indépendantes du cycle de vie. Le service reste autonome pour l'écriture.

**Spec :** `partnership.service.spec.ts` — garder uniquement les describes `createPartnership`, `endPartnership`, `validatePartnership`. Supprimer les describes de lecture (déplacés dans `partnership-query.service.spec.ts`).

## Tâche 4 : Mettre à jour ClubsModule

Ajouter `PartnershipQueryService` dans `providers` uniquement (pas dans `exports` — consommateur interne à `ClubsModule`).

```typescript
@Module({
  providers: [
    ClubsService,
    ClubsHelloAssoService,
    PartnershipService,
    PartnershipQueryService, // nouveau
    SoloTeamService,
    NotificationsService,
  ],
  exports: [ClubsService, ClubsHelloAssoService, PartnershipService, SoloTeamService],
})
export class ClubsModule {}
```

## Contraintes

- Zéro changement de comportement observable
- `ClubsController` n'est pas modifié — `PartnershipService` reste son unique injection pour les partnerships
- Tests : toutes les suites doivent passer après chaque tâche
- TypeScript strict — typecheck propre obligatoire en fin de tâche 4
