# Rôles utilisateur — FFD Connect

Ce document clarifie les **rôles métier** (terminologie FFD), leur correspondance avec les rôles techniques actuels, et une **proposition de restructuration** des noms pour plus de clarté.

---

## Rôles métier (définitions FFD)

| Rôle métier          | Définition                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Licencié**         | Pratiquant du sport ayant une licence FFD.                                                                                                              |
| **Structure (Club)** | Regroupement de sportifs. Souvent organisateur d’événements. La personne qui **représente** le club gère les membres, inscriptions, paramètres du club. |
| **Staff**            | Membre de la FFD pouvant être organisateur d’événement (ou avoir des droits particuliers, ex. scanner).                                                 |
| **Admin**            | Administration de la plateforme (hors Licencié / Structure / Staff).                                                                                    |

---

## État actuel (rôles techniques)

**Backend Prisma :**

```prisma
enum UserRole {
  USER      // → Licencié
  ADMIN     // → Admin plateforme
  ORGANIZER // → Structure (Club) — nom trompeur car on pense "organisateur d’événement"
}
```

**Problèmes :**

- `USER` est générique (pas explicite “licencié”).
- `ORGANIZER` prête à confusion : on pense à “organisateur de la compétition”, alors que le rôle désigne le **représentant du club** (structure).
- Pas de rôle dédié **Staff** en base (mélangé avec ORGANIZER / ADMIN).

---

## Proposition de restructuration des noms

Renommer les rôles pour qu’ils reflètent directement le métier :

| Actuel      | Proposé        | Signification                                                                |
| ----------- | -------------- | ---------------------------------------------------------------------------- |
| `USER`      | **`LICENSEE`** | Licencié — pratiquant avec licence FFD.                                      |
| `ORGANIZER` | **`CLUB`**     | Structure (Club) — représentant du club (membres, inscriptions, paramètres). |
| _(absent)_  | **`STAFF`**    | Staff FFD — peut organiser des événements, accès scanner, etc.               |
| `ADMIN`     | **`ADMIN`**    | Inchangé — administration plateforme.                                        |

**Nouvel enum Prisma proposé :**

```prisma
enum UserRole {
  LICENSEE  // Licencié
  CLUB      // Structure (Club)
  STAFF     // Staff FFD
  ADMIN     // Administration plateforme
}
```

**Côté client :** conserver **`GUEST`** (mode invité, sans compte). Les types deviennent : `'LICENSEE' | 'CLUB' | 'STAFF' | 'ADMIN' | 'GUEST'`.

### Bénéfices

- **LICENSEE** : clair = pratiquant licencié.
- **CLUB** : plus de confusion avec “organisateur d’événement” ; le rôle désigne bien la structure/club.
- **STAFF** : rôle explicite pour les membres FFD (scanner, organisation événements), distinct du club.

### Impact technique

- **Backend :** migration Prisma (renommer `USER` → `LICENSEE`, `ORGANIZER` → `CLUB`, ajouter `STAFF`), puis mise à jour de tous les usages de `UserRole` (guards, services, contrôleurs, seeds, tests).
- **Client :** mise à jour du type `UserRole` et de toutes les comparaisons (`role === 'ORGANIZER'` → `role === 'CLUB'`, etc.).
- **Migration des données :** mise à jour des lignes existantes en base (`USER` → `LICENSEE`, `ORGANIZER` → `CLUB` ; décider quels comptes passer en `STAFF` si besoin).

---

## Rôles côté client (après restructuration)

| Rôle         | Usage                                     |
| ------------ | ----------------------------------------- |
| **LICENSEE** | Licencié (sync backend).                  |
| **CLUB**     | Représentant de structure (sync backend). |
| **STAFF**    | Staff FFD (sync backend).                 |
| **ADMIN**    | Admin (sync backend).                     |
| **GUEST**    | Invité sans compte (client uniquement).   |

---

## Résumé

- **Actuel :** USER (Licencié), ORGANIZER (Club), ADMIN ; pas de STAFF en base.
- **Proposé :** LICENSEE, CLUB, STAFF, ADMIN — noms alignés sur le métier FFD.
- **Suite possible :** valider la proposition puis planifier migration Prisma + mise à jour backend/client (et éventuellement script de migration des rôles existants).
