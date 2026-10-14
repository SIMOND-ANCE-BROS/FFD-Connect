const WEB_SCHEME = /^https?:\/\//i;
/** `host[:port]` of a web URL: dotted labels ending with a letter TLD. */
const HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?$/i;

/**
 * Normalizes a free-text web link from an external source (FFD
 * `communicationLink`) so every client can open it: trims, adds `https://`
 * when the scheme is missing (`www.club.fr` cannot be opened on Android,
 * FFD-CLIENT-7 / #583), and returns `null` for empty values or text that is
 * not a web link (another scheme, a relative path, a sentence).
 */
export function normalizeExternalWebUrl(
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  let url: string;
  if (WEB_SCHEME.test(value)) {
    url = value;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return null;
  } else {
    url = `https://${value.replace(/^\/\//, "")}`;
  }

  const rest = url.replace(WEB_SCHEME, "");
  const host = rest.split(/[/?#]/, 1)[0];
  if (!HOST.test(host)) return null;
  const scheme = url.slice(0, url.length - rest.length).toLowerCase();
  return `${scheme}${rest.replace(/ /g, "%20")}`;
}
