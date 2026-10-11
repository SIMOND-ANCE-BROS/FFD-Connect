/**
 * Bytes of a Blob. FileReader rather than Blob.arrayBuffer(): same result in
 * browsers, and jsdom (the test environment) has no Blob.arrayBuffer().
 */
export function readBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible'));
    reader.readAsArrayBuffer(blob);
  });
}

export function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible'));
    reader.readAsText(blob);
  });
}

/** SHA-256 of a file, lowercase hex: the server recomputes it and refuses a mismatch. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await readBytes(blob));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function entryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await entryFile(entry as FileSystemFileEntry)];
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries answers in batches (100 in Chromium): read until empty.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested: File[] = [];
  for (const child of children) nested.push(...(await entryFiles(child)));
  return nested;
}

/** Files of a drop, dropped folders (and their sub-folders) included. */
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items ?? [])
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return Array.from(transfer.files);
  const files: File[] = [];
  for (const entry of entries) files.push(...(await entryFiles(entry)));
  return files;
}
