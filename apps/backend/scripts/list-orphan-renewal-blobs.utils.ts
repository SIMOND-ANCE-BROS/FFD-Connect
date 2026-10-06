/**
 * Pure helpers for scripts/list-orphan-renewal-blobs.ts (kept separate so they
 * can be unit-tested without Azure or a database).
 */

/**
 * Renewal documents are uploaded through `FileInterceptor("document")` and
 * named by `generateBlobName` (src/utils/upload-storage.util.ts) as
 * `<fieldname>-<epochMs>-<random>.<ext>`, i.e. `document-1712345678901-123456789.jpg`.
 * The pattern is anchored and strict so that nothing else that may live in the
 * same container (track audio, covers, …) can ever match.
 */
const RENEWAL_BLOB_NAME = /^document-\d+-\d+(\.[A-Za-z0-9]+)?$/;

export function isRenewalDocumentBlobName(name: string): boolean {
  return RENEWAL_BLOB_NAME.test(name);
}

export interface BlobListing {
  name: string;
  lastModified?: Date;
}

/**
 * Returns the renewal-document blobs that no `LicenseRenewalDocument.filePath`
 * references. A reference matches either verbatim (current blob name) or by
 * its basename (legacy disk paths such as `uploads/renewal/<file>`) — erring
 * on the side of NOT reporting a blob as orphan.
 */
export function findOrphanRenewalBlobs(
  blobs: readonly BlobListing[],
  referencedFilePaths: Iterable<string>,
): BlobListing[] {
  const referenced = new Set<string>();
  for (const filePath of referencedFilePaths) {
    referenced.add(filePath);
    const basename = filePath.split(/[\\/]/).pop();
    if (basename) referenced.add(basename);
  }
  return blobs
    .filter((b) => isRenewalDocumentBlobName(b.name))
    .filter((b) => !referenced.has(b.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}
