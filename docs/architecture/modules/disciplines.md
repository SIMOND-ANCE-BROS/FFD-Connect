# Module Disciplines

## 1) Role metier

Referentiel des domaines de danse (les « familles de danses » de la federation) et de leurs disciplines, avec les capacites que chaque domaine utilise (ADR-0026, epic #1019). C'est la premiere etape (#1022) : le referentiel existe et est servi en lecture ; les profils, epreuves et ecrans ne le lisent pas encore (#1023, #1024, #1026).

## 2) Donnees

Schema : `apps/backend/prisma/schema/discipline.prisma`.

- `DanceDomain` : `code` unique et stable (ex. `LATINES_STANDARDS`), `label` francais, `position` (ordre d'affichage), `capabilities String[]`.
- `Discipline` : `code` unique et stable (`LATIN`, `STANDARD`, `TEN_DANCE`), `label`, `domainId`, `position`, `active`, `aliases String[]` (cles de saisie normalisees : minuscules, sans accents, lettres et chiffres seulement).

Les lignes de reference de « Latines & standards » sont inserees par la migration `20261124120000_dance_discipline_catalog` (insertions idempotentes), pas par un seed : toutes les bases les recoivent en appliquant les migrations.

## 3) Capacites

Liste fermee : `DANCE_CAPABILITIES` dans `packages/shared/src/discipline.ts` (`COUPLE`, `TEAM`, `PASSPORT`, `COMPETITION_LEVELS`, `TEMPO_PLAYER`, `COMPETITION_SKATING`). Le backend garde sa copie d'execution dans `src/disciplines/dance-capabilities.ts`, typee `Record<DanceCapability, true>` : un ecart avec le type partage casse `tsc`. Il n'importe que le type depuis `@ffd-connect/shared` (le paquet n'est pas resolu a l'execution dans l'image backend). Une valeur inconnue stockee en base est ignoree dans la reponse.

## 4) Endpoint

Base controller : `apps/backend/src/disciplines/disciplines.controller.ts`.

- `GET /api/v1/disciplines` — public, sans authentification (limite globale par IP). Reponse `{ domains: [{ code, label, capabilities, disciplines: [{ code, label, aliases }] }] }`, domaines et disciplines actives dans l'ordre d'affichage. Ni id ni donnee personnelle. `Cache-Control: public, max-age=3600`. Bornes : 50 domaines, 100 disciplines par domaine.

## 5) Usage client

Aucun pour l'instant. Le client et le back-office liront ce referentiel a la place de leurs listes en dur (#1024) et masqueront les modules selon les capacites (#1026).
