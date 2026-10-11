# Niveaux de compétition – par discipline (Règlement Sportif FFDanse)

Ce document décrit comment l'application gère le **niveau de compétition** (Débutant, Intermédiaire, Avancé, International) et ce qui reste à compléter pour l'accession aux niveaux supérieurs.

---

## 1. Principe : un niveau par discipline

- Le niveau de compétition est **propre à chaque discipline** : un danseur peut être Débutant en Standards et International en Latines.
- Il est stocké sur l'utilisateur dans `competitionLevelLatin` et `competitionLevelStandard`.
- L'ancien champ unique `competitionLevel` est **déprécié** : il n'est plus lu qu'en repli (anciennes versions de l'app, rollback) et sera supprimé dans une migration ultérieure. La migration `20261009150000_user_competition_level_per_discipline` l'a recopié au mieux : discipline déclarée Latin → niveau Latines seulement, Standard → niveau Standards seulement, sinon (10 danses ou inconnue) les deux.
- Un back-office qui n'envoie que l'ancien champ voit sa valeur recopiée dans les deux disciplines.
- Toute règle qui dépend du niveau le lit via `getCompetitionLevelForCategory(user, disciplineDeLÉpreuve)` (`apps/backend/src/common/competition-level`).

### 1.1 10 danses

- Les épreuves 10 danses sont **uniquement des majeures**, ouvertes aux danseurs qui pratiquent **les deux disciplines** (Latines **et** Standards), **sans condition de niveau** (décision produit, révisable).
- « Pratique une discipline » = un niveau renseigné dans cette discipline **ou** la discipline déclarée (`category`, « Ten Dance » valant les deux). Profil sans aucune information de discipline : non bloquant.
- La déduction des épreuves depuis les documents FFD classe toute épreuve 10 danses en majeure, sans niveau.

### 1.2 Indépendance vis-à-vis du Passeport Danse

- Le niveau de compétition **n'est pas déduit** des couleurs du Passeport Danse (`passportLevelLatin` / `passportLevelStandard`, concept distinct).
- Le calcul du niveau conseillé à la création d'un couple ne filtre plus les niveaux selon le passeport (il le faisait auparavant).
- L'ordre des couleurs (`PASSPORT_LEVEL_ORDER`, `hasAtLeastPassport`) reste utilisé pour les niveaux **solo** Novice / Confirmé / Expérimenté (`solo-rules`), autre concept.

### 1.3 Plafond de niveau selon la classe d'âge (3.1–3.5)

En cas de changement de classe d'âge, le niveau maximum autorisé est plafonné :

| Classe d'âge du couple | Niveau maximum |
| ---------------------- | -------------- |
| Juvénile I             | Intermédiaire  |
| Juvénile II            | Intermédiaire  |
| Junior I               | Intermédiaire  |
| Junior II              | Avancé         |
| Youth                  | Avancé         |
| Adulte, Senior I–V     | International  |

- **Implémenté** : `getMaxLevelForCoupleAgeGroup()` et `getAllowedLevelsForCouple(classeDÂge)`.

### 1.4 Où le niveau par discipline est utilisé

- Éligibilité aux épreuves (liste des compétitions, écran de détail, inscription) : une seule règle, `evaluateEventEligibility`, pour que le badge « Inéligible » de la liste corresponde au détail.
- Inscription : sans niveau fourni, le niveau du profil dans la discipline de l'épreuve est utilisé.
- Notifications « Nouvelle compétition ».
- Niveau conseillé à la création d'un couple : un niveau par discipline (le plus bas des deux partenaires, borné par la classe d'âge).
- Niveau d'une Solo Team : le plus haut niveau de chaque membre, toutes disciplines confondues.

---

## 2. Accession aux niveaux supérieurs (à compléter)

Le règlement prévoit des conditions d'accession (2.1 Intermédiaire, 2.2 Avancé, 2.3 International : Critériums, épreuves classificatrices, points). Elles ne sont **pas automatisées** : le niveau de chaque discipline est saisi (back-office). Les conditions liées au Passeport Danse ne sont pas appliquées (décision produit, cf. 1.2).

---

## 3. Reclassement (3.6)

Le **reclassement** permet de gérer les cas exceptionnels : le responsable technique peut proposer un niveau et effectuer une demande de **« Validation du niveau d'un couple »** selon la procédure de l'Article 5. Ce flux n'est pas encore implémenté (validation manuelle / workflow à définir).

---

## 4. Fichiers concernés

- **Backend**
  - `apps/backend/src/common/competition-level/` : niveau par discipline, double pratique (10 danses), libellés français des disciplines.
  - `apps/backend/src/common/level-accession/level-accession.util.ts` : plafonds 3.1–3.5, ordre des couleurs du passeport (solo).
  - `apps/backend/src/competitions/services/competition-query.utils.ts` : éligibilité partagée liste / détail.
  - `apps/backend/src/clubs/partnership-suggestion.util.ts` : niveau conseillé par discipline.
- **Schéma** : `User.competitionLevelLatin`, `User.competitionLevelStandard` (+ `competitionLevel` déprécié), `User.passportLevelLatin`, `User.passportLevelStandard` (enum `PassportLevel`).
