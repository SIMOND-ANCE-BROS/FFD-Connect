import { Alert, Linking } from "react-native";
import { createLogger } from "./logger";

const log = createLogger("externalUrl");

const WEB_SCHEME = /^https?:\/\//i;
const CONTACT_SCHEME = /^(mailto|tel):/i;
/** Any `scheme:` prefix — checked after the web/contact schemes above. */
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `host[:port]` of a web URL: dotted labels ending with a letter TLD. */
const HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?$/i;

export const UNUSABLE_LINK_MESSAGE =
  "Ce lien est invalide ou ne peut pas être ouvert sur cet appareil.";

/** Keeps a web URL only when its host looks real; encodes stray spaces. */
function normalizeWebUrl(url: string): string | undefined {
  const rest = url.replace(WEB_SCHEME, "");
  const host = rest.split(/[/?#]/, 1)[0];
  if (!HOST.test(host)) return undefined;
  const scheme = url.slice(0, url.length - rest.length).toLowerCase();
  return `${scheme}${rest.replace(/ /g, "%20")}`;
}

/**
 * Turns an external link coming from data (FFD import, club input…) into a
 * URL the OS can open, or `undefined` when it is unusable.
 *
 * - trims; empty → undefined
 * - `http(s)://…` kept (host must look real)
 * - `mailto:` / `tel:` kept
 * - `www.x.fr`, `x.fr/page`, `//x.fr` → `https://…` (Android cannot open a
 *   scheme-less URL: FFD-CLIENT-7, #583)
 * - anything else (other schemes, relative paths, free text) → undefined
 */
export function normalizeExternalUrl(raw?: string | null): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  if (WEB_SCHEME.test(value)) return normalizeWebUrl(value);
  if (CONTACT_SCHEME.test(value)) {
    return /^[a-z]+:\S+$/i.test(value) ? value : undefined;
  }
  if (OTHER_SCHEME.test(value)) return undefined;

  const withoutSlashes = value.replace(/^\/\//, "");
  if (/\s/.test(withoutSlashes.split(/[/?#]/, 1)[0])) return undefined;
  return normalizeWebUrl(`https://${withoutSlashes}`);
}

/**
 * Opens an external link from data. Never rejects: an unusable link or an OS
 * refusal ("No Activity found to handle Intent") shows a French alert instead
 * of an unhandled promise rejection. Resolves to whether the link was opened.
 */
export async function openExternalUrl(raw?: string | null): Promise<boolean> {
  const url = normalizeExternalUrl(raw);
  if (!url) {
    Alert.alert("Lien indisponible", UNUSABLE_LINK_MESSAGE);
    return false;
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch (error) {
    log.warn("Could not open external link", error, { url });
    Alert.alert("Lien indisponible", UNUSABLE_LINK_MESSAGE);
    return false;
  }
}
