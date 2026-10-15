# ADR-0022: Notifications HelloAsso vérifiées en relisant le paiement sur l'API

**Date**: 2026-10-12
**Status**: proposed
**Deciders**: Gabin SIMOND (spike #404, sandbox HelloAsso)

## Context

Chaque club organisateur connecte **son propre compte association** HelloAsso (identifiants `clientId` / `clientSecret` stockés par club, chiffrés au repos depuis #389). Les intentions de paiement d'une place de compétition sont créées sur l'organisation du club (ADR-0013, #381).

La PR #398 protégeait le webhook par une signature HMAC-SHA256 lue dans l'en-tête `X-HelloAsso-Signature`, avec un secret global `HELLOASSO_WEBHOOK_SECRET`. Le spike #404 (sandbox HelloAsso + documentation officielle, octobre 2026) a établi que :

1. **HelloAsso ne signe les notifications que pour les comptes partenaires.** Un partenaire configure ses URL de notification par l'API `partners/me/api-notifications` ; chaque URL reçoit une `signatureKey`, et la notification porte l'en-tête **`x-ha-signature`** (HMAC-SHA256 hexadécimal du corps brut). Une association, elle, inscrit son URL dans son espace HelloAsso (« Mon compte > Intégrations et API ») et **ne reçoit aucune signature**. Source : <https://dev.helloasso.com/docs/secure-webhook>.
2. L'en-tête attendu par notre code (`X-HelloAsso-Signature`) n'existe pas : même en mode partenaire, toutes les notifications auraient été rejetées (401), puis rejouées par HelloAsso pendant ~27 h.
3. Le seul autre moyen d'authentification documenté est l'adresse IP source (production `51.138.206.200`, sandbox `4.233.135.234`).
4. L'API publique est en **`/v5`** ; l'URL `/v1/organizations/{slug}/checkout-intents` utilisée par le code répond **404** (vérifié en sandbox). Le jeton s'obtient sur `{hôte}/oauth2/token` (`client_credentials`, durée 1 800 s, jeton de rafraîchissement fourni).
5. Le jeton d'un compte association porte le rôle `OrganizationAdmin` et les privilèges `AccessPublicData`, `AccessTransactions`, `Checkout`, `PublicToolbox`, `RefundManagement` : il peut relire une intention de paiement (`GET /v5/organizations/{slug}/checkout-intents/{id}`, qui renvoie la commande une fois le paiement autorisé), un paiement (`GET /v5/payments/{id}`) et une commande (`GET /v5/orders/{id}`).

Les notifications `Payment` (remboursement ou contestation, #403) suivent le même modèle : une association n'y reçoit aucune signature.

Aucune clé de signature n'est donc disponible dans notre modèle, ni globale ni par club.

## Decision

**Le contenu d'une notification HelloAsso n'est jamais cru.** Une notification ne sert que de déclencheur. Deux types sont traités : `Order` (confirmation de la place, #381 / #404) et `Payment` (libération de la place sur remboursement ou contestation, #403).

### Flux d'une notification `Order`

1. Le webhook (`POST /payment/webhook`, `PaymentController`) reçoit la notification. Le corps est validé par `WebhookPayloadDto` : les champs non déclarés sont retirés, jamais rejetés (HelloAsso en envoie beaucoup d'autres).
2. `HelloAssoNotificationService` lit `metadata.bookingId`, métadonnée que nous posons à la création de l'intention. Un identifiant qui n'est pas un UUID est ignoré, sans appel sortant.
3. Seules les réservations `PENDING` ou `EXPIRED` (hold échu, #401) sont relues. Tout autre statut est final : aucun appel vers HelloAsso.
4. Le backend relit l'intention de paiement **de cette réservation** (`SeatBooking.paymentId`, jamais l'identifiant envoyé dans la notification), avec les identifiants du club organisateur. Les métadonnées relues doivent désigner la même réservation.
5. La commande renvoyée par l'API (paiements, montants en centimes, états) est reconstruite dans un `WebhookPayloadDto` qui ne garde que les champs lus, puis passe dans `checkOrderAgainstBooking` : contrôles fail-closed de #381, échéance du hold (#401) vérifiée en dernier.
6. Si tout concorde, `PaymentService.handleOrderWebhook` fait passer la réservation de `PENDING` à `CONFIRMED`. L'écriture est conditionnelle (statut `PENDING`, même montant attendu, échéance non atteinte) : une réservation annulée, re-tarifée ou expirée entre la lecture et l'écriture n'est jamais confirmée.

### Flux d'une notification `Payment` (#403)

1. L'état annoncé par la notification ne sert que de filtre : seuls `Refunded` et `Contested` déclenchent un travail. Une réservation `PENDING` répond **503** (la commande peut être en cours de confirmation). Une réservation qui n'est pas `CONFIRMED` est laissée telle quelle, sans appel.
2. `SeatReleaseService` relit le paiement (`GET /v5/payments/{id}`) puis, si la notification ne porte pas l'intention, sa commande (`GET /v5/orders/{id}`). L'intention de paiement de cette commande doit être celle de la réservation.
   - **Exception assumée à la règle générale** : l'identifiant de paiement est lu dans le corps de la notification (`seat-release.service.ts`, appel à `HelloAssoService` pour `GET /v5/payments/{id}`). Une réservation ne mémorise que son intention, pas l'identifiant des paiements qui la règlent : la notification est donc le seul moyen de savoir quel paiement relire.
   - Ce chemin reste sûr pour trois raisons :
     - c'est une lecture seule ;
     - elle est faite avec les identifiants du club organisateur **de la réservation**, et non d'un club désigné par la notification ;
     - le paiement relu n'est retenu que si sa commande porte l'intention de cette réservation.
   - Au pire, un identifiant forgé déclenche une lecture inutile ou un refus. Il ne peut pas libérer la place d'une autre réservation.
3. **L'état relu sur HelloAsso, et non celui de la notification, décide.** `Refunded` donne la raison `HELLOASSO_REFUNDED`, `Contested` la raison `HELLOASSO_CONTESTED`. Tout autre état (par exemple `Refunding`, remboursement en cours, ou un remboursement échoué repassé en `Authorized`) laisse la place.
4. La libération est une écriture conditionnelle `CONFIRMED` → `CANCELLED`, avec `cancelReason`. Une relivraison ne libère donc pas deux fois. Une place `CANCELLED` n'est plus bloquée : l'index unique partiel ne retient que `PENDING` et `CONFIRMED`.

### États et réponses

- **Order**, paiement autorisé, montant et intention conformes : `PENDING` → `CONFIRMED`, réponse 200.
- **Order**, paiement reçu après l'échéance du hold (#401) : la réservation passe à `EXPIRED` si elle était `PENDING`, le paiement est signalé `refund: required` dans Sentry, réponse 200. Le remboursement n'est pas automatique (voir Risques).
- **Order**, paiement pas encore autorisé (intention sans commande) : statut inchangé, réponse **503** (rejeu).
- **Payment** `Refunded` ou `Contested` sur une réservation `CONFIRMED` : `CANCELLED` avec `cancelReason`, réponse 200, alerte Sentry `helloasso-seat-released` (niveau warning).
- **Payment** `Refunded` ou `Contested` sur une réservation `PENDING` : statut inchangé, réponse **503** (rejeu).
- **Payment** avec un autre état, sur une réservation `CONFIRMED` : statut inchangé, réponse 200.
- Intention, réservation ou club inconnu ou incohérent : statut inchangé, réponse 200, tracé dans le journal. Sentry n'est sollicité que lorsque la relecture contredit la notification (identifiants seulement).
- HelloAsso injoignable (relecture de l'intention, du paiement ou de la commande) : statut inchangé, réponse **503** (rejeu).

### Frontière de confiance

- **Non fiable** : tout le corps de la notification, y compris les identifiants de réservation et de paiement et l'état annoncé. L'endpoint est public. L'en-tête `x-ha-signature` n'existe que pour les comptes partenaires.
- **Fiable** : la réponse de l'API HelloAsso, lue avec les identifiants du club organisateur (chiffrés au repos, #389), pour la seule réservation désignée et sa seule intention de paiement.
- **Ce qu'une notification forgée peut obtenir** : des lectures sur une réservation `PENDING`, `EXPIRED` ou `CONFIRMED` (les autres statuts ne déclenchent aucun appel). Elle ne peut ni confirmer une place, ni en libérer une : il faut un paiement réel, autorisé, remboursé ou contesté sur HelloAsso, pour cette intention.
- **Signature** : `x-ha-signature` (HMAC-SHA256 du corps brut) est vérifiée si `HELLOASSO_SIGNATURE_KEY` est configurée, en défense en profondeur. Sans clé, les notifications non signées sont acceptées.

### Conséquences de mise en œuvre

- Intention inconnue, métadonnées d'une autre réservation, club non connecté, commande mal formée : notification ignorée et tracée, réponse 200. Les rejets qu'un appelant peut provoquer sans secret (réservation inconnue, identifiant de paiement d'une autre intention) sont journalisés sans passer par Sentry, pour ne pas consommer le quota.
- HelloAsso injoignable, ou paiement pas encore autorisé : **503**, HelloAsso rejoue la notification (`min(48 h, 3·2^n)` s, 16 essais).
- `HELLOASSO_WEBHOOK_SECRET` est obsolète et ignoré (avertissement au démarrage).
- L'hôte de l'API devient configurable (`HELLOASSO_API_URL`, liste fermée : production ou sandbox) et les chemins passent en `/v5`.

## Alternatives Considered

### Alternative 1 : devenir partenaire HelloAsso et signer toutes les notifications

- **Pros**: authentification cryptographique de chaque notification, une clé par URL.
- **Cons**: suppose un contrat partenaire et la « mire d'autorisation » OAuth pour chaque club, à la place des identifiants association saisis aujourd'hui ; ne dispense pas de vérifier le montant et l'état réels.
- **Why not**: hors de portée pour le lancement ; reste compatible avec cette décision (la clé partenaire s'ajoute via `HELLOASSO_SIGNATURE_KEY`).

### Alternative 2 : liste blanche des IP HelloAsso

- **Pros**: simple, documenté par HelloAsso.
- **Cons**: dépend de la chaîne de proxys (Container Apps) pour l'IP réelle ; une IP qui change sans préavis bloquerait tous les paiements ; n'authentifie pas le contenu.
- **Why not**: fragile et insuffisant seul. Peut s'ajouter plus tard en complément.

### Alternative 3 : faire confiance au contenu non signé

- **Pros**: aucun appel sortant.
- **Cons**: n'importe qui pourrait confirmer une place en postant un faux ordre « payé », ou libérer une place en postant un faux remboursement.
- **Why not**: inacceptable.

## Consequences

### Positive

- Un faux appel au webhook ne peut, au pire, que provoquer la relecture d'un paiement réel.
- Fonctionne avec le modèle actuel (un compte association par club), sans secret partagé entre clubs.
- Les remboursements et contestations (#403) réutilisent le même mécanisme : aucune libération de place n'est déclenchée par le contenu d'une notification.
- Les rejets provoqués par un tiers restent dans le journal et n'encombrent pas Sentry.

### Negative

- Un ou deux appels sortants vers HelloAsso par notification pertinente (une intention pour `Order` ; un paiement, et sa commande si la notification ne la porte pas, pour `Payment`) ; le jeton est mis en cache par club.
- Le webhook dépend de la disponibilité de HelloAsso ; une panne retarde la confirmation ou la libération (rejeu par HelloAsso), sans perte.
- Une contestation que le club gagne ne rend pas la place (elle peut avoir été revendue) : la réservation reste `CANCELLED` et l'organisateur traite le cas à la main.
- Un paiement reçu après l'échéance du hold n'est pas confirmé, et son remboursement n'est pas automatique : le paiement est seulement signalé dans Sentry (`refund: required`).

### Risks

- **Comportement non observé en vrai** : la forme exacte des notifications `Order` et `Payment`, le délai entre la notification `Order` et la disponibilité de la commande sur l'intention, et l'enchaînement `Refunding` → `Refunded` (ou remboursement échoué) restent à confirmer par des paiements de bout en bout en sandbox (critères d'acceptation de #404 et #403). Atténuation : les 503 provoquent un rejeu si la commande ou le remboursement n'est pas encore visible.
- **Remboursement manuel oublié** : tant que le remboursement automatique n'existe pas, un paiement tardif dépend d'un traitement à la main à partir de l'alerte Sentry `refund: required`. Aucun contrôle automatique ne vérifie qu'il a été traité.
- **Appels provoqués par un tiers** : un attaquant connaissant un `bookingId` (UUID) peut déclencher des relectures. Un `Payment` ne relit que les réservations `CONFIRMED` ; l'ensemble est limité par le rate limiting global et ne produit pas d'effet de bord sans paiement réel sur HelloAsso.
