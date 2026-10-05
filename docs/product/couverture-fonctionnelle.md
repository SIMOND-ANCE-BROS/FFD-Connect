# Couverture fonctionnelle — FFD-Connect

**Date :** 2026-07-18 — Instantané / Snapshot

**Source :** Comparaison de la spec `ffd.md` v2.5 au code réel (`apps/backend/src`, `apps/client/src`, `apps/backend/prisma/schema`).

**Méthodologie :** Les statuts reflètent une vérification d'**implémentation réelle et de câblage** (grep des appelants, imports d'écrans, schéma Prisma) — pas une simple présence de fichiers. Un composant présent mais jamais appelé est classé comme non livré.

> ⚠️ Ce document est un instantané daté. Les chemins de fichiers sont vrais à la date ci-dessus ; re-vérifier en code avant de s'y fier (voir « Comment mettre à jour »).

---

## Résumé exécutif

| Module                     | Statut | Couverture   | Note                                                                            |
| -------------------------- | ------ | ------------ | ------------------------------------------------------------------------------- |
| **§3.1 Administratif**     | 🟡     | ~65-70 %     | Identité/JWT + licence livrées ; QR sans RSA/TOTP ; OCR serveur (mock possible) |
| **§3.2 Sportif**           | ✅     | ~90 %        | Lecteur audio + Mode Simulation conformes                                       |
| **§3.3 Compétition**       | 🟡     | ~60 %        | Inscription + check-in solides ; « temps réel » = polling, non câblé            |
| **§3.4 Carrière**          | 🟡     | ~40 %        | Écrans livrés ; points en base absents ; données de démo                        |
| **§3.5 Communautaire**     | ⏸      | ~0 %         | **Reporté par choix.**                                                          |
| **§3.6 Admin Web**         | ⏸      | ~0 %         | **Reporté par choix** (seul le RBAC backend existe).                            |
| **Cœur global (§3.1–3.4)** | 🟡     | **~60-65 %** | **Beta-ready avec un scope honnête.**                                           |

---

## §3.1 — Administratif (Identité · QR · WDSF) — 🟡 Partiel (~65-70 %)

### ✅ Livré

- **Auth JWT + RBAC** — JWT signés (`apps/backend/src/auth/auth.service.ts`, `apps/backend/src/auth/jwt.strategy.ts`), refresh/reset hashés SHA-256. **4 rôles** `LICENSEE / CLUB / STAFF / ADMIN` (`apps/backend/prisma/schema/user.prisma`), gardes `@Roles` + `RolesGuard` (`apps/backend/src/auth/guards/roles.guard.ts`). Impersonation tracée (`POST /auth/impersonate`, modèle `ImpersonationLog`).
- **Liaison licence à l'inscription** — `register()` (`apps/backend/src/auth/auth.service.ts`) recherche la licence par numéro, vérifie qu'elle est **non réclamée** et **non expirée**, lie l'utilisateur en transaction. DTO : `apps/backend/src/auth/dto/register.dto.ts` (email, password, `licenseNumber`, `lastName`, `firstName`).
- **E-Licence : QR + validité + hors-ligne** — QR affiché (`apps/client/src/features/license/components/QRCodeView.native.tsx`), validité à 4 états en ligne (`apps/client/src/features/license/utils/licenseExpiry.ts` ; vert/rouge binaire seulement dans le bandeau hors-ligne), snapshot `AsyncStorage` (`apps/client/src/features/license/utils/licenseSnapshot.ts`, clé `license_snapshot_v1`).
- **Import WDSF** — `GET /wdsf/athlete/:min` (`apps/backend/src/wdsf/wdsf.controller.ts` → `wdsf.service.ts`) : appel REST réel API WDSF v1/v2 + circuit breaker (opossum).
- **Renouvellement** — Upload 2 documents + OCR, workflow modélisé (`apps/backend/src/licenses/license-renewal.service.ts`, `POST /licenses/renew` + `renewal/*`), stockage Azure Blob (`apps/backend/src/storage/blob-storage.service.ts`).

