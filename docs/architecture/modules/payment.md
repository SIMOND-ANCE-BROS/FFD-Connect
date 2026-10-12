# Module Payment

## 1) Role metier

Le module paiement gere le reglement en ligne des places de competition via HelloAsso. Chaque club organisateur connecte son propre compte HelloAsso ; le paiement est donc initie avec les identifiants du club organisateur de la competition concernee.

C'est une zone sensible : validation DTO obligatoire sur tous les endpoints ; le contenu des notifications HelloAsso n'est jamais cru, le paiement est relu sur l'API HelloAsso (ADR-0022).

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
- `POST /api/v1/payment/webhook` — non authentifie par JWT, `WebhookPayloadDto`. Pour `eventType === "Order"` avec `metadata.bookingId`, l'intention de paiement de la reservation est relue sur l'API HelloAsso (`HelloAssoNotificationService`) et seule cette version passe les controles. Renvoie `{ received: true }` (200) ; `503` si HelloAsso est injoignable ou si le paiement n'est pas encore autorise (HelloAsso rejoue) ; `401` seulement si une cle partenaire est configuree et que la signature `x-ha-signature` est absente ou fausse.

## 4) Fichiers cles

Backend :

- `apps/backend/src/payment/payment.controller.ts` — endpoints checkout + webhook.
- `apps/backend/src/payment/payment.service.ts` — orchestration : creation de la reservation, appel HelloAsso, confirmation.
- `apps/backend/src/payment/hello-asso.service.ts` — client HTTP HelloAsso (OAuth token + creation du checkout intent), sous circuit breaker + `withTimeout`.
- `apps/backend/src/payment/helloasso-notification.service.ts` — relecture de l'intention de paiement sur l'API HelloAsso (source de verite du webhook).
- `apps/backend/src/payment/helloasso-api-urls.ts` — hotes autorises de l'API HelloAsso (production, sandbox).
- `apps/backend/src/payment/guards/webhook-signature.guard.ts` — verification optionnelle de la signature partenaire `x-ha-signature` (HMAC-SHA256).
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
5. `POST /api/v1/payment/webhook` : la notification designe la reservation (`metadata.bookingId`) ; le backend relit l'intention de paiement de cette reservation (`SeatBooking.paymentId`) sur l'API HelloAsso avec les identifiants du club, puis passe la reservation en `CONFIRMED` si la commande relue est payee, du montant attendu, pour la bonne competition.

## 7) Securite et points d'attention

- **Authenticite des notifications** (ADR-0022, spike #404) : HelloAsso ne signe que les notifications des comptes **partenaires** (en-tete `x-ha-signature`, HMAC-SHA256 du corps brut avec la `signatureKey` de l'URL). Les clubs connectent un compte **association** : leurs notifications ne sont pas signees. Le webhook relit donc toujours le paiement sur l'API ; la signature n'est verifiee qu'en defense en profondeur si `HELLOASSO_SIGNATURE_KEY` est configuree.
- **API HelloAsso** : `{HELLOASSO_API_URL}/oauth2/token` puis `{HELLOASSO_API_URL}/v5/...` (`/v1` repond 404). Hote par defaut `https://api.helloasso.com`, sandbox `https://api.helloasso-sandbox.com`.
- **URL de notification** : chaque club doit inscrire `https://<backend>/api/v1/payment/webhook` dans son espace HelloAsso (« Mon compte > Integrations et API »).
- **Identifiants HelloAsso par club** : stockes sur le club (`helloAssoClientId`, `helloAssoClientSecret`, `helloAssoOrgSlug`) ; le module paiement ne detient pas de compte HelloAsso global.
- **Appels externes** : le client HelloAsso est protege par circuit breaker (opossum) et `withTimeout` (10 s) ; les tokens OAuth sont mis en cache par `clientId` avec une marge d'expiration.
- **Expiration reservation** : `expiresAt` a 15 min limite les reservations `PENDING` non payees.
