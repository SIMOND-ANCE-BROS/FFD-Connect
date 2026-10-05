# Competitions Controller Decomposition — Design

**Date:** 2026-03-31
**Status:** Approved

## Contexte

`CompetitionsController` (776 lignes) injecte uniquement `CompetitionsService` (397 lignes), qui est une façade qui délègue aux 5 sous-services existants (`CompetitionQueryService`, `CompetitionRegistrationService`, `CompetitionResultsService`, `CompetitionCacheService`, `CompetitionSyncService`). `CompetitionsService` contient cependant 4 zones avec de la logique réelle qui n'appartient à aucun sous-service existant.

Objectif : supprimer `CompetitionsService` et faire injecter le controller directement les sous-services spécialisés.

## Architecture cible

```
CompetitionsController
  ├── CompetitionQueryService        (existant — queries)
  ├── CompetitionRegistrationService (existant + nouvelles méthodes)
  ├── CompetitionResultsService      (existant — résultats/checkin)
  └── CompetitionManagementService   (nouveau — CRUD, sync, règlement)
```

`CompetitionsService` est supprimé.

## Tâche 1 : Créer CompetitionManagementService

**Fichier :** `apps/backend/src/competitions/services/competition-management.service.ts`

Extraire de `CompetitionsService` :

- `getRegulationConstants()` — calcul pur (constantes de participation)
- `enqueueSyncFFD()` — BullMQ + Redis
- `getSyncStatus()` — BullMQ + Redis
- `create(data)` — Prisma direct
- `update(id, data)` — Prisma + `cacheService.invalidateCompetition(id)`

**Dépendances :** `PrismaService`, `CompetitionCacheService`, `@InjectQueue("ffd-sync")`, `RedisService`

**Spec :** `competition-management.service.spec.ts` avec tests pour `create`, `update`, `enqueueSyncFFD` (conflict si job en cours), `getSyncStatus` (idle, running, completed).

## Tâche 2 : Déplacer les méthodes organisateur dans CompetitionRegistrationService

Déplacer depuis `CompetitionsService` vers `CompetitionRegistrationService` :

- `registerMember(organizerUserId, eventId, memberUserId, ...)` — avec logique `ensureMemberBelongsToOrganizerClub`
- `unregisterMember(organizerUserId, eventId, memberUserId)` — idem
- `getPendingRegistrationsForClub(organizerUserId)` — logique Prisma de filtrage par club
- `ensureMemberBelongsToOrganizerClub(...)` — méthode privée

**Note :** Ces méthodes dépendent uniquement de `PrismaService` et `CompetitionRegistrationService.register/unregister`, qui sont déjà présents dans ce service.

**Spec :** Ajouter les describe `registerMember`, `unregisterMember`, `getPendingRegistrationsForClub` dans `competition-registration.service.spec.ts`.

## Tâche 3 : Supprimer CompetitionsService

- Supprimer `apps/backend/src/competitions/competitions.service.ts`
- Supprimer `apps/backend/src/competitions/competitions.service.spec.ts`

Aucun consommateur externe (vérifié par grep).

## Tâche 4 : Mettre à jour CompetitionsModule

```typescript
@Module({
  imports: [HttpModule, RedisModule, ClubsModule, JwtModule.register(...), BullModule.registerQueue(...)],
  controllers: [CompetitionsController],
  providers: [
    CompetitionManagementService,  // nouveau
    CompetitionQueryService,
    CompetitionRegistrationService,
    CompetitionResultsService,
    CompetitionCacheService,
    CompetitionSyncService,
    LiveGateway,
    SyncProcessor,
  ],
  exports: [
    CompetitionManagementService,   // remplace CompetitionsService dans exports
    CompetitionRegistrationService,
    CompetitionResultsService,
    LiveGateway,
  ],
})
```

## Tâche 5 : Mettre à jour CompetitionsController

Remplacer l'injection unique `CompetitionsService` par les 4 services spécialisés :

```typescript
constructor(
  private readonly queryService: CompetitionQueryService,
  private readonly registrationService: CompetitionRegistrationService,
  private readonly resultsService: CompetitionResultsService,
  private readonly managementService: CompetitionManagementService,
) {}
```

Routing des 22 appels :

| Appel controller                 | Service cible                                                      |
| -------------------------------- | ------------------------------------------------------------------ |
| `findAll`                        | `queryService.findAll`                                             |
| `findActiveCompetition`          | `queryService.findActiveCompetition`                               |
| `findOneForUser`                 | `queryService.findOneForUser`                                      |
| `findOne`                        | `queryService.findOne`                                             |
| `getRegulationConstants`         | `managementService.getRegulationConstants`                         |
| `enqueueSyncFFD`                 | `managementService.enqueueSyncFFD`                                 |
| `getSyncStatus`                  | `managementService.getSyncStatus`                                  |
| `create`                         | `managementService.create`                                         |
| `update`                         | `managementService.update`                                         |
| `register`                       | `registrationService.register` (direct, avec `byOrganizer: false`) |
| `unregister`                     | `registrationService.unregister`                                   |
| `registerMember`                 | `registrationService.registerMember`                               |
| `unregisterMember`               | `registrationService.unregisterMember`                             |
| `confirmRegistration`            | `registrationService.confirmRegistration`                          |
| `getPendingRegistrationsForClub` | `registrationService.getPendingRegistrationsForClub`               |
| `getResults`                     | `resultsService.getResults`                                        |
| `getEventRegistrations`          | `resultsService.getEventRegistrations`                             |
| `getUserRegistrations`           | `resultsService.getUserRegistrations`                              |
| `checkIn`                        | `resultsService.checkIn`                                           |
| `generateVolunteerToken`         | `resultsService.generateVolunteerToken`                            |
| `checkInAsVolunteer`             | `resultsService.checkInAsVolunteer`                                |

**Note pour `register` :** Actuellement `competitionsService.register(userId, eventId, ...)` wrappait l'appel avec `byOrganizer: false`. Le controller appellera directement `registrationService.register(eventId, userId, partnerName, { byOrganizer: false, ...coupleOptions })`.

## Contraintes

- Zéro changement de comportement observable (endpoints, signatures HTTP, réponses)
- Tests : 77 suites, ~965 tests — tous doivent passer après chaque tâche
- TypeScript strict — typecheck propre obligatoire en fin de tâche 5
