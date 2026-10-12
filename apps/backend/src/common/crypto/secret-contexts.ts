/**
 * AAD contexts of the secrets encrypted at rest (#389). Changing a context
 * makes every value written with it undecryptable: never change one, add a
 * new one instead.
 */

/** Club HelloAsso client secret (`Club.helloAssoClientSecret`). */
export function clubHelloAssoSecretContext(clubId: string): string {
  return `club:${clubId}:helloAssoClientSecret`;
}
