# ADR-0023: QR d'entrée tournant, vérifiable hors ligne

**Date**: 2026-10-16
**Status**: proposed
**Deciders**: Gabin Simond

## Context

Le QR de la licence est signé depuis #168 (HMAC-SHA256, `QR_SIGNING_SECRET`) et lié à la licence elle-même depuis #466 (v2 : `lid`). Il reste **statique** : valable jusqu'à la fin de validité de la licence, il est copié tel quel dans le pass Apple Wallet (#160) et dans le snapshot hors ligne de l'E-Licence (#416).

Deux limites, relevées dans l'issue #24 :

1. **Vérification hors ligne impossible.** Le HMAC exige le secret pour vérifier : seul le serveur peut le faire. Dans un gymnase sans réseau, le scanner (staff ou bénévole) ne sait rien dire d'un QR.
2. **Capture d'écran rejouable.** Un QR statique se partage : la capture d'écran d'un licencié fait entrer quelqu'un d'autre toute la saison.

Le cahier des charges (doc, § 3.1) évoque « signature RSA256 + régénération TOTP ». Contraintes du projet : scanners non fiables (téléphones de bénévoles, liens jetables de 24 h), réseau absent dans les salles, RGPD (minimisation), budget nul, pass Wallet statique à conserver.

## Decision

**Jetons courts signés par le serveur avec une clé asymétrique (Ed25519), pré-téléchargés par le téléphone du licencié, vérifiés hors ligne par le scanner avec la seule clé publique.**

