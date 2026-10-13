/**
 * Masked form of an e-mail address for log lines (RGPD, #527): keeps the
 * first character of the local part and of the domain plus the top-level
 * domain, enough to tell two log lines apart, never enough to recover the
 * address. `jean.dupont@club-danse.fr` → `j***@c***.fr`.
 *
 * Use the user id instead whenever the caller has it; this is the fallback
 * for code that only knows the address.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 && dot < domain.length - 1 ? domain.slice(dot) : "";
  return `${local[0]}***@${domain[0]}***${tld}`;
}
