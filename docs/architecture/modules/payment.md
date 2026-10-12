# Module Payment

## 1) Role metier

Le module paiement gere le reglement en ligne des places de competition via HelloAsso. Chaque club organisateur connecte son propre compte HelloAsso ; le paiement est donc initie avec les identifiants du club organisateur de la competition concernee.

C'est une zone sensible : validation DTO obligatoire sur tous les endpoints ; le contenu des notifications HelloAsso n'est jamais cru, le paiement est relu sur l'API HelloAsso (ADR-0022).

## 2) Fonctionnalites

- Creation d'un checkout HelloAsso pour une reservation de place (`SeatBooking`) : vente **a la place** (#428).
- Reservation en attente (`PENDING`) avec expiration a 50 minutes ; au plus 4 reservations en attente par utilisateur et par competition.
- Reprise du paiement d'une place deja en attente pour le meme utilisateur (au lieu d'un `409`).
- Paiement encaisse sans place attribuee (paiement tardif, double paiement) : marque `refundOwedAt` + alerte du club organisateur, qui rembourse depuis son espace HelloAsso (#428, #438).
- Reception du webhook HelloAsso et confirmation de la reservation (`CONFIRMED`).
- Liberation de la place quand le paiement est rembourse ou conteste (#403) : `CONFIRMED` → `CANCELLED`, motif dans `SeatBooking.cancelReason`.
- Utilisation des identifiants HelloAsso du club organisateur (resolus depuis la competition).
- Cache des tokens OAuth HelloAsso par `clientId`.

## 3) Endpoints backend

Base controller : `apps/backend/src/payment/payment.controller.ts`

Prefixe global : toutes les routes sont prefixees par `/api/v1` (voir `apps/backend/src/main.ts`, `health` exclu).

Routes :

- `POST /api/v1/payment/checkout` — authentifie (`JwtAuthGuard`, `CreateCheckoutDto`). Reserve une place et renvoie `{ id, redirectUrl, bookingId, seatIndex, expiresAt, resumed }` (`CheckoutResponseDto`). `409` : place prise, element complet, 4 reservations en attente, ou paiement deja en cours ; `503` : HelloAsso injoignable pendant une reprise.
- `POST /api/v1/payment/webhook` — non authentifie par JWT, `WebhookPayloadDto`. Pour `eventType === "Order"` avec `metadata.bookingId`, l'intention de paiement de la reservation est relue sur l'API HelloAsso (`HelloAssoNotificationService`) et seule cette version passe les controles. Renvoie `{ received: true }` (200) ; `503` si HelloAsso est injoignable ou si le paiement n'est pas encore autorise (HelloAsso rejoue) ; `401` seulement si une cle partenaire est configuree et que la signature `x-ha-signature` est absente ou fausse.

## 4) Fichiers cles

Backend :

- `apps/backend/src/payment/payment.controller.ts` — endpoints checkout + webhook.
- `apps/backend/src/payment/payment.service.ts` — orchestration : creation de la reservation, appel HelloAsso, confirmation.
- `apps/backend/src/payment/hello-asso.service.ts` — client HTTP HelloAsso (OAuth token + creation du checkout intent), sous circuit breaker + `withTimeout`.
- `apps/backend/src/payment/helloasso-notification.service.ts` — relecture de l'intention de paiement sur l'API HelloAsso (source de verite du webhook).
- `apps/backend/src/payment/helloasso-api-urls.ts` — hotes autorises de l'API HelloAsso (production, sandbox).
- `apps/backend/src/payment/guards/webhook-signature.guard.ts` — verification optionnelle de la signature partenaire `x-ha-signature` (HMAC-SHA256).
- `apps/backend/src/payment/seat-hold.service.ts` — ecritures des reservations : place, plafond des reservations en attente, reprise (#428).
- `apps/backend/src/payment/seat-layout.ts` — places vendues par un element du plan (numerotees ou placement libre).
- `apps/backend/src/payment/refund-owed-alert.service.ts` — alerte « remboursement a effectuer » aux gestionnaires du club organisateur.
- `apps/backend/src/payment/dto/create-checkout.dto.ts` — `competitionId`, `itemId`, `seatIndex?`, `seatLabel?` (affichage seulement), `amount` (ignore).
- `apps/backend/src/payment/dto/webhook-payload.dto.ts` — `eventType`, `data.metadata.bookingId`.
- `apps/backend/src/payment/payment.module.ts` — importe `ClubsModule`, `PrismaModule`, `ConfigModule`.
- `apps/backend/src/clubs/clubs-helloasso.service.ts` — connexion/lecture du compte HelloAsso d'un club et resolution des identifiants pour une competition (`getHelloAssoCredentialsForCompetition`).

## 5) Regles metier

- Un checkout n'est possible que si le club organisateur de la competition a connecte HelloAsso (`clientId`, `clientSecret`, `organizationSlug` renseignes). Sinon `400`.
- **Vente a la place** (#428). Element numerote (`TABLE` : places = `capacity` ; `GRADIN` : places = `rows × cols`, indice `rang × cols + colonne`) : la place est designee par `seatIndex`, validee cote serveur (dans l'element, hors `lockedSeats`) ; sans `seatIndex`, le serveur attribue la premiere place libre. Placement libre (tout autre element) : pas de numero, au plus `capacity` moins les places verrouillees ; le serveur attribue un creneau interne. Un element sans `capacity` (plans anterieurs) compte pour une place. `priceCents` est le prix **d'une place**. `seatLabel` (texte libre) n'identifie jamais la place.
- Garanties en base (index uniques partiels) : une reservation active (`PENDING`/`CONFIRMED`) par place (`SeatBooking_active_seat_index_key` sur `(competitionId, itemId, seatIndex)`) ; au plus 4 `PENDING` par utilisateur et par competition (`SeatBooking_pending_cap_key` sur `(competitionId, userId, pendingSlot)`, creneaux 0..3 par contrainte CHECK). Les lignes sans `seatIndex` (anterieures a #428, ou ecrites par une revision precedente apres rollback) gardent l'ancienne garantie d'une reservation active par element (`SeatBooking_active_item_legacy_key`). Cette garantie ne couvre que ces lignes : apres des ventes a la place, une revision anterieure (rollback) pourrait vendre un element entier a cote de places vendues et ignorerait les paiements faits sur une intention remplacee — corriger en avant plutot que rester en rollback.
- La reservation est creee en statut `PENDING` avec `expiresAt = now + 50 min` avant l'appel HelloAsso : HelloAsso considere un checkout abandonne apres 45 min sans paiement autorise (sandbox, #404), plus 5 min de marge pour que la notification arrive. En cas d'echec de l'initiation, la reservation est supprimee et l'appel renvoie `400`. Les reservations echues passent en `EXPIRED` paresseusement (pas de tache planifiee).
- L'`id` du checkout intent est stocke dans `SeatBooking.paymentId`, sa page dans `checkoutRedirectUrl` (renvoyee uniquement au proprietaire de la reservation) et sa date dans `checkoutCreatedAt`.
- **Reprise** (#428) : un checkout du meme utilisateur sur sa place en attente (meme `seatIndex`, ou meme element sans `seatIndex`) renvoie la page HelloAsso stockee si elle a moins de 14 min (validite 15 min) ; sinon, si HelloAsso n'a pas deja un paiement sur l'intention, une nouvelle intention est creee pour la meme reservation et au meme prix, l'ancienne est conservee dans `supersededPaymentIds` (encore payable) et l'echeance est repoussee d'une reservation complete sans depasser 100 min depuis la creation.
- La confirmation passe la reservation en `CONFIRMED` ; elle est declenchee uniquement par le webhook, jamais par le client.
- Remboursement / contestation (#403) : une notification `Payment` dont l'etat annonce est `Refunded` ou `Contested` declenche la relecture du paiement (`GET /v5/payments/{id}`, puis `GET /v5/orders/{id}` si l'identifiant d'intention manque) avec les identifiants du club. Si HelloAsso confirme l'etat et que le paiement appartient bien a l'intention de la reservation (`SeatBooking.paymentId`), une reservation `CONFIRMED` passe en `CANCELLED` avec `cancelReason` = `HELLOASSO_REFUNDED` ou `HELLOASSO_CONTESTED`. Ecriture conditionnelle (idempotente) ; `Refunding` (en cours, peut echouer) ne libere rien ; une contestation gagnee ensuite ne rend pas la place (traitement manuel par l'organisateur). Liberation et rejets tracees dans Sentry (`helloasso-seat-released`, `helloasso-payment-rejected`, identifiants seulement).
- **Remboursement du** (#428) : un paiement authentique et complet sur une reservation echue (`booking_expired`) ou sur une autre intention d'une place deja confirmee (`duplicate_payment`) ne confirme rien ; l'intention payee est ajoutee a `refundOwedPaymentIds` (une entree par paiement a rembourser, `refundOwedAt` renseigne tant que la liste n'est pas vide) et les gestionnaires du club organisateur sont alertes une fois par paiement (notification `CLUB_PAYMENT_RECEIVED`, toujours envoyee, sans donnee du payeur). Le remboursement est manuel par le club depuis HelloAsso (#438) ; la notification `Refunded`/`Contested` de ce paiement retire son entree (et `refundOwedAt` quand il n'en reste aucune ; `cancelReason` renseigne sur une reservation `EXPIRED`) sans toucher a une place confirmee par un autre paiement.
- Validation DTO obligatoire sur tous les endpoints (zone sensible).

## 6) Flux principal (HelloAsso)

1. Le client authentifie appelle `POST /api/v1/payment/checkout` avec la competition, l'element du plan et, pour un element numerote, la place (`seatIndex`).
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
- **Expiration reservation** : `expiresAt` a 50 min limite les reservations `PENDING` non payees ; avec le plafond de 4 par utilisateur et par competition, un compte ne peut pas bloquer une salle.
- **Notification sur une ancienne intention** : seules les intentions enregistrees sur la reservation (`paymentId`, `supersededPaymentIds`) sont relues ; jamais un identifiant arbitraire du corps de la notification.
