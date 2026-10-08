import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * TEST ONLY — throwaway self-signed certificates generated on the fly with
 * the `openssl` CLI, so no key material is ever committed. They let the tests
 * run the real PKCS#7 signature of passkit-generator; Wallet would of course
 * reject them (not issued by Apple).
 */
export interface TestPassCertificates {
  signerCert: string;
  signerKey: string;
  wwdr: string;
  /** A valid key that does NOT match `signerCert`. */
  otherKey: string;
  /** `signerKey` encrypted with a passphrase. */
  encryptedKey: string;
}

let cached: TestPassCertificates | null = null;

function openssl(args: string[]): void {
  execFileSync("openssl", args, { stdio: "ignore" });
}

export function createTestPassCertificates(): TestPassCertificates {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "ffd-wallet-test-"));
  const file = (name: string) => join(dir, name);
  try {
    const selfSigned = (key: string, cert: string, subject: string) =>
      openssl([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        file(key),
        "-out",
        file(cert),
        "-days",
        "2",
        "-subj",
        subject,
      ]);
    selfSigned("signer.key", "signer.pem", "/CN=Test Pass Signer/O=Test");
    selfSigned("wwdr.key", "wwdr.pem", "/CN=Test WWDR/O=Test");
    openssl([
      "pkey",
      "-in",
      file("signer.key"),
      "-aes256",
      "-passout",
      "pass:test-only",
      "-out",
      file("signer-encrypted.key"),
    ]);
    cached = {
      signerCert: readFileSync(file("signer.pem"), "utf8"),
      signerKey: readFileSync(file("signer.key"), "utf8"),
      wwdr: readFileSync(file("wwdr.pem"), "utf8"),
      otherKey: readFileSync(file("wwdr.key"), "utf8"),
      encryptedKey: readFileSync(file("signer-encrypted.key"), "utf8"),
    };
    return cached;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Reads the entries of a `.pkpass` produced by passkit-generator, which
 * writes STORED (uncompressed) zip entries with sizes in the local headers.
 */
export function readPkpassEntries(zip: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {};
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    if (method !== 0) throw new Error("Unexpected compressed zip entry");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString();
    entries[name] = zip.subarray(dataStart, dataStart + size);
    offset = dataStart + size;
  }
  return entries;
}

/** Fake identifiers in the expected formats (not real Apple identifiers). */
export const TEST_PASS_TYPE_ID = "pass.org.example.test.license";
export const TEST_TEAM_ID = "TEST000000";

/** Environment for a fully configured Apple Wallet feature. */
export function testAppleWalletEnv(
  certs: TestPassCertificates = createTestPassCertificates(),
): Record<string, string> {
  return {
    WALLET_APPLE_PASS_CERT: certs.signerCert,
    WALLET_APPLE_PASS_KEY: certs.signerKey,
    WALLET_APPLE_WWDR_CERT: certs.wwdr,
    WALLET_APPLE_PASS_TYPE_ID: TEST_PASS_TYPE_ID,
    WALLET_APPLE_TEAM_ID: TEST_TEAM_ID,
  };
}