### 🟡 Écarts notables

- **QR non sécurisé** — Le QR encode un JSON **en clair** (`{ id, valid, type }`) et statique. La colonne `qrCodeSignature` (`apps/backend/prisma/schema/license.prisma`) est **sélectionnée mais jamais générée** (toujours `null`). Pas de signature RSA ni TOTP (#419). Pas de chiffrement AES-256 des données santé (#418).
- **OCR divergent** — `apps/backend/src/utils/ocr.service.ts` = **Azure AI Vision côté serveur**, avec **mode MOCK** si `AZURE_VISION_ENDPOINT` non défini. Pas le **ML Kit on-device** de la spec.
- **Renouvellement ≠ spec** — Workflow d'**upload de documents**, pas le formulaire « One-Tap pré-rempli N-1 » spécifié. La soumission **auto-approuve** (pas de modération ; statut `REJECTED` défini mais inutilisé ; endpoint approve sans garde `@Roles`).
- **e-Card WDSF** — Le code-barres affiché est **décoratif** (`apps/client/src/features/license/components/BigBarcode.tsx`, 40 barres en dur, non scannable). **RLS** (Reduced License Scheme) absent.
- **`lastName` non vérifié** — À l'inscription, seul le **numéro** de licence est contrôlé ; le `lastName` (annoté « doit correspondre à la licence ») n'est pas comparé.
- **Cartes STAFF/CLUB** — Données en dur côté client (ex. `STAFF-001`, `CLUB-001`).

---

## §3.2 — Sportif (Audio & Simulation) — ✅ Livré (~90 %, le plus solide)

### ✅ Livré

- **Lecteur audio complet** — `apps/client/src/utils/TrackPlayerWrapper.ts` (sur `expo-audio`) : play/pause/seek, position, durée.
- **Tempo variable ±50 %** — Dépasse le ±30 % spécifié (bonus). **Pitch préservé** via correction native de l'OS (`shouldCorrectPitch`), **pas** de DSP SoundTouch/C++ custom.
- **Mode Simulation conforme** — 5 danses / 90 s / pause 15 s / fade + annonces TTS (`apps/client/src/features/performance/hooks/usePerformanceEngine.ts`, `apps/client/src/stores/performance.store.ts`).
- **Catalogue fédéral streamé** — Pas d'import utilisateur ni de fichiers locaux.

### ⚠️ À valider

- **TTS runtime** — `@google/genai` 2.x : le SDK est mocké en test ; le chemin réel est **à valider sur staging** (#677) car il conditionne les annonces du Mode Simulation.

---

## §3.3 — Compétition (« Temps réel ») — 🟡 Partiel (~60 %)

### ✅ Livré réellement

- **Inscription** — `apps/backend/src/competitions/` (`competition-registration.service.ts`) : partenaire, dossard, `feePaid`, check-in. `POST /competitions/:id/register`.
- **Filtrage d'éligibilité par profil** — Âge/niveau (Articles 8-9) via `competition-query` + règles `common/participation-rules`.
- **Check-in QR** — Staff (`apps/client/src/features/competitions/.../ScannerScreen.tsx`, `expo-camera` → `POST /competitions/:id/checkin`) **et** bénévole sans compte (`VolunteerCheckinScreen`, `VolunteerToken` 24 h).
- **Import compétitions FFD** — `apps/backend/src/competitions/services/competition-sync.service.ts` (API publique FFD ; métadonnées + programme texte/PDF).
- **Bonus hors-spec** — Billetterie / plan de salle (`SeatBooking` dans `apps/backend/prisma/schema/competition.prisma` + HelloAsso).

### ⏸ Décor / scaffolding NON câblé (vérifié en code)

**a) Live timing WebSocket**

- Gateway réelle `apps/backend/src/competitions/live.gateway.ts` (Socket.io, namespace `live`, JWT) exposant `broadcastHeatUpdate/DelayUpdate/ResultPublished` — mais ces émetteurs ne sont appelés **que dans le gateway + ses tests** (0 appelant en prod).
- Hook client `apps/client/src/features/competitions/hooks/useLiveTiming.ts` importé **uniquement par son propre test** (aucun écran).
- L'écran « en direct » fait du **polling 30 s** : `apps/client/src/features/competitions/hooks/useLiveResultsLogic.ts:72` (`setInterval(..., 30000)`).
- Aucun modèle `Heat` en base ; `delayMinutes` n'a aucun chemin d'écriture (reste à 0).

**b) Système de notation (Skating)**

