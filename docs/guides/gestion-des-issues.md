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
| Une PR                                                                        | Référence au moins une issue : `Refs #N` pour un changement visible (validé ensuite en bêta), `Closes #N` sinon — voir §8.                                                                                                            |
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

Une epic porte le **type `Epic`** ; son titre nomme le thème, **sans préfixe
`EPIC:` ni `DOMAINE:`** (ex. `Licence dans Apple Wallet / Google Wallet`) : le
type suffit à la distinguer, et les vues du Project la filtrent par type.

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

## Pour le public ← feature / epic visible par l'utilisateur

Une phrase en français simple pour un danseur ou un club, publiée telle quelle
sur le site vitrine (avec le label `roadmap`, §5).

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
| `Feature` | Une capacité nouvelle pour un utilisateur.                                      |
| `Epic`    | Un thème qui regroupe des sub-issues ; ne porte pas de code (§7).               |
| `Task`    | Travail technique sans effet utilisateur direct (CI, dette, infra, doc, tests). |

Les labels `bug` / `enhancement` restent tolérés sur les anciennes issues, mais le
**type fait foi** : les modèles ne les posent plus, et le label `epic` est
remplacé par le type `Epic`.

## 5. Priorité, effort et labels

La priorité et l'effort sont des **champs d'issue** de l'organisation (panneau
latéral de l'issue, colonnes `Priority` et `Effort` du Project), **pas des
labels** : un champ n'accepte qu'une valeur, et les vues du Project peuvent
trier et regrouper dessus. Ces champs ne sont visibles que des membres de
l'organisation.

**Priority** — exactement une sur toute issue ouverte, sauf `icebox` et sauf
une issue de type `Epic` (l'urgence d'une epic se lit sur ses sub-issues) :

| `Priority` | Sens                                                                                   | Milestone                                         |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `Urgent`   | Bloquant, sécurité, RGPD, donnée fausse montrée à l'utilisateur — à traiter maintenant | `Bêta — correctifs prioritaires`                  |
| `High`     | Bêta, prochain cycle                                                                   | `Bêta — correctifs prioritaires`                  |
| `Medium`   | Nécessaire au lancement public                                                         | `v1.0 — Lancement public`                         |
| `Low`      | Plus tard                                                                              | `v1.1 — Engagement` / `v2.0 — Communauté & Admin` |

**Effort** — estimation grossière, posée au tri et corrigée quand on en sait
plus (y compris sur une idée en `icebox`) :

| `Effort` | Ordre de grandeur                                                    |
| -------- | -------------------------------------------------------------------- |
| `Low`    | Moins d'une demi-journée, correctif localisé                         |
| `Medium` | Un à trois jours, plusieurs fichiers ou une PR de taille normale     |
| `High`   | Plusieurs jours, plusieurs PR, ou dépendance externe (tiers, stores) |

