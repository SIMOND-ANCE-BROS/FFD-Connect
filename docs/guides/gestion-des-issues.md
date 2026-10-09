# Gestion des issues — conventions

Les issues GitHub sont **la source de vérité du travail**. Tout ce qui se fait
(code, découverte, décision) est rattaché à une issue. Ce guide fixe la forme
d'une issue et la façon de la classer ; l'agent `project-manager` l'applique et
le fait respecter.

> Le dépôt est **public** : pas de nom de secret, pas de coûts internes, pas de
> donnée personnelle (nom de testeur, e-mail, n° de licence réel) dans une issue.

## 1. Tout est lié à une issue

| Situation                                                                     | Règle                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Une PR                                                                        | Référence au moins une issue : `Closes #N` / `Fixes #N` si elle la termine, `Refs #N` si elle n'en fait qu'une partie.                                                                                                                |
| Pas encore d'issue                                                            | La créer **avant** d'ouvrir la PR (après recherche de doublon).                                                                                                                                                                       |
| Découverte en cours de route (bug, dette, faille, test instable, doc périmée) | Ne pas corriger en silence ni la laisser dans la conversation : ouvrir une issue (ou commenter l'existante) avec la preuve. La corriger dans la PR courante seulement si c'est petit et dans le sujet — en la référençant quand même. |
| Décision structurante                                                         | ADR dans `docs/adr/` **et** issue qui la porte.                                                                                                                                                                                       |
| Corvée triviale (typo, lockfile)                                              | Peut référencer l'issue parapluie la plus proche.                                                                                                                                                                                     |

## 2. Titre

Format : **`DOMAINE: phrase en français`** — la phrase décrit le **résultat
attendu** (feature/tâche) ou le **symptôme observé** (bug), sans point final.

- Bon : `LICENCE: ne plus inventer de date d'expiration quand la licence n'en a pas`
- Bon (bug) : `NOTIF: la pastille ne se met pas à jour après lecture`
- Mauvais : `[BUG] souci licence`, `fix stuff`, `Amélioration`

Domaines autorisés (en majuscules) :

- Fonctionnels : `AUTH`, `LICENCE`, `WALLET`, `COMPÉTITION`, `MUSIQUE`,
  `NOTIF`, `CLUB`, `CARRIÈRE`, `COMMUNAUTÉ`, `ADMIN`, `HORS-LIGNE`
- Transverses : `RGPD`, `SÉCURITÉ`, `LÉGAL`, `RGAA`, `INFRA`, `CI`, `RELEASE`,
  `DÉPS`, `DOCS`, `QA`, `COÛT`

Une epic s'intitule **`EPIC: <thème>`** (ex. `EPIC: Licence dans Apple Wallet / Google Wallet`).

## 3. Description

Rédigée en **français**. Sections, dans cet ordre (supprimer celles qui ne
s'appliquent pas) :

```markdown
## Contexte

Pourquoi on en parle, en une ou deux phrases ; epic ou parcours concerné.

## Constat ← bug / découverte

Ce qui se passe, avec la preuve : `fichier:ligne`, PR, sortie de commande,
capture. Pour un bug : étapes de repro, attendu vs obtenu, environnement
(local / staging / build bêta n°…).

## Attendu ← feature / tâche

Le comportement visé, cas nominal et limites.

## Critères d'acceptation

- [ ] Vérifiable, un par ligne (inclure les tests à écrire)

## Hors périmètre

Ce qui n'est volontairement pas couvert.

## Liens

Epic parente, issues bloquantes, PR, ADR, doc.
```

Quand une issue vieillit, on ne réécrit pas son historique : on ajoute en tête
une section **`## État au AAAA-MM-JJ`** (cases cochées = fait, avec la PR).

## 4. Type

Le **type d'issue GitHub** dit la nature ; il est obligatoire :

| Type      | Pour                                                                            |
| --------- | ------------------------------------------------------------------------------- |
| `Bug`     | Un comportement existant est faux.                                              |
| `Feature` | Une capacité nouvelle pour un utilisateur (y compris une epic).                 |
| `Task`    | Travail technique sans effet utilisateur direct (CI, dette, infra, doc, tests). |

Les labels `bug` / `enhancement` restent tolérés pour l'historique, mais le
**type fait foi**.

## 5. Labels

Chaque issue ouverte porte :

1. **Une priorité** — exactement une, ou `icebox` à la place :

   | Label    | Sens                                                                                   | Milestone                                         |
   | -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
   | `P0`     | Bloquant, sécurité, RGPD, donnée fausse montrée à l'utilisateur — à traiter maintenant | `Bêta — correctifs prioritaires`                  |
   | `P1`     | Bêta, prochain cycle                                                                   | `Bêta — correctifs prioritaires`                  |
   | `P2`     | Nécessaire au lancement public                                                         | `v1.0 — Lancement public`                         |
   | `P3`     | Plus tard                                                                              | `v1.1 — Engagement` / `v2.0 — Communauté & Admin` |
   | `icebox` | Idée non planifiée                                                                     | aucun                                             |

2. **Une ou plusieurs zones** : `backend`, `client`, `admin`, `landing`,
   `infra`, `ci`, `packages`, `testing`, `documentation`, `dependencies`.
3. **Des domaines** si utile : `auth`, `license`, `competitions`, `club`,
   `player`.
4. **Un statut** si pertinent : `epic`, `blocked` (une autre issue ou un tiers
   bloque), `needs-device-test` (code livré, reste une validation sur appareil).

On réutilise les labels existants ; on n'en crée un nouveau qu'en le
documentant ici.

## 6. Milestones (par ordre d'importance)

1. **Bêta — correctifs prioritaires** : sécurité, RGPD, bugs remontés par les testeurs.
2. **v1.0 — Lancement public** : ce qui doit être vrai avant d'ouvrir à tous.
3. **v1.1 — Engagement**.
4. **v2.0 — Communauté & Admin**.

On travaille d'abord dans le milestone ouvert le plus haut de la liste.

## 7. Relations

| Relation                 | Outil GitHub                                     | Règle                                                                                                  |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Appartient à un thème    | **Sub-issue** de l'epic (Relationships → Parent) | Un seul parent. L'epic tient à jour sa liste de livrables quand un enfant se ferme.                    |
| Dépend d'une autre issue | **Blocked by** (Relationships)                   | + label `blocked` tant que le bloquant est ouvert.                                                     |
| Doublon                  | Fermeture `duplicate`                            | Commentaire « Fusionnée dans #X » ; le contenu utile est recopié dans l'issue gardée.                  |
| Résolue par une PR       | `Closes #N` dans la PR                           | Sur une base autre que `develop`, la fermeture automatique ne joue pas : fermer à la main après merge. |
| Mentionne sans dépendre  | `#N` dans le texte                               | —                                                                                                      |

Une epic ne porte pas de code : elle se ferme quand toutes ses sub-issues sont
fermées (ou sorties du périmètre, avec mention).

## 8. Project « FFD Connect — Roadmap »

Toute issue ouverte est dans le Project de l'organisation.

| `Status`      | Quand                                          |
| ------------- | ---------------------------------------------- |
| `Todo`        | Issue triée (type, priorité, milestone posés). |
| `In Progress` | Une branche ou une PR existe.                  |
| `Done`        | Issue fermée (automatique).                    |

Les champs `Milestone`, `Labels`, `Parent issue` et `Sub-issues progress` du
Project se lisent depuis l'issue : on ne les double pas.

## 9. Fermer

Toujours avec un `state_reason` et un commentaire d'une ligne :

- `completed` — cite la PR (« Livré par #N »).
- `not_planned` — dit pourquoi (dépassée, hors périmètre, remplacée par #N).
- `duplicate` — « Fusionnée dans #N ».

Une issue périmée est **questionnée puis fermée**, pas gardée par défaut. Le
backlog est revu à chaque fin de cycle bêta par l'agent `project-manager`.