- `apps/backend/src/competitions/skating.util.ts` = « Simple **Rule 5 & 6** » + tie-breaks Rule 6/7 (**pas** « Rule 11 »). `calculatePlaces()` **jamais appelé hors tests**.

**c) Push FCM**

- `sendToDevice` / `sendToTopic` présents (`apps/backend/src/notifications/notifications.service.ts`) mais **0 appelant runtime** ; **aucun champ `fcmToken`/`expoPushToken`** au schéma `User` → push réel impossible (mode mock si Firebase non configuré).
- Notifications métier = **in-app uniquement** (table `Notification`, `apps/backend/prisma/schema/notification.prisma`).

**d) Données résultats/timing** — Créées par des **scripts offline / scraping** (type « chairperson »), pas Scrutelle, pas temps réel.

---

## §3.4 — Carrière (Palmarès & Règlements) — 🟡 Partiel (~40 %)

### ✅ Livré

- **Module `career` réel** — `apps/backend/src/career/` (`career.controller.ts`, `career.service.ts`, `career-query.service.ts`) : `GET /career/me`, `/career/user/:userId`, `/career/search-members` (recherche membres en ILIKE).
- **Écrans palmarès** — `apps/client/src/features/career/screens/CareerScreen.tsx` + `ViewCareerScreen.tsx` : partenariats, inscriptions, résultats ; historique trié date desc, format « Xe sur Y ».

### 🟡 Manques critiques

- **Points absents en base** — Le modèle `Result` (`apps/backend/prisma/schema/competition.prisma`) n'a pas de champ `points` (id, eventId, userId, round, `ranking`, details Json?). Le palmarès affiche le **rang**, jamais des points.
- **Données = seed de démo** — Les résultats visibles proviennent de `apps/backend/scripts/seed-beta-career.ts` (compte `beta@test.com`, staging/beta). **Aucun flux de production** ne crée de `Result` rattaché à un utilisateur.
- **Jauge de progression absente** — `apps/backend/src/common/level-accession/level-accession.util.ts` calcule l'éligibilité par passeport mais porte des TODO explicites « points à compléter » ; pas de jauge cliente ni de seuils (#137).
- **Podium or/argent/bronze non mergé** — Story #136, portée par la PR **#688** (`apps/client/src/utils/podium.ts` + tokens thème) — **branche non mergée** dans `develop`. Statut = en vol.
- **Règlements intelligents absents** — Aucune recherche full-text/TSVECTOR, aucun écran, aucun modèle `Reglement`. Les « règles » backend (`common/level-accession`, `common/participation-rules`) sont des utilitaires d'éligibilité codés en dur, pas un référentiel interrogeable.

---

## §3.5 — Communautaire — ⏸ Reporté (~0 %)

**Aucun code livré (choix produit).**

- **Bourse aux partenaires** : absente (le modèle `Partnership` = couples de danse inter-clubs, pas un marché).
- **Covoiturage** : 0 fichier.
- **Vide-dressing / marketplace** : absent.
- **Chat / messagerie** : absent (aucun modèle `Message`/`Conversation` ; `socket.io` = live-timing, `firebase-admin` = push FCM).
- **Géolocalisation PostGIS / geohash** : absente (seule géo réelle = `Competition.latitude/longitude` pour la carte du lieu).

---

## §3.6 — Portail Admin Web — ⏸ Reporté (~0 %)

**Pas d'application web d'administration** (`apps/landing` = vitrine marketing).

