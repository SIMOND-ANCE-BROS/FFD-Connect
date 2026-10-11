import {
  id3Frame,
  JPEG_BYTES,
  mp3Bytes,
  pictureFrame,
  textFrame,
  utf16Frame,
  utf8Frame,
} from '../test/id3Fixture';
import { readId3 } from './id3';

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

describe('readId3', () => {
  it('reads title, artist and genre of a track-prep tag (ID3v2.3, Latin-1), TBPM ignored', async () => {
    const tags = await readId3(
      blob(
        mp3Bytes([
          textFrame('TBPM', '42'),
          textFrame('TIT2', 'In the Mood'),
          textFrame('TPE1', 'Empress Orchestra'),
          textFrame('TCON', 'Jive'),
        ]),
      ),
    );
    expect(tags).toEqual({ title: 'In the Mood', artist: 'Empress Orchestra', genre: 'Jive' });
  });

  it('decodes UTF-16 with a BOM (v2.3) and UTF-8 (v2.4)', async () => {
    expect(await readId3(blob(mp3Bytes([utf16Frame('TIT2', 'España Cañí')])))).toEqual({
      title: 'España Cañí',
    });
    expect(await readId3(blob(mp3Bytes([utf8Frame('TPE1', 'Orquesta Española')], 4)))).toEqual({
      artist: 'Orquesta Española',
    });
  });

  it('keeps the first value of a multi-value v2.4 frame and strips a numeric genre', async () => {
    const tags = await readId3(
      blob(
        mp3Bytes(
          [
            utf8Frame('TPE1', 'A\u0000B'),
            id3Frame('TCON', [3, ...new TextEncoder().encode('(13)Samba')], 4),
          ],
          4,
        ),
      ),
    );
    expect(tags).toEqual({ artist: 'A', genre: 'Samba' });
  });

  it('reads the front cover, preferring it to another picture', async () => {
    const tags = await readId3(
      blob(
        mp3Bytes([
          pictureFrame('image/png', [1, 2, 3], 0),
          pictureFrame('image/jpeg', JPEG_BYTES, 3),
        ]),
      ),
    );
    expect(tags?.picture?.mime).toBe('image/jpeg');
    expect(tags?.picture?.type).toBe(3);
    expect(Array.from(tags?.picture?.data ?? [])).toEqual(JPEG_BYTES);
  });

  it('stops at the padding and skips unknown frames', async () => {
    const tags = await readId3(
      blob(mp3Bytes([textFrame('TXXX', 'x'), textFrame('TIT2', 'Titre')])),
    );
    expect(tags).toEqual({ title: 'Titre' });
  });

  it('skips an empty frame instead of stopping there', async () => {
    const tags = await readId3(blob(mp3Bytes([id3Frame('TPE1', []), textFrame('TIT2', 'Titre')])));
    expect(tags).toEqual({ title: 'Titre' });
  });

  it('reads a v2.4 tag whose frame sizes are plain integers (a common tagger bug)', async () => {
    const long = 'L'.repeat(200);
    // id3Frame defaults to the v2.3 (plain integer) size, here inside a v2.4 tag.
    const frames = [
      id3Frame('TIT2', [0, ...Array.from(long, (c) => c.charCodeAt(0))]),
      textFrame('TPE1', 'A'),
    ];
    expect(await readId3(blob(mp3Bytes(frames, 4)))).toEqual({ title: long, artist: 'A' });
  });

  it('answers null rather than failing when the file cannot be read', async () => {
    const unreadable = { slice: () => ({}) } as unknown as Blob;
    await expect(readId3(unreadable)).resolves.toBeNull();
  });

  it('answers null without a tag, for ID3v2.2, or for a tag over 4 MB', async () => {
    expect(await readId3(new Blob([Uint8Array.from([0xff, 0xfb, 0x90, 0x64])]))).toBeNull();
    const v22 = mp3Bytes([textFrame('TIT2', 'x')]);
    v22[3] = 2;
    expect(await readId3(blob(v22))).toBeNull();
    const huge = mp3Bytes([]);
    huge.set([0x02, 0x40, 0x00, 0x00], 6); // syncsafe 5 MB
    expect(await readId3(blob(huge))).toBeNull();
  });
});
