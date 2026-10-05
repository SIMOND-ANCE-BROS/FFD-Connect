# Épreuves de danse en solo – Règles (Règlement Sportif FFDanse)

Ce document décrit les règles implémentées pour les **solos** : regroupements d'âges, niveaux, licence, passeport et répartition des danses.

---

## 1. Classes d'âges – Regroupements

Les épreuves solo sont organisées par **regroupement** de classes d'âges :

| Regroupement        | Classes détaillées concernées    |
| ------------------- | -------------------------------- |
| **Moins de 14 ans** | Juvénile 1, Juvénile 2, Junior 1 |
| **Moins de 19 ans** | Junior 2, Youth                  |
| **Moins de 30 ans** | Adulte (< 30 ans)                |
| **30 ans et Plus**  | Senior (30 ans et plus)          |

- **Implémenté** : `computeSoloAgeRegroupement(birthDate, referenceYear)` et `getSoloRegroupementFromAgeGroup(soloAgeGroup)` dans `apps/backend/src/common/solo-rules/solo-rules.util.ts`.
- L'âge est retenu au **31 décembre** de l'année de référence (aligné sur le Règlement Sportif).

---

## 2. Niveaux

Dans chaque regroupement d'âges, les niveaux organisés sont :

- **Novice**
- **Confirmé**
- **Expérimenté**

### 2.1 Licence minimale

- **Novice** : titulaire au minimum d’un **titre découverte**.
- **Confirmé** et **Expérimenté** : titulaire au minimum de la **licence B**.

(Constantes `MIN_LICENCE_FOR_SOLO_LEVEL` ; la vérification effective de la licence reste à brancher sur le modèle utilisateur/licence.)

### 2.2 Passeport Danse (couleur minimale)

- **Novice** : aucune couleur exigée.
- **Confirmé** : au moins la couleur **Orange** du Passeport Danse.
- **Expérimenté** : au moins la couleur **Verte** du Passeport Danse.

Pour **accéder** à Confirmé ou Expérimenté : le danseur doit justifier de **5 compétitions classificatrices** et de la couleur de passeport correspondante. Les changements de niveau ont lieu **au début de chaque saison**.

- **Implémenté** : `soloMeetsPassportForLevel(latin, standard, level)`, `meetsPassportForSoloConfirmé`, `meetsPassportForSoloExperimente`. La condition « 5 compétitions classificatrices » est à gérer côté métier (données de participation).

---

## 3. Répartition des danses

Dans chaque spécialité, par niveau :

- **Novice** : **3 danses** (classement sur le total des 3 danses).
- **Confirmé** : **4 danses**.
- **Expérimenté** : **5 danses**.

### 3.1 Danses Latines

| Niveau      | Danses                                          |
| ----------- | ----------------------------------------------- |
| Novice      | Cha cha cha / Rumba / Jive                      |
| Confirmé    | Samba / Cha cha cha / Rumba / Jive              |
| Expérimenté | Samba / Cha cha cha / Rumba / Paso Doble / Jive |

### 3.2 Danses Standards

| Niveau      | Danses                                                         |
| ----------- | -------------------------------------------------------------- |
| Novice      | Valse Anglaise / Tango / Quickstep                             |
| Confirmé    | Valse Anglaise / Tango / Valse Viennoise / Quickstep           |
| Expérimenté | Valse Anglaise / Tango / Valse Viennoise / Slowfox / Quickstep |

- **Implémenté** : `SOLO_LATINES_DANCES_BY_LEVEL`, `SOLO_STANDARDS_DANCES_BY_LEVEL`, `DANCE_COUNT_BY_SOLO_LEVEL`, et `getSoloDancesForLevelAndCategory(level, category)`.

---

## 4. Fichiers

- **Backend** : `apps/backend/src/common/solo-rules/solo-rules.util.ts` et `apps/backend/src/common/solo-rules/index.ts`.
- **Exports** : regroupements, niveaux, listes de danses, conditions licence/passeport et helpers de calcul (regroupement à partir de la date de naissance ou de la classe d’âge détaillée).
