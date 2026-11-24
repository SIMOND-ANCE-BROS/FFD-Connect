# Module Disciplines

## 1) Role metier

Referentiel des domaines de danse (les « familles de danses » de la federation) et de leurs disciplines, avec les capacites que chaque domaine utilise (ADR-0026, epic #1019). Etape 1 (#1022) : le referentiel existe et est servi en lecture. Etape 2 (#1023) : les disciplines des danseurs (`UserDiscipline`) sont ecrites en double, mais rien ne les lit encore ; les profils, epreuves et ecrans lisent toujours les anciennes colonnes (#1024, #1026).

## 2) Donnees

Schema : `apps/backend/prisma/schema/discipline.prisma`.

- `DanceDomain` : `code` unique et stable (ex. `LATINES_STANDARDS`), `label` francais, `position` (ordre d'affichage), `capabilities String[]`.
- `Discipline` : `code` unique et stable (`LATIN`, `STANDARD`, `TEN_DANCE`), `label`, `domainId`, `position`, `active`, `aliases String[]` (cles de saisie normalisees : minuscules, sans accents, lettres et chiffres seulement).

Les lignes de reference de « Latines & standards » sont inserees par la migration `20261124120000_dance_discipline_catalog` (insertions idempotentes), pas par un seed : toutes les bases les recoivent en appliquant les migrations.

- `UserDiscipline` (#1023) : `userId` (suppression en cascade avec le compte), `disciplineId`, `passportLevel` (`PassportLevel?`), `competitionLevel` (texte), `primary`. Unique sur (`userId`, `disciplineId`), index sur `disciplineId`.

### Double ecriture (etape 2, #1023)

Les anciennes colonnes restent la source de verite et la seule lue : `User.category`, `passportLevelLatin` / `passportLevelStandard`, `competitionLevelLatin` / `competitionLevelStandard`. Tout code qui en ecrit une appelle `syncUserDisciplines(tx, userId)` (`src/disciplines/user-disciplines.sync.ts`) dans la meme transaction, apres l'ecriture : les lignes du domaine « Latines & standards » sont recalculees depuis les colonnes stockees, celles des autres domaines ne sont pas touchees. Ecrivains actuels : inscription (`AuthService.register`), creation et modification au back-office (`AdminUserAccountsService.create`, `AdminUsersService.update`). Un nouvel ecrivain de ces colonnes doit faire de meme.

Regles (`deriveUserDisciplines`) :

| Ancienne valeur                                      | Lignes `UserDiscipline`                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `category` « Latin » (et variantes, ex. « latines ») | `LATIN`, principale                                                        |
| `category` « Standard » (et variantes)               | `STANDARD`, principale                                                     |
| `category` « Ten Dance » (« 10 danses »…)            | `LATIN` + `STANDARD` + `TEN_DANCE` (principale, sans niveau)               |
| Niveau Passeport ou compétition Latine / Standard    | Recopie sur `LATIN` / `STANDARD`, ligne ajoutee (non principale) si besoin |
| `category` inconnue ou vide, niveau vide             | Rien                                                                       |

La normalisation de `category` est celle de `normalizeDiscipline` (`src/common/competition-level/competition-level.util.ts`).

La migration `20261124130000_user_discipline` a repris l'existant avec les memes regles, en SQL idempotent (une ligne deja presente n'est pas modifiee). `test/user-discipline-backfill.integration-spec.ts` rejoue ce SQL et le compare a `deriveUserDisciplines`.

Limite connue : apres un retour arriere sur une revision anterieure a #1023, cette revision ecrit les anciennes colonnes sans `UserDiscipline`. Avant de basculer la lecture (#1024), recalculer les lignes de tous les comptes.

## 3) Capacites

Liste fermee : `DANCE_CAPABILITIES` dans `packages/shared/src/discipline.ts` (`COUPLE`, `TEAM`, `PASSPORT`, `COMPETITION_LEVELS`, `TEMPO_PLAYER`, `COMPETITION_SKATING`). Le backend garde sa copie d'execution dans `src/disciplines/dance-capabilities.ts`, typee `Record<DanceCapability, true>` : un ecart avec le type partage casse `tsc`. Il n'importe que le type depuis `@ffd-connect/shared` (le paquet n'est pas resolu a l'execution dans l'image backend). Une valeur inconnue stockee en base est ignoree dans la reponse.

## 4) Endpoint

Base controller : `apps/backend/src/disciplines/disciplines.controller.ts`.

- `GET /api/v1/disciplines` — public, sans authentification (limite globale par IP). Reponse `{ domains: [{ code, label, capabilities, disciplines: [{ code, label, aliases }] }] }`, domaines et disciplines actives dans l'ordre d'affichage. Ni id ni donnee personnelle. `Cache-Control: public, max-age=3600`. Bornes : 50 domaines, 100 disciplines par domaine.

## 5) Usage client

Aucun pour l'instant. Le client et le back-office liront ce referentiel a la place de leurs listes en dur (#1024) et masqueront les modules selon les capacites (#1026).
