# ADR-0026: Référentiel de disciplines et capacités par domaine de danse

**Date**: 2026-11-24
**Status**: accepted
**Deciders**: Gabin SIMOND (epic #1019, issue #1021)

## Context

FFD Connect ne connaît que la danse sportive : Latine, Standard et 10 danses. La fédération couvre bien d'autres disciplines et n'adoptera pas un outil limité à deux d'entre elles. Il faut donc ouvrir l'app à toutes ses disciplines, sans imposer à chacun les fonctions qui ne le concernent pas : un club de rock n'a que faire du Passeport Danse, des niveaux Latine/Standard ou des épreuves WDSF.

Aujourd'hui, Latine/Standard est codé en dur à trois niveaux.

**Schéma** : une colonne par discipline.

- `User.category` : texte libre (« Latin », « Standard », « Ten Dance ») ;
- `User.passportLevelLatin` / `passportLevelStandard` et `competitionLevelLatin` / `competitionLevelStandard` (`prisma/schema/user.prisma`) ;
- `Registration.coupleDisciplineLatin` / `coupleDisciplineStandard` et `Event.category` (`prisma/schema/competition.prisma`).

**Listes recopiées**, avec la consigne « à garder synchronisés » :

- `DISCIPLINES`, ses alias et libellés (`src/common/competition-level/competition-level.util.ts`), `USER_CATEGORIES` (`src/common/user-categories.ts`) ;
- `apps/admin/src/lib/discipline.ts` et `apps/client/src/utils/discipline.ts` ;
- les dix danses et leurs tempos, dans `src/tracks/bpm.service.ts` (`STYLE_CONFIG`) et `apps/client/src/features/player/utils/danceTempo.ts`.

**Règles métier** : Passeport Danse, accès aux niveaux, règles solo, 10 danses, déduction des épreuves FFD, import TopTurnier. Environ 50 fichiers backend, 24 côté client et 5 dans le back-office lisent ces valeurs.

Le socle de l'app ne dépend pas de la discipline : comptes, licences et renouvellements, clubs, paiements, notifications, QR d'entrée, back-office. En revanche, plusieurs notions supposent la danse de couple (partenariats, couples, Passeport Danse). Elles ne valent pas pour une discipline qui se danse en solo, en crew ou en ligne.

Contraintes :

- Les migrations restent **additives** : elles s'exécutent au démarrage du conteneur, et le retour arrière automatique du déploiement en dépend (ADR-0017, ADR-0025).
- Les anciennes versions de l'app restent servies : un champ de réponse ne disparaît pas tant qu'une version autorisée le lit.
- Pas de nouveau React Context pour de l'état côté client : Zustand (ADR-0005).
- Pas d'enum PostgreSQL pour une liste appelée à grandir : l'ajout de valeurs se migre mal (même choix que `consent.prisma` et `license.prisma`).

## Decision

### 1. Un référentiel en base : domaines et disciplines

- **`DanceDomain`** : `code` stable (ex. `LATINES_STANDARDS`), libellé français, ordre d'affichage, `capabilities String[]`. Un domaine correspond à une **famille de danses** de la fédération, et une discipline à un style de cette famille. On reprend ainsi le découpage que la fédération publie déjà.
- **`Discipline`** : `code` stable (ex. `LATIN`), libellé français, `domainId`, ordre, `active`, `aliases String[]` (saisies libres et imports reconnus : « latines », « 10 danses »…).
- **Dance** (rattachée au lecteur de musique, #1028) : code, libellé, `disciplineId`, plage de BPM, temps par mesure.

Les codes sont la clé utilisée par le code et les API. Les libellés ne servent qu'à l'affichage. L'API publique `GET /disciplines` sert l'arbre domaines → disciplines → capacités, que le client et le back-office mettent en cache. Les copies locales disparaissent.

Liste de départ : les **12 familles** publiées sur ffdanse.fr (page « Découvrez toutes les danses », relevée le 2026-11-24), avec les styles de chaque page famille. Les familles et les styles sont à confirmer avec la fédération, ainsi que les capacités de chaque famille (#1020). La colonne « Résultats » indique que la page famille donne accès à des résultats de compétition.

| Famille (domaine)         | Styles (disciplines)                                                                  | Résultats |
| ------------------------- | ------------------------------------------------------------------------------------- | --------- |
| Latines & standards       | Danses latines, danses standards (et 10 danses, épreuve qui combine les deux)         | oui       |
| Danses de salon           | Pas de style détaillé (danses de société, de bal, musette)                            | non       |
| Danses rock & swing       | Rock acrobatique, rock'n'roll, rock sauté, boogie-woogie, lindy hop, west coast swing | oui       |
| Salsa - bachata - kizomba | Salsa, bachata, kizomba, danses latino-caraïbes, zumba                                | oui       |
| Hip-hop - breaking        | Danses hip-hop, breaking                                                              | oui       |
| Danse country             | Pas de style détaillé (country & line)                                                | oui       |
| Danse classique           | Barre au sol classique                                                                | oui       |
| Danses jazz               | Modern jazz, afro-jazz, claquettes, comédie musicale, cabaret, disco                  | oui       |
| Danse contemporaine       | Ateliers de création, barre au sol contemporaine                                      | non       |
| Pole - aérien             | Danses aériennes, pole dance, pole sport                                              | oui       |
| Danse historique          | Pas de style détaillé                                                                 | non       |
| Danses du monde           | Danses ethniques, flamenco, tango argentin, danses traditionnelles                    | non       |

« Latines & standards » (compétition, en couple) et « Danses de salon » (loisir) sont deux familles distinctes. L'app ne couvre aujourd'hui que la première.

Seule la famille « Latines & standards » est reprise au départ (seed + migration). Les autres familles arrivent quand leurs styles et leurs capacités sont confirmés. Le formulaire d'inscription peut toutefois proposer les 12 familles dès l'étape 1, avec le seul socle commun.

### 2. Des capacités déclarées par domaine

Une **capacité** est une fonctionnalité que le domaine utilise. La liste est **fermée** et définie dans `@ffd-connect/shared` : une nouvelle capacité veut dire du nouveau code. Les capacités sont stockées en `String[]` sur le domaine. Liste initiale :

| Capacité              | Ce qu'elle active                                                            | Latines & standards |
| --------------------- | ---------------------------------------------------------------------------- | ------------------- |
| `COUPLE`              | Partenariats, couples, inscription en couple                                 | oui                 |
| `TEAM`                | Équipes et formations (`SoloTeam`)                                           | oui                 |
| `PASSPORT`            | Passeport Danse (couleurs) et règles d'accès aux niveaux                     | oui                 |
| `COMPETITION_LEVELS`  | Niveaux de compétition par discipline (Débutant → International)             | oui                 |
| `TEMPO_PLAYER`        | Lecteur au tempo réglementaire (MPM)                                         | oui                 |
| `COMPETITION_SKATING` | Épreuves en rounds jugées au Skating System, import TopTurnier, liaison WDSF | oui                 |

Le code teste une capacité (`hasCapability(domain, "PASSPORT")`), jamais un code de discipline. Les règles réellement propres à la danse sportive (10 danses = Latine + Standard, Passeport Jaune/Orange commun) restent dans un module dédié, appelé seulement quand la capacité est présente.

Le moteur de compétition d'une autre discipline est une **nouvelle capacité avec son propre module**, pas un réglage du moteur actuel. Huit familles sur douze publient des résultats de compétition, sous des formats très différents. Exemples de capacités futures, à confirmer famille par famille :

- battles de breaking ;
- concours artistiques en solo ou en groupe, avec variations imposées (classique, jazz) ;
- jugement du rock acrobatique ;
- compétitions de pole sport.

### 3. Les disciplines d'un danseur et d'un club

- **`UserDiscipline`** (userId, disciplineId, niveau Passeport, niveau de compétition, principale ou non), unique sur (userId, disciplineId). Elle remplace `User.category` et les colonnes `…Latin` / `…Standard`. Un niveau dont le domaine n'a pas la capacité correspondante reste vide.
- **`ClubDiscipline`** (clubId, disciplineId) : les disciplines proposées par le club (#1025).
- **`Event.disciplineId`** remplace `Event.category`. Côté inscriptions, la discipline du couple se déduit de l'épreuve au lieu des booléens `coupleDiscipline…`.

Les capacités d'un utilisateur sont l'union des capacités des domaines de ses disciplines et de celles de son club.

### 4. N'afficher que ce qui concerne chacun

- Client : un store Zustand des capacités, alimenté par le profil et le club. Un utilitaire unique `hasCapability` masque onglets, écrans, champs et filtres (#1026).
- Back-office : même logique sur les fiches licencié et club. Un administrateur voit tout.
- Le socle commun reste visible pour tous.
- Un compte sans discipline déclarée garde l'affichage actuel (danse sportive) jusqu'à la reprise de ses données.

### 5. Migration en étapes, toutes additives

| Étape | Contenu                                                                                                         | Issue        |
| ----- | --------------------------------------------------------------------------------------------------------------- | ------------ |
| 1     | Tables du référentiel, seed de la danse sportive, `GET /disciplines`                                            | #1022        |
| 2     | `UserDiscipline`, double écriture avec les anciennes colonnes, reprise de l'existant                            | #1023        |
| 3     | Lecture basculée sur le référentiel et `UserDiscipline`, repli sur les anciennes colonnes, `Event.disciplineId` | #1024        |
| 4     | Disciplines du club, affichage par capacité                                                                     | #1025, #1026 |
| 5     | Arrêt de la double écriture, puis suppression des anciennes colonnes dans un déploiement distinct               | #1029        |

L'étape 5 n'a lieu qu'une fois la version minimale de l'app relevée au-delà des clients qui lisent les anciens champs. La révision précédente du backend ne doit pas non plus en dépendre, pour garder le retour arrière.

## Alternatives Considered

### Alternative 1 : ajouter des colonnes et des valeurs pour chaque nouvelle discipline

- **Pros** : aucun refactor, chaque discipline s'ajoute vite au début.
- **Cons** : une migration et une modification de dizaines de fichiers par discipline, des listes recopiées qui divergent, et des `if (discipline === …)` partout.
- **Why not** : la charge croît avec chaque discipline, et rien ne permet de cacher à un club les fonctions qui ne le concernent pas.

### Alternative 2 : une application ou une instance par domaine

- **Pros** : isolation complète, chaque domaine évolue à son rythme.
- **Cons** : le socle commun (licences, clubs, paiements, notifications) serait dupliqué. Un danseur qui pratique deux domaines aurait deux comptes. Le coût d'infrastructure serait multiplié, alors que le budget est serré (ADR-0019).
- **Why not** : la fédération attend un outil unique, et le socle est justement ce qui a le plus de valeur.

### Alternative 3 : des feature flags par club, réglés à la main

- **Pros** : simple à mettre en place, aucun modèle de discipline.
- **Cons** : ne dit pas _pourquoi_ une fonction est active. Le danseur n'est pas couvert (il peut pratiquer deux domaines). Les réglages se recopient club par club.
- **Why not** : la discipline est la bonne clé métier, et les capacités s'en déduisent sans réglage manuel.

### Alternative 4 : des capacités par discipline plutôt que par domaine

- **Pros** : plus fin (ex. le breaking sans `COUPLE`, le rock avec).
- **Cons** : plus de réglages, et des incohérences possibles dans un même domaine.
- **Why not** : on commence au niveau du domaine. Si une discipline s'écarte de son domaine, on la place dans un autre domaine ou on ajoute une surcharge par discipline, sans changer le principe.

## Consequences

### Positive

- Une nouvelle discipline s'ajoute par données (seed, puis back-office #1027), sans migration ni déploiement, tant qu'elle n'a pas besoin d'une capacité nouvelle.
- Chaque utilisateur ne voit que les modules de ses domaines ; le socle sert tout le monde.
- Fin des listes recopiées entre backend, client et back-office.
- Le ciblage par discipline (notification #648, statistiques) s'appuie sur une donnée structurée et non sur du texte libre.

### Negative

- Refactor large et mécanique (environ 80 fichiers et leurs tests), étalé sur plusieurs PR.
- Une période de double écriture, avec un risque de divergence à surveiller.
- Un aller-retour réseau de plus au démarrage du client (`GET /disciplines`), absorbé par le cache et le préchauffage existant (`backendWake.ts`).

### Risks

- **La liste publiée sur le site ne correspond pas au référentiel interne de la fédération** (licences, extranet) : seule « Latines & standards » est reprise tant que #1020 n'est pas tranchée. Ajouter ou renommer une famille ne demande pas de code.
- **Reprise incorrecte des données** (« Ten Dance », casse et variantes en texte libre) : reprise idempotente, comptes avant/après sur une copie de staging, repli de lecture sur les anciennes colonnes jusqu'à l'étape 5.
- **Promesse excessive à la fédération** : ce découpage ouvre le socle à toutes les disciplines. Les compétitions de chaque nouvelle discipline restent un module à construire, à prioriser une par une.
