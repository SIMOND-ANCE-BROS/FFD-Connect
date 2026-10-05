# Module d'inscription aux compétitions — Licencié vs Club

Ce document décrit précisément le fonctionnement du module d'inscription aux épreuves, selon le **point de vue Licencié** et le **point de vue Club** (structure), ainsi que les **modes d'inscription** et les **notifications**.

---

## 1. Données et rôles

- **Registration** : une inscription lie un **utilisateur** à un **événement** (épreuve), avec un statut : `PENDING`, `CONFIRMED`, ou `CANCELLED`.
- **Licencié** (rôle `LICENSEE`) : pratiquant avec licence FFD, rattaché à un club via **`User.clubId`** (référence vers `Club.id`) et éventuellement `User.clubName` (affichage / rétrocompatibilité).
- **Club** (rôle `CLUB`) : représentant d’une structure ; a un **`clubId`** (l’entité `Club`) et un `clubName`, et peut gérer les membres de son club (inscriptions, paramètres). Le lien licencié–club repose sur l’**identifiant unique du club** (`clubId`) pour les contrôles et requêtes ; le nom reste utilisé pour l’affichage et la compatibilité.
- Chaque **Club** (entité) a un **mode d’inscription** (`Club.registrationMode`) qui détermine comment les licenciés de ce club s’inscrivent (voir ci‑dessous).

---

## 2. Modes d’inscription du club (backend : `ClubRegistrationMode`)

Le mode est défini **par club** (paramètre de la structure). Il s’applique à **tous les licenciés dont le `clubName` correspond à ce club**.

| Mode (backend)               | Libellé / usage                        | Comportement                                                                                                                                                      |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLUB_AND_MEMBERS_PENDING** | « Licence en attente de validation »   | Le licencié peut **s’inscrire lui‑même** ; l’inscription est créée en **PENDING**. Le club doit **valider** (ou refuser) pour passer en CONFIRMED (ou CANCELLED). |
| **CLUB_ONLY**                | « Inscription par le club uniquement » | Le licencié **ne peut pas** s’inscrire lui‑même (erreur 403 côté API). Seul le club peut l’inscrire (inscription directement **CONFIRMED**).                      |
| **MEMBERS_AUTO_CONFIRM**     | « Auto‑validation des licenciés »      | Le licencié peut **s’inscrire lui‑même** ; l’inscription est créée directement en **CONFIRMED** (pas de validation club).                                         |

- **Paramétrage** : le représentant du club (rôle CLUB) définit le mode dans **Paramètres** (client) → appel à `PATCH /clubs/me/registration-mode` avec `registrationMode`.
- **Côté licencié** : le client appelle `GET /clubs/me/registration-mode` pour savoir si l’auto‑inscription est autorisée (`canSelfRegister = mode !== CLUB_ONLY`).

---

## 3. Point de vue LICENCIÉ

### 3.1 Ce que voit le licencié

- Sur la **fiche compétition** (détail d’une compétition), onglet **Épreuves** :
  - Pour chaque épreuve (event) : bouton **« Inscrits »** (consultation liste, à venir), puis selon le cas :
    - **« S’inscrire »** : si le mode du club **n’est pas** `CLUB_ONLY` et que le licencié n’est pas déjà inscrit et est éligible (catégorie).
    - **« Désinscrire »** : si le licencié est déjà inscrit (PENDING ou CONFIRMED).
    - **« Inscription par le club »** (texte) : si le mode du club est `CLUB_ONLY` et qu’il n’est pas inscrit → il ne peut pas s’inscrire lui‑même.

### 3.2 Flux d’inscription (licencié s’inscrit lui‑même)