`Start date` / `Target date` (champs d'issue également) sont facultatifs ; ils
alimentent la vue 🗺 Roadmap quand on veut dater un travail précis.

Les champs se posent dans l'interface ou par l'API GraphQL
(`setIssueFieldValue`, champs listés par `list_issue_fields` sur
l'organisation) ; `gh issue edit` ne sait pas les modifier.

Chaque issue ouverte porte aussi des **labels** :

1. `icebox` pour une idée non planifiée (pas de priorité ni de milestone).
2. **Une ou plusieurs zones** : `backend`, `client`, `admin`, `landing`,
   `infra`, `ci`, `packages`, `testing`, `documentation`, `dependencies`.
3. **Des domaines** si utile : `auth`, `license`, `competitions`, `club`,
   `player`.
4. **Un statut** si pertinent : `blocked` (une autre issue ou un tiers
   bloque), `needs-device-test` (code livré, reste une validation sur appareil).
5. `roadmap` pour une évolution à annoncer sur la feuille de route publique du
   site vitrine (section « Le projet »). À la création ou au tri d'une issue
   `Feature` ou `Epic`, on se demande si un danseur ou un club la comprendrait
   et s'y intéresserait. Si oui : label `roadmap` **et** section
   `## Pour le public` (§3) — une phrase en français simple écrite pour un
   utilisateur final, sans jargon ni détail interne. Le site lit directement
   l'API GitHub publique et n'affiche une issue `roadmap` **que si** cette
   section est non vide ; seul son premier paragraphe est publié, tel quel
   (Markdown retiré), regroupé par milestone ouverte — ni le titre, ni les
   labels, ni le reste de la description.
   - **Jamais** pour la CI, les dépendances, les tests, la sécurité ou le RGPD
     internes, l'infra, la dette, ce qui ne concerne que le back-office, ni
     pour un correctif de bug.
   - La phrase suit le périmètre : on la met à jour quand il change, et on
     retire le label si la fonctionnalité est abandonnée.

On réutilise les labels existants ; on n'en crée un nouveau qu'en le
documentant ici.

## 6. Milestones (par ordre d'importance)

1. **Bêta — correctifs prioritaires** : sécurité, RGPD, bugs remontés par les testeurs.
2. **v1.0 — Lancement public** : ce qui doit être vrai avant d'ouvrir à tous.
3. **v1.1 — Engagement**.
4. **v2.0 — Communauté & Admin**.

On travaille d'abord dans le milestone ouvert le plus haut de la liste.

**Description d'un milestone** — toujours ce format, dans cet ordre :

```markdown
🎯 Objectif : une phrase — ce qui est vrai pour l'utilisateur quand le milestone est fermé.

✅ Critères de sortie :

- condition vérifiable ;
- …
- aucun P<n> ouvert dans ce milestone.

📦 Périmètre : les epics couvertes (#N Nom), en précisant le volet quand une epic est partagée entre milestones.

🚫 Hors périmètre : ce qui est explicitement repoussé, et vers quel milestone.

📅 Échéance : une date, ou la condition qui permettra de la fixer.
```

Quand le périmètre change (epic ajoutée ou repoussée), on met la description à
jour dans la foulée ; un milestone se ferme quand ses critères de sortie sont
tous remplis.

## 7. Relations

| Relation                 | Outil GitHub                                     | Règle                                                                                                  |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Appartient à un thème    | **Sub-issue** de l'epic (Relationships → Parent) | Un seul parent. L'epic tient à jour sa liste de livrables quand un enfant se ferme.                    |
| Dépend d'une autre issue | **Blocked by** (Relationships)                   | + label `blocked` tant que le bloquant est ouvert.                                                     |
| Doublon                  | Fermeture `duplicate`                            | Commentaire « Fusionnée dans #X » ; le contenu utile est recopié dans l'issue gardée.                  |
| Résolue par une PR       | `Closes #N` ou `Refs #N` (voir §8)               | Sur une base autre que `develop`, la fermeture automatique ne joue pas : fermer à la main après merge. |
| Mentionne sans dépendre  | `#N` dans le texte                               | —                                                                                                      |

Une epic ne porte pas de code : elle se ferme quand toutes ses sub-issues sont
fermées (ou sorties du périmètre, avec mention).

## 8. Project « FFD Connect — Roadmap »

Toute issue ouverte est dans le Project de l'organisation. Sa colonne
`Status` suit le cycle de vie de la tâche ; le workflow
`.github/workflows/project-status.yml` la fait avancer tout seul à partir des
PR vers `develop`, des promotions vers `staging` et des issues :

| `Status`      | Quand                                                                | Déclencheur automatique                                             |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Todo`        | Issue triée (type, priorité, effort, milestone posés), pas commencée | issue ouverte / rouverte, PR fermée sans merge                      |
| `In Progress` | On travaille dessus (branche, PR draft)                              | PR **draft** qui référence l'issue                                  |
| `In Review`   | PR prête à relire                                                    | PR passée « Ready for review »                                      |
| `Merged`      | Mergée sur `develop`, pas encore chez les testeurs                   | PR mergée avec `Refs #N`                                            |
| `In Beta`     | Sur `staging` : testable sur TestFlight / Play, à valider            | promotion `develop` → `staging` mergée (toutes les cartes `Merged`) |
| `Done`        | Validée, issue fermée                                                | issue fermée (à la main après test, ou `Closes`)                    |

**`Refs` ou `Closes` dans la PR ?**

- Changement **visible par un utilisateur** (écran, parcours, notification…) :
  `Refs #N`. L'issue passe `Merged` au merge, puis `In Beta` à la promotion vers
  `staging` ; on la ferme (`completed`) à la main une fois validée sur la bêta,
  ce qui la passe `Done`.
- Changement **sans effet visible** (CI, infra, doc, refactor, tests,
  dépendances) : `Closes #N`. Merge ⇒ issue fermée ⇒ `Done`.

Le **même mot-clé** vaut pour les messages de commit : un squash merge recopie
les messages des commits dans le commit final, et GitHub ferme toute issue
qu'il y trouve après `Closes` / `Fixes` / `Resolves`, même si la PR dit
`Refs`. Avec la file de fusion de `develop` (#493), le message du squash est
le titre + la description de la PR : ce sont ses `Refs` / `Closes` qui font
foi, mais on évite quand même `Closes` dans un message de commit d'une PR
`Refs`. Sans file, on vérifie le message du squash au merge (`gh pr merge
--squash --body …` pour le réécrire). Si une issue s'est fermée par erreur, on la
rouvre avec un commentaire et on la remet `Merged` (ou `In Beta` si la
promotion a déjà eu lieu).

Quand on commence une tâche sans PR (investigation, test sur appareil), on la
passe `In Progress` à la main :
`gh project item-edit` ou `.github/scripts/project-status.sh "In Progress" N`
(avec un `GH_TOKEN` ayant le scope `project`).

Les champs `Milestone`, `Labels`, `Parent issue` et `Sub-issues progress` du
Project se lisent depuis l'issue : on ne les double pas.

**Vues du Project** — chacune répond à une question :

| Vue              | Question                                    | Contenu                                                                   |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| 📋 Backlog       | Que reste-t-il à commencer ?                | `Todo` ouvertes, hors epics et icebox, par milestone, triées par priorité |
| 🗂 Kanban        | Où en est chaque tâche ?                    | Colonnes par `Status`, hors epics et icebox                               |
| 🔥 Urgent & High | Qu'est-ce qui est urgent ?                  | Issues ouvertes `Urgent`/`High`, par `Status`                             |
| 🗺 Roadmap       | Quand arrive quoi ?                         | Frise par milestone (dates = échéances des milestones)                    |
| 🏁 Par milestone | Qu'est-ce qui bloque la prochaine version ? | Issues ouvertes par milestone, triées par `Status`                        |
| 🧭 Epics         | Où en est chaque thème ?                    | Epics avec leur progression de sub-issues                                 |
| 🧊 Icebox        | Quelles idées sont en attente ?             | Issues `icebox`                                                           |

Les vues ne montrent que le dépôt `FFD-Connect` (les cartes de l'ancien dépôt
d'archive sont filtrées).

## 9. Fermer

Toujours avec un `state_reason` et un commentaire d'une ligne :

- `completed` — cite la PR (« Livré par #N »).
- `not_planned` — dit pourquoi (dépassée, hors périmètre, remplacée par #N).
- `duplicate` — « Fusionnée dans #N ».

Une issue périmée est **questionnée puis fermée**, pas gardée par défaut. Le
backlog est revu à chaque fin de cycle bêta par l'agent `project-manager`.
