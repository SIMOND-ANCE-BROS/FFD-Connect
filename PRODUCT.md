# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The monorepo ships four surfaces. The mobile app (`apps/client`, React Native / Expo) runs on iOS and Android with **one shared design language** (not adapted per OS), keeping each OS's basic native conventions (navigation, gestures, system sheets). The back-office (`apps/admin`), the landing site (`apps/landing`) and the docs (`apps/docs`) are web.

## Users

- **Licensed dancers** (couples and solo dancers, ballroom "standard" and latin, from beginners to national level) — primary users of the mobile app. They carry their e-licence (in the app and in Apple Wallet), find and register for competitions, follow results, practise with the music library, and use competition mode on event day, often in a venue with poor or no network.
- **Clubs** (club accounts) — manage their members and follow their dancers.
- **Staff / organizers** — check dancers in at events by scanning the licence QR code.
- **Admins** — use the back-office to manage users, competitions, licence renewals and to import competition results (TopTurnier exports, chairperson site).
- **Visitors** of the landing site — discover the app, its roadmap and legal pages; beta testers join from there.

## Product Purpose

FFD Connect gathers in one app what a French competitive dancer needs across a season: licence, competitions, registrations, results, practice music and the competition-day companion. Success means a dancer opens it every competition weekend and trusts what it shows (licence validity, results, deadlines).

## Positioning

An independent product built specifically for French dancesport (FFD rules: levels per discipline, the 10-dance, Espoir couples, circulars), not a generic event or club tool. It is **not endorsed by the FFD**; the long-term goal is to propose it to the federation. Until such an agreement exists, nothing may present it as "official" or as the federation's tool.

## Operating Context

- Event day: in a venue, between heats, one hand, sometimes offline — speed and readability matter more than depth.
- The backend scales to zero: the first request after idle takes 30–60 s; the app shows a dedicated wake screen and replays requests. Never design flows that assume an instant first response.
- Beta distribution today: TestFlight (iOS) and Google Play testing (Android) against the staging backend.

## Capabilities and Constraints

- French is the interface language (code and internal docs in English).
- Offline-first for the licence/QR and favourite music.
- Light and dark modes on the mobile app.
- RGPD is strict: data export/deletion, CGU gate, versioned privacy policy with an in-app notice; no personal data in public places.
- Results from external sources (TopTurnier / chairperson site) are imported on demand by an admin only — no automatic scraping of FFD sources.
- Music import from YouTube is disabled for legal reasons.
- Undecided: production launch date (prod backend is stopped; the beta runs on staging).

## Brand Commitments

- Name: **FFD Connect**. Voice: direct, useful, no marketing fluff (see DESIGN.md "Voice").
- Never claim to be official or endorsed by the FFD (landing included).

## Evidence on Hand

- Real product: the shipped beta app, back-office and landing (`ffd.gabin-simond.fr`), legal texts in `docs/legal/`, public roadmap generated from GitHub issues labelled `roadmap`.
- No testimonials, user numbers, press or federation endorsement exist: never fabricate them.

## Product Principles

1. Trust first: licence status, results and deadlines must be unambiguous and correct.
2. Event-day speed: the most common competition-day actions are one or two taps away and work offline.
3. Honest independence: never borrow federation authority the product does not have.
4. Calm under latency: cold starts and offline states are designed states, not errors.
5. French dancesport truth: model the FFD's real rules rather than generic sport concepts.

## Accessibility & Inclusion

No formal standard has been set. The mobile app already enforces accessible labels for Maestro/VoiceOver; dark mode must keep readable contrast.
