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

Aucune clé de signature n'est donc disponible dans notre modèle, ni globale ni par club.

## Decision

**Le contenu d'une notification HelloAsso n'est jamais cru.** La notification ne sert que de déclencheur :

1. elle désigne une réservation (`metadata.bookingId`, métadonnée que nous posons à la création de l'intention) ;
2. le backend relit l'intention de paiement **de cette réservation** (`SeatBooking.paymentId`, jamais l'identifiant envoyé dans la notification) sur l'API HelloAsso, avec les identifiants du club organisateur ;
3. seule la commande renvoyée par l'API (paiements, montants en centimes, états, métadonnées) passe dans les contrôles fail-closed de #381.

Conséquences de mise en œuvre (`HelloAssoNotificationService`) :

- intention inconnue, métadonnées d'une autre réservation, club non connecté, commande mal formée → notification ignorée et tracée (journal + Sentry, identifiants seulement), réponse 200 ;
- HelloAsso injoignable, ou paiement pas encore autorisé (pas de commande sur l'intention) → **503**, HelloAsso rejoue la notification (`min(48 h, 3·2^n)` s, 16 essais) ;
- la signature reste vérifiée, en défense en profondeur, **si** une clé partenaire est configurée (`HELLOASSO_SIGNATURE_KEY`, en-tête `x-ha-signature`) ; sans clé, les notifications non signées sont acceptées ;
- `HELLOASSO_WEBHOOK_SECRET` est obsolète et ignoré (avertissement au démarrage) ;
- l'hôte de l'API devient configurable (`HELLOASSO_API_URL`, liste fermée : production ou sandbox) et les chemins passent en `/v5`.

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
- **Cons**: n'importe qui pourrait confirmer une place en postant un faux ordre « payé ».
- **Why not**: inacceptable.

## Consequences

### Positive

- Un faux appel au webhook ne peut, au pire, que provoquer la relecture d'un paiement réel.
- Fonctionne avec le modèle actuel (un compte association par club), sans secret partagé entre clubs.
- Même mécanisme réutilisable pour les remboursements et contestations (#403) : relire le paiement sur l'API.

### Negative

- Un appel sortant vers HelloAsso par notification (jeton mis en cache par club).
- Le webhook dépend de la disponibilité de HelloAsso ; une panne retarde la confirmation (rejeu par HelloAsso), sans perte.

### Risks

- **Comportement non observé en vrai** : la forme exacte d'une notification réelle et le délai entre la notification `Order` et la disponibilité de la commande sur l'intention restent à confirmer par un paiement de bout en bout en sandbox (critère d'acceptation de #404). Atténuation : le 503 provoque un rejeu si la commande n'est pas encore visible.
- **Appels provoqués par un tiers** : un attaquant connaissant un `bookingId` (UUID) peut déclencher des relectures ; limité par le rate limiting global et sans effet de bord.
