/**
 * Placeholders of the licences created for beta testers on staging (#555):
 * pre-seeded by `scripts/seed-beta-testers.ts` or auto-created at registration
 * under BETA_AUTO_LICENSE. Their discipline is unknown, so the category is a
 * value that is NOT a discipline: `normalizeDiscipline` maps it to null, and
 * registration leaves `User.category` empty instead of declaring the tester a
 * "Ten Dance" (Latin + Standard) practitioner.
 */
export const BETA_LICENSE_PLACEHOLDER_CATEGORY = "Non renseignée";

/**
 * Category of a licence whose holder's discipline is unknown (#282). Same
 * value as the beta placeholder: not a discipline, so `normalizeDiscipline`
 * maps it to null and the licence card / Wallet pass fall back to the
 * holder's profile, or show it as "Non renseignée".
 */
export const LICENSE_CATEGORY_UNKNOWN = BETA_LICENSE_PLACEHOLDER_CATEGORY;

/**
 * Club name of a licence whose holder has no known club (#282): the column
 * is required, and a made-up club name ("Club") would be shown as real.
 */
export const LICENSE_CLUB_UNKNOWN = "Non renseigné";

/** Category the beta licences wrongly carried before #555. */
export const LEGACY_BETA_LICENSE_CATEGORY = "Ten Dance";

/** Club name of the licences auto-created under BETA_AUTO_LICENSE. */
export const BETA_AUTO_LICENSE_CLUB_NAME =
  "Club bêta-test (licence auto-créée)";
