import { droppedFiles, readText, sha256Hex } from './files';

const file = (name: string, text = name) => new File([text], name);

const fileEntry = (f: File) => ({
  isFile: true,
  isDirectory: false,
  file: (ok: (value: File) => void) => ok(f),
});

/** A directory whose reader answers in two batches, then an empty one (as browsers do). */
const dirEntry = (children: unknown[]) => {
  const batches = [children.slice(0, 1), children.slice(1), []];
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (ok: (entries: unknown[]) => void) => ok(batches.shift() ?? []),
    }),
  };
};

describe('file helpers', () => {
  it('hashes a file with SHA-256, lowercase hex', async () => {
    await expect(sha256Hex(new Blob(['abc']))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('reads a text file', async () => {
    await expect(readText(new Blob(['{"version":1}']))).resolves.toBe('{"version":1}');
  });

  it('collects the files of a dropped folder, sub-folders included', async () => {
    const a = file('01.mp3');
    const b = file('01.jpg');
    const c = file('manifest.json');
    const transfer = {
      items: [
        {
          webkitGetAsEntry: () => dirEntry([fileEntry(a), dirEntry([fileEntry(b)]), fileEntry(c)]),
        },
      ],
      files: [],
    } as unknown as DataTransfer;
    await expect(droppedFiles(transfer)).resolves.toEqual([a, b, c]);
  });

  it('falls back to the plain file list without entries', async () => {
    const a = file('a.mp3');
    const transfer = { items: [], files: [a] } as unknown as DataTransfer;
    await expect(droppedFiles(transfer)).resolves.toEqual([a]);
  });
});
