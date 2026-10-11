/**
 * Upper bound of the administrators read to be notified of a moderation
 * event (track correction, licence renewal to review). Shared so that every
 * admin fan-out stays bounded the same way.
 */
export const MAX_ADMINS_NOTIFIED = 100;
