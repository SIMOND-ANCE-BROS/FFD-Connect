# ADR-0023: Connecteurs de paiement choisis par chaque club organisateur

**Date**: 2026-10-15
**Status**: proposed
**Deciders**: Gabin SIMOND (issue #388)

## Context

Le paiement des places d'une compétition passe uniquement par HelloAsso (ADR-0013). Chaque club organisateur y connecte son propre compte association. Ses identifiants sont stockés sur `Club` (`helloAssoClientId`, `helloAssoClientSecret` chiffré au repos depuis #389, `helloAssoOrgSlug`). Les notifications ne sont jamais crues : le paiement est relu sur l'API HelloAsso (ADR-0022).

Plusieurs clubs encaissent avec un autre outil, AssoConnect notamment, et ne peuvent donc pas vendre de places via FFD Connect. Aujourd'hui, `PaymentService` appelle `HelloAssoService` en direct : identifiants, création de l'intention, relecture avant la reprise d'un paiement, messages d'erreur qui nomment HelloAsso. Ajouter un deuxième prestataire voudrait dire semer des `if (provider === …)` dans un flux sensible, durci par #381 (montant côté serveur), #401 (paiement tardif), #428 (reprise de paiement), #438 (remboursement dû) et #456 (paiement après libération).

Contraintes :

- Les migrations restent **additives** : elles s'exécutent au démarrage du conteneur, et le rollback automatique du déploiement en dépend (ADR-0017).
- Tout appel sortant passe par le disjoncteur (opossum) et `withTimeout`, avec dégradation gracieuse (ADR-0009).
- Un secret de prestataire n'est jamais stocké en clair, ni renvoyé par l'API, ni journalisé (#389).
- Le contenu d'une notification n'est jamais cru (ADR-0022), quel que soit le prestataire.

## Decision

### 1. Une abstraction `PaymentConnector` (`src/payment/connectors/`)

Chaque prestataire est un **connecteur**, un adaptateur au sens stratégie / port-adaptateur. Il a deux côtés.

**Côté sortant** (`PaymentConnector`, utilisé par `PaymentService`) :

| Membre                                 | Rôle                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `displayName`              | Identifiant (`PaymentProvider`) et nom affiché dans les messages (« HelloAsso »).                                                                                                                                      |
| `accountForCompetition(competitionId)` | Compte du club organisateur chez ce prestataire, ou `null` s'il n'est pas configuré (ou si ses identifiants sont illisibles). Le compte porte ses identifiants **en fermeture** : ils ne sortent jamais du connecteur. |
| `account.createCheckout(request)`      | Crée la page de paiement : montant en centimes fixé côté serveur, libellé, payeur, métadonnées `bookingId` / `competitionId`, URL de retour. Renvoie `{ id, redirectUrl }`, avec un `id` **opaque** (chaîne).          |
| `account.hasPaymentOnCheckout(id)`     | Le prestataire a-t-il déjà un paiement autorisé sur ce checkout ? Utilisé avant de remplacer le checkout d'une reprise (#428). Une panne **lève une erreur** (réponse 503) : la réponse n'est jamais devinée.          |

**Côté entrant** (`PaymentOrderNotificationVerifier`) : chaque connecteur possède **sa route de webhook**, sa vérification d'authenticité et son DTO. Il remet à la confirmation commune (`PaymentService.handleOrderWebhook`) une commande **reconstruite depuis l'API du prestataire** (`VerifiedOrder`), jamais le corps reçu. Le format commun est celui que vérifie `checkOrderAgainstBooking` : métadonnées de réservation, identifiant de commande et de checkout, paiements avec montant (centimes) et état. C'est le format `Order` de HelloAsso. Un nouveau connecteur y projette la réponse de son API (et ses états vers `Authorized`). Ainsi, #381, #401, #428 et #456 s'appliquent à tous les connecteurs sans être réécrits.

**Remboursements dus** : rien ne change. Un paiement encaissé sans place accordée est marqué `refundOwedPaymentIds` / `refundOwedAt`, et le club est alerté (#438). Le club rembourse à la main depuis l'espace de son prestataire. La notification de remboursement de ce prestataire, relue sur son API, solde la dette (aujourd'hui `SeatReleaseService` pour HelloAsso). Le remboursement automatique par l'API d'un prestataire reste hors périmètre.

**HelloAsso est le premier connecteur**, sans changement de comportement :

- sortant : `HelloAssoPaymentConnector`, fine couche sur `HelloAssoService` (OAuth, disjoncteur `helloasso`, timeouts) et sur `ClubsHelloAssoService` (identifiants déchiffrés) ;
- entrant : `WebhookSignatureGuard` (signature partenaire optionnelle), `HelloAssoNotificationService` (relecture de la commande, qui implémente `PaymentOrderNotificationVerifier`) et `SeatReleaseService` (relecture des remboursements et contestations).

`PaymentService` ne référence plus HelloAsso : il passe par `PaymentConnectorRegistry`.

### 2. Le choix du club : `Club.paymentProvider`

- Nouvel enum Prisma `PaymentProvider`, qui ne contient que `HELLOASSO`. Une valeur s'ajoute (`ALTER TYPE … ADD VALUE`, migration additive) **dans la même PR que son connecteur**, jamais avant.
- `Club.paymentProvider PaymentProvider? @default(HELLOASSO)` : colonne nullable, et le `DEFAULT` remplit les lignes existantes. `NULL` se lit `HELLOASSO`. Un seul connecteur actif par club. Le choix vaut pour toutes les compétitions du club.
- `PaymentConnectorRegistry.forCompetition` retrouve le club organisateur **par identifiant** (`organizerClubId`, repli sur le libellé non ambigu, #408), puis son connecteur. Si aucun club n'est trouvé, c'est HelloAsso, dont la recherche d'identifiants répond « non configuré » : c'est le comportement d'avant #388. Si le club a choisi un prestataire que la version déployée ne connaît pas (rollback après l'ajout d'un connecteur), le paiement est refusé avec un message neutre, sans jamais basculer en silence sur un autre prestataire.
- `SELECTABLE_PAYMENT_PROVIDERS` liste ce qu'un club peut choisir : les connecteurs enregistrés, aujourd'hui `HELLOASSO` seul. Les DTO le valident (`@IsEnum` + `@IsIn`).
- `SeatBooking.paymentProvider PaymentProvider? @default(HELLOASSO)` indique quel prestataire a émis `paymentId` / `supersededPaymentIds`. Toutes les réservations existantes sont HelloAsso : le `DEFAULT` les étiquette correctement sans rattrapage. **Le deuxième connecteur devra l'écrire explicitement à la création de la réservation**, puis l'utiliser dans la reprise de paiement (#428) : un club qui change de connecteur pendant une réservation en attente ne doit pas relire l'ancien checkout chez le nouveau prestataire.

### 3. Identifiants propres à chaque connecteur, chiffrés comme ceux de HelloAsso

- Mécanisme unique : `SecretCipherService` (#389). Chiffrement authentifié, clé hors base fournie par la configuration, **contexte lié au club et au connecteur** (`clubHelloAssoSecretContext(clubId)` pour HelloAsso), rechiffrement paresseux à la rotation de clé, jamais de valeur journalisée.
- HelloAsso garde ses trois colonnes sur `Club`, inchangées : rien à migrer.
- Pour le connecteur suivant : une table additive `ClubPaymentAccount (clubId, provider, credentials chiffrés, …)`, unique sur `(clubId, provider)`. Le secret est chiffré avec un contexte `club:<id>:payment:<provider>`. Elle n'est pas créée tant qu'aucun connecteur ne s'en sert. Les colonnes HelloAsso de `Club` n'y seront déplacées, puis supprimées, que par des migrations ultérieures, une fois la bascule faite et le rollback n'en dépendant plus.
- Changer de connecteur **n'efface pas** les identifiants du précédent. Les paiements en cours chez lui restent vérifiés et confirmés par sa propre route.
- L'API n'expose que le connecteur choisi, l'indicateur « configuré » et les choix possibles, jamais un identifiant.

### 4. Une route de webhook par connecteur

- `POST /payment/webhook/<connecteur>`, une méthode et une route **déclarées par connecteur** (pas de route générique `:provider`). Chacune a son garde, son DTO et sa vérification. Une signature invalide renvoie 401. Une notification non vérifiable reçoit un 200 sans effet. Un prestataire injoignable renvoie 503 pour qu'il rejoue la notification.
- HelloAsso : `POST /payment/webhook/helloasso`. La route historique `POST /payment/webhook` reste la route HelloAsso, avec le même garde et le même traitement, tant que les URL de notification déjà saisies par les clubs pointent dessus.
- Une notification est traitée par le connecteur **de sa route**, quel que soit le choix actuel du club : un paiement encaissé n'est jamais perdu parce que le club a changé de connecteur entre-temps.

### 5. API

- Club : `GET /clubs/me/payment-provider` (connecteur, configuré, choix possibles) et `PUT /clubs/me/payment-provider` (`{ paymentProvider }`). Les identifiants restent sur la route propre au connecteur (`PUT /clubs/me/helloasso`).
- Back-office : `paymentProvider` sur la liste et la fiche club, modifiable par `PATCH /admin/clubs/:id` (audité).
- `CheckoutResponseDto.id` reste numérique (identifiant d'intention HelloAsso). Un connecteur dont les identifiants ne sont pas numériques demandera un nouveau champ, et `bookingId` est déjà la clé côté app.

### 6. AssoConnect

Aucune documentation publique d'API AssoConnect ne permet aujourd'hui à un tiers de créer un paiement pour le compte d'une association ni de recevoir une notification (recherche du 2026-10-15 : seule une « API » citée dans les comparatifs d'offres, accès sur demande commerciale). Aucun adaptateur n'est donc livré. Un connecteur AssoConnect implémentera `PaymentConnector` et `PaymentOrderNotificationVerifier`, ajoutera `ASSOCONNECT` à l'enum et à `SELECTABLE_PAYMENT_PROVIDERS`, ses identifiants dans `ClubPaymentAccount`, sa route `POST /payment/webhook/assoconnect` et une relecture de chaque notification sur son API. Il sera suivi dans une issue dédiée, une fois un accès partenaire obtenu.

## Alternatives Considered

### Alternative 1 : `if (provider === …)` dans `PaymentService`

- **Pros** : aucun nouveau type, diff minimal pour le deuxième prestataire.
- **Cons** : le flux le plus sensible du backend se ramifie à chaque prestataire. Les garanties #381, #401, #428 et #456 seraient à reprouver pour chaque branche.
- **Why not** : l'abstraction garde un seul chemin de confirmation, testé une fois, et isole ce qui diffère (API, identifiants, authenticité).

### Alternative 2 : une route générique `POST /payment/webhook/:provider`

- **Pros** : une seule méthode de contrôleur.
- **Cons** : il faut un garde dynamique et un DTO choisi à l'exécution, ce qui affaiblit la validation déclarative et la documentation Swagger. Une erreur de répartition expose un connecteur à la vérification d'un autre.
- **Why not** : une route déclarée par connecteur garde des contrôles statiques, visibles et testés.

### Alternative 3 : une table `ClubPaymentAccount` dès maintenant, avec migration des identifiants HelloAsso

- **Pros** : modèle cible tout de suite.
- **Cons** : déplacer les secrets HelloAsso exige une double écriture, puis une suppression des colonnes. La suppression est interdite tant que le rollback en dépend (ADR-0017). Il n'y a aucun consommateur avant le deuxième connecteur.
- **Why not** : la table naîtra avec le connecteur qui en a besoin.

### Alternative 4 : choisir le connecteur compétition par compétition

- **Pros** : plus de souplesse.
- **Cons** : UI et règles plus lourdes, et un club n'utilise en pratique qu'un outil.
- **Why not** : hors périmètre de #388 (un connecteur par club).

## Consequences

### Positive

- Ajouter un prestataire se fait dans un dossier de connecteur, une valeur d'enum et une route de webhook, sans toucher à la confirmation ni aux protections existantes.
- Aucun changement de comportement pour HelloAsso. Les tests de paiement existants (unitaires, intégration, e2e) passent sans modification de leurs assertions. Seul le câblage du module de test de `payment.service.spec.ts` ajoute le registre et le connecteur réels.
- Le choix du club et le prestataire de chaque réservation sont tracés en base dès maintenant, sans rattrapage ultérieur.

### Negative

- Une lecture de plus par checkout pour connaître le choix du club (compétition, puis club, toutes deux par clé primaire).
- `VerifiedOrder` reprend la forme d'une commande HelloAsso : un autre prestataire doit y projeter sa réponse.
- Deux routes servent HelloAsso pendant la transition.

### Risks

- **Rollback après l'ajout d'un connecteur** : la valeur d'enum reste en base et la version précédente ne la connaît pas. Mitigation : le registre renvoie « aucun connecteur utilisable », le paiement est refusé proprement, sans repli silencieux sur HelloAsso.
- **Changement de connecteur avec des paiements en cours** : les notifications de l'ancien prestataire arrivent sur sa propre route et restent traitées. La reprise de paiement devra lire `SeatBooking.paymentProvider` au deuxième connecteur.
- **Fuite d'identifiants** : chiffrement `SecretCipherService` à contexte par club et par connecteur, `select` dédiés qui ne lisent un secret que pour savoir s'il est renseigné, et tests de non-exposition sur l'API club et le back-office.
