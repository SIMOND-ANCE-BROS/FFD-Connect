/**
 * Version of the privacy policy announced in the app (#734).
 *
 * DISTINCT from the CGU version (`CGU_VERSION` client-side,
 * `PARENTAL_CONSENT_CGU_VERSION` here): this one is INFORMATION, not consent.
 * Bumping it shows each signed-in user a non-blocking notice once, with a link
 * to the policy; it never asks anyone to accept anything again and never
 * touches the proof of a parent's agreement.
 *
 * When to bump it — a SUBSTANTIAL change (policy §11): a new category of data
 * or purpose, a new processor or recipient, a longer retention period, a new
 * transfer outside the EU, a change to how rights are exercised or to what the
 * GDPR export contains. Not for wording, typos or layout. Procedure:
 * docs/exploitation/politique-confidentialite-versions.md.
 *
 * Format: the policy's "last updated" date (YYYY-MM-DD) of the announced
 * version. 2026-10-17: export contents and support access (#387, #733,
 * #759, #760).
 */
export const PRIVACY_POLICY_VERSION = "2026-10-17";

/** Shape accepted for a version in an acknowledgement. */
export const PRIVACY_POLICY_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
