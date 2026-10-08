import { createHash } from "crypto";

/**
 * SHA-256 (hex) of an opaque bearer token. Only this hash is persisted:
 * the plain token is handed out once and looked up by its hash afterwards.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
