import { createHash, createPrivateKey, KeyObject } from "crypto";

/**
 * Deterministic Ed25519 test keys for the rotating entry QR (#24).
 *
 * Derived at runtime from a public label (seed = SHA-256 of the label), so no
 * private key material is committed. NOT for any real environment.
 */
const PKCS8_ED25519_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

export function testEntryQrPrivateKey(label: string): KeyObject {
  const seed = createHash("sha256").update(label).digest();
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

/** PKCS#8 PEM, as `ENTRY_QR_SIGNING_KEY` holds it. */
export function testEntryQrPem(label: string): string {
  return testEntryQrPrivateKey(label)
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

export const ACTIVE_TEST_KEY_LABEL = "ffd-entry-qr-test-vector-not-a-real-key";
export const RETIRED_TEST_KEY_LABEL = "ffd-entry-qr-test-vector-retired-key";

/**
 * Golden vector shared with the client verifier
 * (apps/client/src/features/license/utils/entryQr.test.ts): same key, same
 * subject, same step ⇒ same signature (Ed25519 is deterministic).
 */
export const ENTRY_QR_GOLDEN_VECTOR = {
  publicKey: "9-F1bePZBCVLj1_wx1vDM4oUqMIMXMz2xnV_qPPSWMU",
  keyId: "b3N-LHLYjEQ",
  subject: {
    licenseId: "3f0c6d2e-1111-4222-8333-944445555666",
    number: "FFD-123456",
    holderName: "DUPONT Jean",
  },
  step: 59612345,
  canonical:
    '["ffd-entry-qr",3,"b3N-LHLYjEQ","3f0c6d2e-1111-4222-8333-944445555666","FFD-123456","DUPONT Jean",59612345]',
  signature:
    "3h1jMAEGstTWD3uvtfG1NXqD0IR7dctIYDbx0B_lhnR4LbxgWl3h91Aurw1say6UvJav1q1iUT8TkHRukZERCg",
  retiredPublicKey: "sMDKGYEpvQ-_3PuqwoTxkhVLv3coXWonYT0LGAWzpfU",
} as const;