1. **Format v3** (`apps/backend/src/licenses/qr/entry-qr.ts`, miroir client `apps/client/src/features/license/utils/entryQr.ts`) :

   ```json
   {"v":3,"k":"<id de clé>","id":"<n° licence>","lid":"<id licence>","nm":"NOM Prénom","t":<pas>,"sig":"<base64url>"}
   ```

   - `t` = pas de temps de **30 s** (`floor(secondes Unix / 30)`) ;
   - `sig` = signature Ed25519 sur `JSON.stringify(["ffd-entry-qr", 3, k, lid, id, nm, t])` (UTF-8), jamais sur les octets bruts du QR ;
   - `k` = 8 premiers octets du SHA-256 de la clé publique brute (rotation) ;
   - `nm` = nom du titulaire : un scanner hors ligne ne peut pas consulter la base, le bénévole compare ce nom à la personne en face ;
   - `id` garde la clé lue depuis toujours par le check-in ; `lid` lie la licence comme en v2 (#466).

2. **Lot pré-signé** : `GET /licenses/my/entry-qr` (JWT, refusé en impersonation, `Cache-Control: no-store`, 10/min) renvoie une signature par pas sur **12 h** (1 440 signatures, ~130 Ko), jamais au-delà de la fin du jour de validité de la licence (Europe/Paris, même règle que le QR statique). Aucune écriture en base : le lot se recalcule. L'application le récupère à chaque ouverture de l'E-Licence en ligne quand il couvre moins de 6 h, le garde lié au compte (comme le snapshot #416) et affiche le QR du pas courant, avec un compte à rebours.

3. **Vérification** : signature **puis** fraîcheur, à **±1 pas** de l'horloge du vérificateur (dérive d'horloge et temps de scan). Une capture vaut donc au plus 90 s. Statut `STALE` pour un QR authentique hors fenêtre.
   - **En ligne** : `LicenseQrService.verify` reconnaît la v3 et la confie à `EntryQrService` ; mêmes modes `off` / `warn` / `enforce` que #168 (STALE refusé en `enforce`, signalé au staff en `warn`) ; la résolution par `lid` de #466 s'applique telle quelle.
   - **Hors ligne** : `GET /licenses/entry-qr/keys` (public : ce sont des clés publiques ; un bénévole n'a pas forcément de compte) publie les clés active et retirées. Le scanner les télécharge à l'ouverture et les garde en cache. Sans réseau, il vérifie localement (`@noble/curves`, Ed25519) : vert = licence authentique et QR frais, avec le nom du titulaire.

4. **Synchronisation** : un scan hors ligne valide est mis dans la file hors ligne existante (#416) et rejoué au retour du réseau avec un champ **`scannedAt`** (ISO 8601, ajouté à `CheckInDto` et `VolunteerCheckInDto`). Le serveur vérifie le QR **à cet instant**, refuse un `scannedAt` futur (au-delà de 2 min de dérive) ou vieux de plus de 48 h, et date le check-in de l'instant du scan. L'inscription et les droits ne sont vérifiés qu'à ce moment-là ; un refus est annoncé au staff.

5. **Configuration** (`ConfigService`) : `ENTRY_QR_SIGNING_KEY` (clé privée Ed25519, PEM PKCS#8, `\n` littéraux acceptés) et `ENTRY_QR_RETIRED_PUBLIC_KEYS` (clés publiques brutes séparées par des virgules, gardées ≥ 12 h après une rotation). Clé absente ou invalide ⇒ fonctionnalité désactivée (404 sur le lot — jamais 503, que l'app interprète comme un backend endormi à réveiller — ; l'app garde le QR statique), le backend démarre. Génération : `openssl genpkey -algorithm ed25519`. La clé privée vit dans Key Vault (`ffd-connect-kv`, comme les autres secrets runtime), jamais dans le dépôt.

6. **Rétrocompatibilité** : payload versionné. Les QR v2 et v1 restent acceptés en ligne comme avant ; le **pass Wallet garde le QR statique v2** (un pass ne se met pas à jour toutes les 30 s). Aucune migration de base.

## Alternatives Considered

### Alternative 1 : TOTP (secret partagé par licence)

- **Pros** : standard connu, QR minuscule, aucun lot à télécharger côté licencié.
- **Cons** : vérifier un code TOTP exige le **secret** : un scanner hors ligne devrait détenir les secrets de tous les participants attendus. Un téléphone de bénévole perdu ou un lien jetable divulgué permettrait alors de **fabriquer** des QR pour tout le monde, sans limite de temps. Il faudrait une liste par compétition, chiffrée au repos, expirée après l'épreuve : beaucoup de surface pour un appareil non maîtrisé.
- **Why not** : la signature asymétrique donne la même rotation sans aucun secret sur les scanners. L'issue admet explicitement « ou signature asymétrique vérifiable sans réseau ».

### Alternative 2 : RSA-SHA256 (le « RSA256 » du cahier des charges)

- **Pros** : cité par le cahier des charges, universel.
- **Cons** : une signature RSA-2048 fait 256 octets (342 caractères base64url) : le QR devient dense, moins lisible sur un écran abîmé ou en plein soleil, et le lot de 12 h passe à ~500 Ko.
- **Why not** : Ed25519 offre la même propriété (asymétrique, standard RFC 8032, natif dans Node, bibliothèque JS auditée côté app) avec 64 octets de signature et une signature déterministe (vecteur de référence partagé backend/client).

### Alternative 3 : clé de l'appareil certifiée par le serveur

- **Pros** : le téléphone génère une paire de clés, le serveur certifie sa clé publique pour la licence ; le téléphone signe lui-même chaque pas. Aucun lot, hors ligne illimité pendant la durée du certificat.
- **Cons** : génération de clé et signature sur l'appareil (aléa, stockage de la clé privée), QR plus gros (certificat + deux signatures), révocation à concevoir.
- **Why not** : plus complexe pour un gain marginal en v1.0 ; 12 h couvrent une journée de compétition. Piste d'évolution si le lot devient gênant.

### Alternative 4 : rester en ligne seulement (statu quo #171)

- **Pros** : rien à construire.
- **Cons** : aucun contrôle sans réseau, capture d'écran valable toute la saison.
- **Why not** : ne répond pas à #24.

## Consequences

### Positive

- Contrôle d'accès **sans réseau** : signature + fraîcheur vérifiées localement, nom du titulaire affiché.
- Aucun secret sur les scanners : un téléphone de bénévole perdu ne permet de fabriquer aucun QR.
- Une capture d'écran du QR tournant ne vaut que 90 s.
- Aucune table, aucune migration ; le lot est dérivé de la licence et de la clé.
- Rotation de clé sans coupure (`ENTRY_QR_RETIRED_PUBLIC_KEYS`).

### Negative

- Le QR statique v2 (pass Wallet, anciennes versions de l'app, snapshot) **reste accepté en ligne** : tant qu'il l'est, la protection contre la capture d'écran ne vaut que pour le QR v3. Le rendre obligatoire (par compétition ou globalement) est une décision ouverte.
- Le lot (~130 Ko) est stocké dans AsyncStorage, pas dans SecureStore (limite ~2 Ko par valeur) : quelqu'un qui extrait les données de l'app peut rejouer ses jetons pendant 12 h au plus — moins que le QR statique, qui y vit déjà pour toute la saison.
- Hors ligne, le scanner ne sait pas si la personne est **inscrite** ni si ses droits sont payés : il ne le saura qu'à la synchronisation. Une liste d'inscrits par compétition téléchargée à l'avance (minimisée, expirée après l'épreuve) est une évolution possible.
- Un licencié qui n'a jamais ouvert l'E-Licence en ligne dans les 12 h précédant l'entrée n'a pas de QR tournant : il retombe sur le QR statique.
- Le téléphone doit être à l'heure (±30 s) : l'heure automatique est la règle, sinon `STALE`.

### Risks

- **Fuite de la clé privée** : permettrait de forger des QR. Mitigation : Key Vault + identité managée, rotation documentée, clé dédiée à cet usage (séparateur de domaine `ffd-entry-qr`).
- **`scannedAt` déclaré par le scanner** : un staff pourrait antidater un scan pour valider une capture ancienne. Le staff et les bénévoles sont déjà de confiance pour faire entrer quelqu'un ; la fenêtre est bornée à 48 h et chaque rejeu est journalisé.
- **Divergence backend / client du contenu signé** : vecteur de référence commun (`entry-qr-test-keys.mock.ts`, `entryQr.test.ts`) qui casse les deux suites au moindre écart.
