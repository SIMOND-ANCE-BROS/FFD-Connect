# Clubs Service Decomposition — Design

**Date:** 2026-03-30
**Scope:** Groupe B — Décomposition de `clubs.service.ts` (981 lignes) en 4 services spécialisés

---

## Contexte

`clubs.service.ts` mélange 4 responsabilités distinctes dans un seul fichier de 981 lignes :

- Résolution du club d'un organisateur (core)
- Gestion des credentials HelloAsso et du mode d'inscription
- Gestion des partenariats (CRUD + validation + notifications)
- Gestion des solo teams (CRUD + recalcul de niveau)

Le module `competitions/` établit déjà le pattern à suivre : un `CompetitionsService` fin qui délègue à des sub-services spécialisés (`competition-registration.service.ts`, `competition-query.service.ts`, etc.).

---

## Architecture cible

```
clubs/
  clubs.service.ts              (~100 lignes)  — core: getClubIdForOrganizer, findOrCreateByName
  clubs-helloasso.service.ts    (~150 lignes)  — HelloAsso credentials + registration mode
  partnership.service.ts        (~450 lignes)  — CRUD partnerships, validation, notifications
  solo-team.service.ts          (~150 lignes)  — CRUD solo teams, recalcul niveau
  clubs.module.ts               — déclare et exporte les 4 services
  clubs.service.spec.ts         — tests du core clubs uniquement
  clubs-helloasso.service.spec.ts
  partnership.service.spec.ts
  solo-team.service.spec.ts
```

---

## Responsabilités par service

### `ClubsService` (core)

Méthodes conservées :

- `getClubIdForOrganizer(organizerUserId)` — résout le club d'un organisateur CLUB
- `findOrCreateByName(name)` — trouve ou crée un club par nom

Dépendances : `PrismaService`

### `ClubsHelloAssoService`

Méthodes extraites de `ClubsService` :

- `getMyClubHelloAssoStatus(organizerUserId)`
- `getRegistrationModeForUser(userId)`
- `setRegistrationMode(organizerUserId, dto)`
- `connectHelloAsso(organizerUserId, dto)`
- `getHelloAssoCredentialsForCompetition(competitionId)`

Dépendances : `PrismaService`, `ClubsService` (pour `getClubIdForOrganizer`)

### `PartnershipService`

Méthodes extraites :

- `getPartnerships(organizerUserId, activeOnly?)`
- `createPartnership(organizerUserId, dto)`
- `endPartnership(organizerUserId, partnershipId, dto)`
- `validatePartnership(organizerUserId, partnershipId, dto)`
- `getClubsForPartnership(organizerUserId)`
- `getMembersForPartnership(organizerUserId, partnershipId, options?)`
- `notifyClubOrganizersForClub(clubId, notification)` — méthode privée conservée ici

Dépendances : `PrismaService`, `ClubsService`, `NotificationsService`

### `SoloTeamService`

Méthodes extraites :

- `getSoloTeams(organizerUserId)`
- `createSoloTeam(organizerUserId, dto)`
- `getSoloTeam(organizerUserId, teamId)`
- `addSoloTeamMember(organizerUserId, teamId, dto)`
- `removeSoloTeamMember(organizerUserId, teamId, userId)`
- `recalculateSoloTeamLevel(teamId)`

Dépendances : `PrismaService`, `ClubsService`

---

## Adaptations

### ClubsController

Le controller injecte actuellement uniquement `ClubsService`. Après la décomposition, il injecte les 4 services :

```typescript
constructor(
  private readonly clubsService: ClubsService,
  private readonly clubsHelloAssoService: ClubsHelloAssoService,
  private readonly partnershipService: PartnershipService,
  private readonly soloTeamService: SoloTeamService,
) {}
```

Chaque méthode du controller appelle le bon service directement. Aucun endpoint ne change.

### ClubsModule

```typescript
@Module({
  imports: [NotificationsModule],
  providers: [ClubsService, ClubsHelloAssoService, PartnershipService, SoloTeamService],
  exports: [ClubsService, ClubsHelloAssoService, PartnershipService, SoloTeamService],
})
```

### Consommateurs externes de ClubsService

`CompetitionRegistrationService` importe `ClubsService` pour `getRegistrationModeForUser`. Après la décomposition, il importera `ClubsHelloAssoService` à la place.

`PaymentService` importe `ClubsService` pour `getHelloAssoCredentialsForCompetition`. Après la décomposition, il importera `ClubsHelloAssoService`.

---

## Tests

Les tests existants dans `clubs.service.spec.ts` sont redistribués :

- Tests `getClubIdForOrganizer` et `findOrCreateByName` → restent dans `clubs.service.spec.ts`
- Tests HelloAsso et registration mode → `clubs-helloasso.service.spec.ts`
- Tests partnerships → `partnership.service.spec.ts`
- Tests solo teams → `solo-team.service.spec.ts`

La couverture totale ne diminue pas — les tests sont déplacés, pas supprimés.

---

## Contraintes

- **Zéro changement de comportement** : aucun endpoint ne change, aucune signature publique ne change
- **Zéro régression** : tous les 971 tests existants doivent continuer à passer après le refactoring
- **Commits atomiques** : un commit par service extrait + un commit final pour les adaptations externes
