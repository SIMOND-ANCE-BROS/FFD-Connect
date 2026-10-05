# Module Payment

## 1) Role metier

Le module paiement gere le reglement en ligne des places de competition via HelloAsso. Chaque club organisateur connecte son propre compte HelloAsso ; le paiement est donc initie avec les identifiants du club organisateur de la competition concernee.

C'est une zone sensible : validation DTO obligatoire sur tous les endpoints, verification de signature sur le webhook.

## 2) Fonctionnalites

- Creation d'un checkout HelloAsso pour une reservation de place (`SeatBooking`).
- Reservation en attente (`PENDING`) avec expiration a 15 minutes.
- Reception du webhook HelloAsso et confirmation de la reservation (`CONFIRMED`).
- Utilisation des identifiants HelloAsso du club organisateur (resolus depuis la competition).
- Cache des tokens OAuth HelloAsso par `clientId`.

## 3) Endpoints backend

Base controller : `apps/backend/src/payment/payment.controller.ts`

Prefixe global : toutes les routes sont prefixees par `/api/v1` (voir `apps/backend/src/main.ts`, `health` exclu).

Routes :

- `POST /api/v1/payment/checkout` — authentifie (`JwtAuthGuard`, `CreateCheckoutDto`). Cree le checkout intent HelloAsso et renvoie l'intent (dont `redirectUrl`).
- `POST /api/v1/payment/webhook` — non authentifie par JWT, protege par `WebhookSignatureGuard` (HMAC-SHA256), `WebhookPayloadDto`. Renvoie `{ received: true }` (HTTP 200). Confirme la reservation quand `eventType === "Order"` et que `data.metadata.bookingId` est present.

## 4) Fichiers cles

Backend :

- `apps/backend/src/payment/payment.controller.ts` — endpoints checkout + webhook.
- `apps/backend/src/payment/payment.service.ts` — orchestration : creation de la reservation, appel HelloAsso, confirmation.
- `apps/backend/src/payment/hello-asso.service.ts` — client HTTP HelloAsso (OAuth token + creation du checkout intent), sous circuit breaker + `withTimeout`.
- `apps/backend/src/payment/guards/webhook-signature.guard.ts` — verification de signature HMAC-SHA256.
- `apps/backend/src/payment/dto/create-checkout.dto.ts` — `competitionId`, `itemId`, `amount`, `seatLabel?`.
- `apps/backend/src/payment/dto/webhook-payload.dto.ts` — `eventType`, `data.metadata.bookingId`.
- `apps/backend/src/payment/payment.module.ts` — importe `ClubsModule`, `PrismaModule`, `ConfigModule`.
- `apps/backend/src/clubs/clubs-helloasso.service.ts` — connexion/lecture du compte HelloAsso d'un club et resolution des identifiants pour une competition (`getHelloAssoCredentialsForCompetition`).

## 5) Regles metier

- Un checkout n'est possible que si le club organisateur de la competition a connecte HelloAsso (`clientId`, `clientSecret`, `organizationSlug` renseignes). Sinon `400`.
- La reservation est creee en statut `PENDING` avec `expiresAt = now + 15 min` avant l'appel HelloAsso ; en cas d'echec de l'initiation, la reservation est supprimee et l'appel renvoie `400`.
- L'`id` du checkout intent est stocke dans `SeatBooking.paymentId`.
- La confirmation passe la reservation en `CONFIRMED` ; elle est declenchee uniquement par le webhook, jamais par le client.
- Validation DTO obligatoire sur tous les endpoints (zone sensible).

## 6) Flux principal (HelloAsso)

1. Le client authentifie appelle `POST /api/v1/payment/checkout` avec la competition, l'article et le montant.
2. Le backend resout les identifiants HelloAsso du club organisateur, cree une reservation `PENDING`, puis demande un checkout intent a HelloAsso (`createCheckoutIntent`).
3. Le backend renvoie l'intent (dont `redirectUrl`) ; le client redirige l'utilisateur vers HelloAsso pour le paiement.
4. Apres paiement, HelloAsso redirige l'utilisateur vers `returnUrl` / `backUrl` / `errorUrl` (bases sur `APP_URL`) et notifie le backend via le webhook.
5. `POST /api/v1/payment/webhook` : le guard verifie la signature HMAC-SHA256, puis le service passe la reservation liee (`metadata.bookingId`) en `CONFIRMED`.

## 7) Securite et points d'attention

- **Signature webhook** : HMAC-SHA256 du corps brut avec `HELLOASSO_WEBHOOK_SECRET`, comparaison en temps constant (`timingSafeEqual`). Si le secret n'est pas configure, le guard **rejette** toutes les requetes (`401`). Le corps brut est disponible car `rawBody: true` est active dans `main.ts`.
- **Secret** : `HELLOASSO_WEBHOOK_SECRET` (voir `docs/configuration/environment-variables.md`).
- **Identifiants HelloAsso par club** : stockes sur le club (`helloAssoClientId`, `helloAssoClientSecret`, `helloAssoOrgSlug`) ; le module paiement ne detient pas de compte HelloAsso global.
- **Appels externes** : le client HelloAsso est protege par circuit breaker (opossum) et `withTimeout` (10 s) ; les tokens OAuth sont mis en cache par `clientId` avec une marge d'expiration.
- **Expiration reservation** : `expiresAt` a 15 min limite les reservations `PENDING` non payees.