- **Dashboard analytique / heatmap / stats d'usage** : absents (`analytics` client = stub `console.log`).
- **Push ciblés par région/discipline** : absents (aucun endpoint d'envoi ; `sendToTopic` jamais appelé).
- **Modération des certificats** : absente (renouvellement auto-approuvé ; pas de file de revue).

### ✅ Livré (RBAC backend uniquement)

- **Rôles** `ADMIN / STAFF / CLUB / LICENSEE` + `@Roles`/`RolesGuard`, **impersonation** tracée (`ImpersonationLog`), module `reports` (bug/feature → issues GitHub). **Consommé via l'app mobile**, pas de back-office web.

---

## Couverture chiffrée (qualitative — pas une métrique trackée)

**Cœur §3.1–3.4 ≈ 60-65 %**

- §3.2 Audio : ~90 % ✅
- §3.3 Inscription + check-in : solides — mais live timing / push / skating = **0 % câblé** (décor)
- §3.1 Identité : ~65-70 % (QR sans signature, OCR au mock)
- §3.4 Carrière : ~40 % (points absents, données de démo)

**Différé §3.5–§3.6 ≈ 0-5 %** (par choix ; seul le RBAC backend existe pour §3.6).

---

## Verdict

### Beta-ready : **OUI**, avec un scope honnête

Parcours quotidiens opérationnels de bout en bout : s'inscrire avec une licence FFD, lecteur audio + Mode Simulation, check-in à l'arrivée, consulter palmarès (données de démo), e-Licence + QR hors-ligne, import WDSF.

**À ne pas survendre aux testeurs :**

- Compétition « temps réel » (= polling 30 s, WebSocket non câblé)
- Notifications **push** (infra présente, zéro câblage, pas de token stocké)
- Scoring automatique (Skating jamais appelé ; points en base absents)

### Launch-ready (public) : **NON**

Pôle bloquant = **légal & sécurité** :

1. **#418** — Chiffrement AES-256 des certificats + consentement parental (mineurs, RGPD). Déjà sensible en beta (vrais certificats uploadés).
2. **#424** — Cadre légal in-app (CGU/confidentialité) + droits RGPD (export/suppression).
3. **#419** — QR anti-fraude (signature RSA + TOTP).
4. **#422** — Build Android + Google Play (aujourd'hui iOS/TestFlight seul).
5. **#546-C** — Push FCM/APNs réel (stockage token + envoi).

---

## Gaps priorisés

### Avant une beta solide

1. **#416** — Offline-First E-Licence/QR (le cas « jour J au fond du gymnase »).
2. **#546 A+B** — Centre de notifications utile (inbox + événements métier : inscription confirmée, résultats publiés, licence expirée).
3. **#78** — Écran « Mes inscriptions ».
4. **#137** — Jauge de progression (niveau + points).
5. En vol à finir : podium **#688**, validation TTS **#677**, build beta fix clé Places (fait).

### Avant le lancement public

1. **#418 → #424** — Chiffrement + cadre légal (chemin critique).
2. **#419** — QR RSA/TOTP.
3. **#422** — Android + Play.
4. **#546-C** — Push réel.
5. Durcissement : **#417** (RGAA), **#446** (WAF Cloudflare), **#420** (compression images).

---

## 3 prochaines features à prioriser

1. **Centre de notifications multi-profils + événements serveur** (#546 A+B) — ROI élevé, effort S/M (l'écran et le backend existent, « il suffit » de créer les `Notification` aux bons moments et d'exposer la cloche partout).
2. **Offline-First E-Licence/QR** (#416) — effort M, sert directement le QR d'entrée.
3. **Démarrer le train RGPD/sécurité** (#418 puis #424) — effort M/L, le plus long chemin vers le lancement, non négociable.

---

## Note sur la roadmap

- **L'issue #2 (« Roadmap ») est supprimée** — la roadmap vit dans les **milestones natifs GitHub** (v0.1/0.2/0.3 fermés ; MVP Communauté #1 ; v1.0 Launch Hardening #9 ; **v1.0 Public Launch #2** = chemin critique, échéance 31/08 ; v1.1 Carrière #3 ; v1.2 Communauté #4 ; v2.0 Admin Portal #5).
- Plusieurs stories cœur sont **livrées en code mais leur issue reste OUVERTE** (ex. palmarès #136). **Action : resynchroniser le board avec la réalité du code.**

---

## À vérifier (non tranché)

- Affichage réel de l'e-Card WDSF côté client (données + RLS).
- Complétude visuelle de la jauge de progression une fois implémentée.
- Méthode exacte de génération de `qrCodeSignature` (statique confirmé ; RSA/TOTP absents).
- Existence d'un producteur **réel** des updates de heat (Scrutelle automatisé vs saisie staff).

---

## Questions aux parties prenantes

**FFD** — Qui valide les certificats de renouvellement **rejetés**, et sous quel SLA (dimensionne #418/#156) ? Lancement iOS-first acceptable, ou Android obligatoire au go-live (#422) ?
**WDSF** — Accès/API pour l'import **RLS** de l'e-Card ?
**Éditeur Scrutelle** — Flux automatisé vers le live timing possible, ou saisie staff en beta ?

---

## Annexe — Inventaire du code « décor / mocké »

Éléments présents mais **non câblés en production** :

| Élément                         | Fichier                                                        | Statut                          |
| ------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| `broadcastHeat/Delay/Result`    | `apps/backend/src/competitions/live.gateway.ts`                | Déclarés, jamais appelés (prod) |
| `useLiveTiming`                 | `apps/client/src/features/competitions/hooks/useLiveTiming.ts` | Importé par son test seul       |
| `SkatingSystem.calculatePlaces` | `apps/backend/src/competitions/skating.util.ts`                | Rule 5&6, jamais appelé (prod)  |
| `delayMinutes`                  | payload live timing (aucun modèle `Heat`)                      | Jamais écrit (=0)               |
| `qrCodeSignature`               | `apps/backend/prisma/schema/license.prisma`                    | Jamais peuplée (`null`)         |
| Stockage token push             | schéma `User` (`apps/backend/prisma/schema/user.prisma`)       | Champ absent → push impossible  |
| `sendToDevice` / `sendToTopic`  | `apps/backend/src/notifications/notifications.service.ts`      | Déclarés, jamais appelés (prod) |
| OCR mode MOCK                   | `apps/backend/src/utils/ocr.service.ts`                        | Fallback si Azure non configuré |
| `BigBarcode` (WDSF)             | `apps/client/src/features/license/components/BigBarcode.tsx`   | Décoratif (barres en dur)       |
| `simulateScan`                  | scanner QR check-in (`useScannerLogic`)                        | Mock de démo                    |
| Cartes STAFF/CLUB               | `apps/client/src/features/license` (getListItems)              | Données en dur                  |

---

## Comment mettre à jour ce document

1. **Quand** : après une livraison majeure (merge vers `develop`), avant une promotion vers `staging`.
2. **Vérifier en code** (ne pas se fier à la présence de fichiers) — audit rapide :

```bash
# Ce qui a changé depuis le dernier snapshot
git log --oneline <sha-précédent>..HEAD -- apps/backend/src/competitions apps/backend/src/licenses apps/backend/src/career

# Le "décor" est-il enfin câblé ?
grep -rn "broadcastHeatUpdate" apps/backend/src   # un appelant hors gateway/test = live timing branché
grep -rn "calculatePlaces"     apps/backend/src   # un appelant hors test = skating branché
grep -rn "qrCodeSignature"     apps/backend/src   # une écriture = QR signé
grep -rn "fcmToken\|expoPushToken" apps/backend/prisma/schema   # un champ = push possible
```

3. **Redater** l'en-tête (YYYY-MM-DD) et committer : `docs: snapshot couverture-fonctionnelle YYYY-MM-DD`.

---

**Prochaine révision recommandée :** après merge #546 A+B + #677, ou avant la promotion `staging → master`.