1. Le licencié clique **« S’inscrire »** sur une épreuve.
2. Le client appelle **`POST /competitions/:competitionId/register`** avec `eventId` (et optionnellement `partnerName`).
3. Backend (`CompetitionRegistrationService.register`, `byOrganizer: false`) :
   - Récupère le **mode d’inscription du club du licencié** (`getRegistrationModeForUser(userId)`).
   - Si mode = **CLUB_ONLY** → **403** : _"Votre club n'autorise pas les inscriptions par les licenciés..."_.
   - Si mode = **MEMBERS_AUTO_CONFIRM** → création de l’inscription en **CONFIRMED** + **notification** au licencié (« Inscription validée »).
   - Si mode = **CLUB_AND_MEMBERS_PENDING** → création de l’inscription en **PENDING** + **notification** au licencié (« Inscription en attente de validation par votre club »).
4. Le licencié voit alors **« Désinscrire »** (il peut annuler tant que le club n’a pas validé), ou reste avec « S’inscrire » selon l’état affiché.

### 3.3 Flux de désinscription (licencié se désinscrit)

1. Clic sur **« Désinscrire »**.
2. Client : **`POST /competitions/:id/unregister`** avec `eventId`.
3. Backend : l’inscription (PENDING ou CONFIRMED) est passée en **CANCELLED**. Le **club** est notifié (« Désinscription d'un licencié »).

### 3.4 Notifications reçues par le licencié

- **Inscription en attente** : mode `CLUB_AND_MEMBERS_PENDING` et inscription créée en PENDING.
- **Inscription validée** : soit auto‑confirmée (mode `MEMBERS_AUTO_CONFIRM`), soit validée par le club (`confirmRegistration`).
- **Inscription validée par le club** : après qu’un organisateur club a cliqué « Valider » sur une inscription PENDING.
- **Inscription par le club** : le club l’a inscrit via « Inscrire » (inscription créée en CONFIRMED par le club).
- **Désinscription par le club** : le club l’a désinscrit.

---

## 4. Point de vue CLUB (structure)

### 4.1 Qui peut agir

- Tout utilisateur avec le rôle **CLUB** (représentant d’un club) peut, pour **les membres de son club uniquement** (même `clubName`) :
  - **Inscrire** des membres à une épreuve (bouton **« Inscrire »** sur la fiche compétition).
  - **Désinscrire** des membres.
  - **Valider** ou **Refuser** (désinscrire) les inscriptions en **PENDING** des membres de son club.

Cela s’applique à **toute compétition** : le club n’a pas besoin d’être l’organisateur de la compétition pour inscrire ses membres (tout club avec des couples éligibles peut utiliser « Inscrire »).

### 4.2 Ce que voit le club sur la fiche compétition

- **Onglet Épreuves** :
  - **« Inscrits »** : consultation de la liste des inscrits (à venir).
  - **« Inscrire »** : ouvre la modale pour choisir des **membres du club** éligibles à la catégorie de l’épreuve et les inscrire.
- Pas d’affichage des boutons licencié (« S’inscrire », « Désinscrire », « Inscription par le club ») pour le rôle CLUB sur les cartes épreuves : le club utilise uniquement « Inscrire » pour gérer les inscriptions des membres.

### 4.3 Section « Inscriptions en attente »

- Visible **uniquement** si :
  - l’utilisateur est en rôle **CLUB**,
  - le mode d’inscription du club est **CLUB_AND_MEMBERS_PENDING**,
  - et il existe au moins une inscription **PENDING** pour un **membre de son club** sur **cette compétition**.
- Pour chaque inscription en attente : nom du membre, épreuve (catégorie / âge), boutons **Valider** et **Refuser** (Refuser = désinscrire le membre).

### 4.4 Flux : inscription de membres par le club (« Inscrire »)

1. Le représentant club ouvre une épreuve et clique **« Inscrire »**.
2. La modale **ClubEventRegistrationModal** s’ouvre avec la liste des **membres du club** éligibles à la catégorie de l’épreuve (récupérés via `ClubService.getMembers()`).
3. Il sélectionne un ou plusieurs membres et valide.
4. Le client appelle pour chaque membre **`POST /competitions/register-member`** avec `eventId`, `memberUserId`, et optionnellement `partnerName`.
5. Backend :
   - Vérifie que le membre appartient au club de l’organisateur (`ensureMemberBelongsToOrganizerClub`).
   - Crée l’inscription avec **statut CONFIRMED** (`byOrganizer: true`).
   - Envoie une **notification** au membre : « Le club vous a inscrit à … ».
6. La modale se ferme et la liste est rafraîchie.

### 4.5 Flux : validation d’une inscription en attente

1. Un licencié du club s’est inscrit lui‑même alors que le mode est **CLUB_AND_MEMBERS_PENDING** → inscription en **PENDING**.
2. Le club voit cette inscription dans la section **« Inscriptions en attente »** sur la fiche de la compétition concernée.
3. Clic sur **Valider** → client appelle **`POST /competitions/registrations/:registrationId/confirm`**.
4. Backend :
   - Vérifie que l’inscription est PENDING et que le **membre inscrit** appartient au **club** de l’organisateur (même `clubName`).
   - Passe l’inscription en **CONFIRMED**.
   - Notifie le licencié : « Inscription validée par le club ».
5. L’inscription disparaît de la liste « en attente » (elle est maintenant CONFIRMED).

### 4.6 Flux : refus / désinscription d’un membre (depuis « Inscriptions en attente » ou ailleurs)

- **Refuser** dans la section « Inscriptions en attente » : désinscrit le membre (passe l’inscription en CANCELLED) et notifie le membre (« Désinscription par le club ») si l’appel est fait avec `byOrganizer: true` et `organizerUserId` ≠ membre.
- Le club peut aussi **désinscrire** un membre déjà confirmé (hors modale « en attente ») via un flux dédié si l’UI l’expose : **`POST /competitions/unregister-member`** avec `eventId` et `memberUserId`. Même règle : le membre doit appartenir au club.

### 4.7 Récupération des inscriptions en attente

- **Backend** : **`GET /competitions/club/pending-registrations`** (réservé CLUB).
- Retourne **toutes** les inscriptions **PENDING** des **membres du club** (toutes compétitions confondues), avec utilisateur, événement, compétition.
- Le client filtre par `competitionId` pour afficher la section « Inscriptions en attente » **par compétition** sur la fiche détail.

---

## 5. Synthèse des API (côté inscription)

| Action                                   | Endpoint                                       | Rôle     | Description                                                                  |
| ---------------------------------------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| S’inscrire (licencié)                    | `POST /competitions/:id/register`              | Licencié | Crée une inscription ; statut PENDING ou CONFIRMED selon le mode du club.    |
| Se désinscrire                           | `POST /competitions/:id/unregister`            | Licencié | Passe l’inscription en CANCELLED.                                            |
| Inscrire un membre                       | `POST /competitions/register-member`           | CLUB     | Inscription du membre en CONFIRMED ; membre doit être du même club.          |
| Désinscrire un membre                    | `POST /competitions/unregister-member`         | CLUB     | Désinscription du membre (CANCELLED) + notification si besoin.               |
| Valider une inscription PENDING          | `POST /competitions/registrations/:id/confirm` | CLUB     | Passe PENDING → CONFIRMED ; inscription doit concerner un membre du club.    |
| Liste des inscriptions en attente (club) | `GET /competitions/club/pending-registrations` | CLUB     | Toutes les PENDING des membres du club.                                      |
| Mode d’inscription (club)                | `GET /clubs/me/registration-mode`              | Licencié | Pour savoir si auto‑inscription autorisée.                                   |
| Mode d’inscription (club)                | `PATCH /clubs/me/registration-mode`            | CLUB     | Définir le mode (CLUB_AND_MEMBERS_PENDING, CLUB_ONLY, MEMBERS_AUTO_CONFIRM). |

---

## 6. Récapitulatif par mode

| Mode                         | Licencié peut s’inscrire ?                | Statut initial (auto‑inscription) | Club doit valider ?     | Club peut inscrire des membres ? |
| ---------------------------- | ----------------------------------------- | --------------------------------- | ----------------------- | -------------------------------- |
| **CLUB_AND_MEMBERS_PENDING** | Oui                                       | PENDING                           | Oui (Valider / Refuser) | Oui (CONFIRMED directement)      |
| **CLUB_ONLY**                | Non (message « Inscription par le club ») | —                                 | —                       | Oui (CONFIRMED directement)      |
| **MEMBERS_AUTO_CONFIRM**     | Oui                                       | CONFIRMED                         | Non                     | Oui (CONFIRMED directement)      |

---

## 7. Notifications

### Destinataire : Licencié

| Type                             | Titre                           | Déclencheur                                               |
| -------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `registration_by_club`           | Inscription par le club         | Le club l’a inscrit à une épreuve.                        |
| `registration_auto_confirmed`    | Inscription validée             | Il s’est inscrit et le mode est MEMBERS_AUTO_CONFIRM.     |
| `registration_pending`           | Inscription en attente          | Il s’est inscrit et le mode est CLUB_AND_MEMBERS_PENDING. |
| `registration_confirmed_by_club` | Inscription validée par le club | Le club a validé son inscription en attente.              |
| `registration_refused_by_club`   | Inscription refusée par le club | Le club a refusé son inscription (était en attente).      |
| `unregistration_by_club`         | Désinscription par le club      | Le club l’a désinscrit (il était déjà confirmé).          |

### Destinataire : Club (tous les représentants du club, rôle CLUB)

| Type                               | Titre                                | Déclencheur                                                              |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| `club_member_auto_registered`      | Inscription d'un licencié            | Un licencié du club s’est inscrit (mode auto‑confirmé).                  |
| `club_member_pending_registration` | Inscription en attente de validation | Un licencié du club a une inscription en attente (à valider ou refuser). |
| `club_member_unregistered`         | Désinscription d'un licencié         | Un licencié du club s’est désinscrit lui‑même.                           |

### Notifications optionnelles (non implémentées)

- **Club** : rappel « Vous avez N inscription(s) en attente de validation » (job planifié avant une compétition).
- **Club** : « Un représentant du club a inscrit [Licencié] à [épreuve] » (traçabilité multi-représentants).

Ce document peut être mis à jour si de nouveaux flux ou modes sont ajoutés.

---

## 7. Types de compétition et règles de participation (Articles 8 et 9)

### 7.1 Types de compétition (Article 8)

Chaque compétition peut avoir un **type** (`Competition.competitionType`) et détermine **quels types d’épreuves** peuvent être organisés :

| Valeur             | Libellé                      | Types d’épreuves autorisés                                                                                                                                                                                                          | Règles applicables                                                 |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **PROXIMITE**      | Compétitions de proximité    | Épreuves **classificatrices** (niveaux **débutant et intermédiaire uniquement**), épreuves **Open** sans limitation de niveau, épreuves **licenciés loisir**, **solo team**, **danse en solo**.                                     | Pas d’épreuves classificatrices Avancé/International en proximité. |
| **NATIONALE**      | Compétitions nationales      | **Tous** les types : classificatrices, opens nationaux, danse en solo, solo team.                                                                                                                                                   | Aucune restriction sur la nature des épreuves.                     |
| **MAJEURE**        | Compétitions majeures        | Tous types. Sous-types d’organisation : Championnats régionaux, Championnats de France Latines/Standards/10 danses, Championnat de France Show Danse, Championnat de France Solo Danse Team, Coupe de France, Critériums nationaux. | **Une seule épreuve par spécialité** par couple/solo (§1.2).       |
| **INTERNATIONALE** | Compétitions internationales | Tous types (règlementation WDSF).                                                                                                                                                                                                   | Plusieurs pays, règles WDSF.                                       |

- **Proximité** : les épreuves classificatrices ne peuvent avoir que les niveaux **Débutant** ou **Intermédiaire** (`Event.level`). Les opens sont sans limitation de niveau. Les épreuves « loisir » peuvent être modélisées en Open ou via un libellé dédié selon l’organisateur.
- **Nationale** : tous les types d’épreuves (classificatrices, opens nationaux, solo, solo team) peuvent être organisés.
- **Majeure** : tous les types d’épreuves sont autorisés. **Le sous-type est obligatoire** : Championnats régionaux, Championnats de France Latines, Championnats de France Standards, Championnats de France 10 danses, Championnat de France Show danse, Championnat de France Solo Danse Team, Critériums nationaux. Ce sous-type est stocké dans `Competition.majorSubType` et utilisé pour l’organisation et le corps arbitral (nombre de juges, etc.).

#### 7.1.1 Sous-type des compétitions majeures (obligatoire si type = MAJEURE)

Lors de la création ou modification d’une compétition de type **MAJEURE**, le champ **majorSubType** doit être renseigné. Valeurs possibles :

| Valeur (backend)              | Libellé                                  |
| ----------------------------- | ---------------------------------------- |
| CHAMPIONNAT_REGIONAL          | Championnats régionaux                   |
| CHAMPIONNAT_FRANCE_LATINES    | Championnats de France Latines           |
| CHAMPIONNAT_FRANCE_STANDARDS  | Championnats de France Standards         |
| CHAMPIONNAT_FRANCE_10_DANSES  | Championnats de France 10 danses         |
| CHAMPIONNAT_FRANCE_SHOW_DANSE | Championnat de France de Show danse      |
| CHAMPIONNAT_FRANCE_SOLO_TEAM  | Championnat de France de Solo Danse Team |
| CRITERIUMS_NATIONAUX          | Critériums nationaux                     |

Le backend expose le mapping **type de compétition → natures d’épreuve autorisées** via le module `participation-rules` : `getAllowedEventKindsForCompetitionType(competitionType)` et `isEventKindAllowedForCompetitionType(competitionType, eventKind)`. Pour les compétitions de proximité, les épreuves classificatrices ne doivent proposer que les niveaux Débutant et Intermédiaire : `isLevelAllowedForProximiteClassificatrice(level)` et `LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE`.

### 7.2 Nature de l’épreuve (Article 9)

Chaque épreuve peut avoir une **nature** (`Event.eventKind`) et un **niveau** (`Event.level` pour les classificatrices) :

| eventKind           | Description                                 | Règle d’éligibilité                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLASSIFICATRICE** | Épreuve à classe d’âge + niveau imposés     | Le couple/solo ne peut participer qu’aux épreuves pour **sa classe d’âge** et **son niveau**. Le champ `registrantLevel` est recommandé à l’inscription.                                                                                                                                                                                                                                                                   |
| **OPEN**            | Open (regroupe classes d’âge et/ou niveaux) | Il est possible d’organiser des épreuves Open regroupant **soit** des classes d’âge, **soit** des niveaux, **soit les deux**. L’organisateur définit une ou plusieurs catégories d’âge et optionnellement un ou plusieurs niveaux (Débutant, Intermédiaire, Avancé, International) ; aucune sélection de niveau = tous niveaux. Les couples/solos peuvent participer aux Opens englobant leur classe d’âge et leur niveau. |
| **MAJEURE**         | Épreuve majeure                             | Tous niveaux dans la classe d’âge ; **une seule épreuve par spécialité** (Latin, Standard, Ten Dance) par compétition.                                                                                                                                                                                                                                                                                                     |
| **SOLO_TEAM**       | Solo Danse Team                             | Équipe d’au moins 6 danseurs ; âge pris en compte = âge moyen arrondi à l’unité supérieure (Juvénile, Junior, Adulte, Seniors 30 ans). Règlement technique chapitre 4.2.3. L’éligibilité individuelle stricte (classe d’âge couple/solo) n’est pas appliquée : l’organisateur gère la composition d’équipe.                                                                                                                |
| **SHOW_DANSE**      | Show danse                                  | Règles spécifiques article 16 du règlement technique. Pas de contrôle d’éligibilité couple/solo côté plateforme ; l’organisateur gère les inscriptions.                                                                                                                                                                                                                                                                    |

### 7.3 Vérifications à l’inscription

- **Classe d’âge** : le participant doit être éligible à l’épreuve (classe d’âge de l’épreuve). Les règles « toutes compétitions » et « choix vers le haut » (Article 9 §1.3 et 1.4) sont appliquées : ex. Juvénile I peut aussi Juvénile II ; Junior II peut choisir Youth ; etc.
- **Niveau** (épreuves classificatrices) : si `eventKind === CLASSIFICATRICE` et `event.level` est renseigné, le niveau du couple/solo (`registrantLevel`) doit être compatible.
- **Une épreuve par spécialité (majeures)** : si la compétition est de type MAJEURE et l’épreuve de nature MAJEURE, le backend refuse l’inscription si le licencié est déjà inscrit à une autre épreuve de **même spécialité** (`category`) dans cette compétition.

### 7.4 Récap des natures d’épreuve (eventKind)

| eventKind       | Usage principal                         | Contrôle éligibilité plateforme                |
| --------------- | --------------------------------------- | ---------------------------------------------- |
| CLASSIFICATRICE | Épreuve à classe + niveau imposés       | Oui (âge + niveau)                             |
| OPEN            | Open (classes/niveaux regroupés)        | Oui (âge + niveau si niveau épreuve renseigné) |
| MAJEURE         | Épreuve majeure (une par spécialité)    | Oui (âge) + une épreuve par spécialité         |
| **SOLO_TEAM**   | Solo Danse Team (équipe ≥ 6, âge moyen) | Non — organisateur gère la composition         |
| **SHOW_DANSE**  | Show danse (article 16)                 | Non — organisateur gère les inscriptions       |

Pour **Solo Team** et **Show Danse**, l’inscription reste possible pour les licenciés sans blocage sur la classe d’âge individuelle ; la composition d’équipe ou les règles show sont du ressort de l’organisateur.

### 7.5 Solo Danse Team – Règles spécifiques (équipes, âge, niveaux)

Lors de la création d’une épreuve **SOLO_TEAM** (eventKind = SOLO_TEAM), l’organisateur définit :

- **Catégorie d’âge de la team** : fixée au début de l’année civile, valable toute l’année, selon la **moyenne d’âge des équipiers au 31 décembre** :
  - **Juvénile** : moins de 12 ans
  - **Junior** : moins de 16 ans
  - **Adulte** : moins de 30 ans
  - **Senior** : 30 ans et plus
- **Niveau** : **Débutant** ou **Intermédiaire** (défini par le responsable technique de la team).

Règles d’équipe : chaque équipe doit être composée d’**au moins 6** danseurs ; des remplaçants sont possibles. Les équipes peuvent danser de 1 à 10 danses (Latines / Standards) ; le caractère des danses doit être conservé ; éléments d’autres formes de danse possibles sous conditions (≤ 50 s, etc.). Ces règles sont du ressort de l’organisateur et du règlement technique ; la plateforme enregistre la catégorie d’âge et le niveau de l’épreuve pour l’affichage et les inscriptions.

### 7.6 API

- **Référentiel règlement** : `GET /competitions/regulation` retourne `competitionTypes`, `eventKinds`, `competitionLevels` pour construire les formulaires côté client.
- Les réponses compétition/événements incluent `competitionType`, `eventKind` et `level` lorsque présents.
- **Inscription** : le body peut inclure `registrantLevel` (obligatoire conseillé pour les épreuves classificatrices).
