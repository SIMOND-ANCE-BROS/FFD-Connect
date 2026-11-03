/**
 * Version of the CGU in force (#424, #894). Must equal the client's
 * `CGU_VERSION` (apps/client/src/features/legal/cguConsent.ts): the app shows
 * its own copy of the text and sends that version when the user accepts.
 *
 * v2 (#270): a person checks the medical certificate (CGU §5).
 * v3 (#61): minors' accounts opened with a legal guardian's consent (CGU §6).
 *
 * Bumping it asks every account to accept again (the stored version no longer
 * matches) and changes the version a parent accepts for a minor.
 */
export const CGU_VERSION = "3";

/** Shape accepted for a version in an acceptance. */
export const CGU_VERSION_PATTERN = /^\d{1,4}$/;
