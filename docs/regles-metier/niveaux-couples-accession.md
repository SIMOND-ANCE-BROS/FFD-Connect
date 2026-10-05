# Niveaux des couples – Conditions d'accession (Règlement Sportif FFDanse)

Ce document décrit les règles implémentées et à compléter pour l'accession aux niveaux supérieurs (Intermédiaire, Avancé, International).

---

## 1. Implémenté dans l’application

### 1.1 Couleurs Passeport Danse (ordre)

Ordre des couleurs du Passeport Danse (du plus bas au plus haut) :  
**BLANC → BEIGE → JAUNE → ORANGE → VERT → VIOLET → BLEU → ROUGE → NOIR**.

- Utilisé dans : `apps/backend/src/common/level-accession/level-accession.util.ts`.
- Pour chaque partenaire, on retient le **meilleur** des deux (Latine et Standard) pour vérifier « au moins X ».

### 1.2 Accession au niveau Intermédiaire (2.1)

- **Règle** : Les couples de niveau Débutant peuvent passer en Intermédiaire à tout moment dans la saison, sur demande du responsable technique, **à condition que les deux partenaires aient validé au moins la couleur « orange »** du Passeport Danse.
- **Implémenté** : Vérification passeport (les deux au moins orange). La « demande du responsable technique » relève du workflow métier (non automatisé ici).
- **Utilisation** : Lors de la **création d’un couple**, le niveau conseillé et la liste des niveaux autorisés sont calculés en tenant compte de la classe d’âge, du plafond éventuel (art. 3) et **des couleurs de passeport** (art. 2.1, 2.2, 2.3). Un niveau n’est proposé que si les deux partenaires ont la couleur minimale requise.

### 1.3 Plafond de niveau selon la classe d’âge (3.1–3.5)

En cas de changement de classe d’âge, le niveau maximum autorisé est plafonné :

| Classe d’âge du couple | Niveau maximum |
| ---------------------- | -------------- |
| Juvénile I             | Intermédiaire  |
| Juvénile II            | Intermédiaire  |
| Junior I               | Intermédiaire  |
| Junior II              | Avancé         |
| Youth                  | Avancé         |
| Adulte, Senior I–V     | International  |

- **Implémenté** : `getMaxLevelForCoupleAgeGroup()` et prise en compte dans `getAllowedLevelsForCouple()`.

### 1.4 Niveau Débutant

- Aucune couleur de passeport exigée pour le niveau Débutant (règlement : licence C minimum).

---

## 2. À compléter avec les données de participation

### 2.2 Accession au niveau Avancé (2.2)

Les couples sont classés en **Avancé au 1er septembre** si, après **au moins 2 saisons** (complètes ou non), les **3 conditions** suivantes sont réunies :

1. Participation à **2 Critériums Nationaux** (sauf si aucun Critérium n’est organisé dans une saison).
2. **8 épreuves classificatrices** validées, en plus des 2 Critériums Nationaux.
3. **Les deux partenaires** sont titulaires au moins de la couleur **« violet »** du Passeport Danse.

- **Implémenté** : condition passeport (violet) uniquement : `meetsPassportForAvance()`.
- **À faire** : lier les inscriptions / résultats aux compétitions (type MAJEURE, nature Critérium National vs épreuve classificatrice) et compter les saisons, les 2 Critériums et les 8 épreuves classificatrices pour décider de l’accession automatique ou de la proposition de passage Avancé.

### 2.3 Accession au niveau International (2.3)

Les couples **Adulte et Seniors** sont classés en **International au 1er septembre** si, **dans la saison en cours**, les **3 conditions** suivantes sont réunies :

1. Participation aux **2 derniers Critériums Nationaux** (sauf si aucun n’est proposé).
2. **750 points** obtenus sur les **deux dernières saisons**.
3. **Les deux partenaires** sont titulaires au moins de la couleur **« rouge »** du Passeport Danse.

- **Implémenté** : condition passeport (rouge) uniquement : `meetsPassportForInternational()`.
- **À faire** : calcul des points (règles WDSF/FFDanse), suivi des participations aux 2 derniers Critériums, et mise à jour du niveau au 1er septembre (batch ou procédure).

---

## 3. Reclassement (3.6)

Le **reclassement** permet de gérer les cas exceptionnels : le responsable technique peut proposer un niveau et effectuer une demande de **« Validation du niveau d’un couple »** selon la procédure de l’Article 5. Ce flux n’est pas encore implémenté (validation manuelle / workflow à définir).

---

## 4. Fichiers concernés

- **Backend**
  - `apps/backend/src/common/level-accession/level-accession.util.ts` : ordre passeport, conditions 2.1–2.3 (passeport), plafonds 3.1–3.5, `getAllowedLevelsForCouple()`.
  - `apps/backend/src/clubs/clubs.service.ts` : création de couple → utilisation de `getAllowedLevelsForCouple()` pour le niveau conseillé (passeport + âge + niveau des partenaires).
- **Schéma** : `User.passportLevelLatin`, `User.passportLevelStandard` (enum `PassportLevel`).
