/**
 * Placeholders of the licences created for beta testers on staging (#555):
 * pre-seeded by `scripts/seed-beta-testers.ts` or auto-created at registration
 * under BETA_AUTO_LICENSE. Their discipline is unknown, so the category is a
 * value that is NOT a discipline: `normalizeDiscipline` maps it to null, and
 * registration leaves `User.category` empty instead of declaring the tester a
 * "Ten Dance" (Latin + Standard) practitioner.
 */
export const BETA_LICENSE_PLACEHOLDER_CATEGORY = "Non renseignée";

/** Category the beta licences wrongly carried before #555. */
export const LEGACY_BETA_LICENSE_CATEGORY = "Ten Dance";

/** Club name of the licences auto-created under BETA_AUTO_LICENSE. */
export const BETA_AUTO_LICENSE_CLUB_NAME =
  "Club bêta-test (licence auto-créée)";
