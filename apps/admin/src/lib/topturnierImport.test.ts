import {
  archiveSizeError,
  eventMappings,
  mappingSummary,
  MAX_TOPTURNIER_ARCHIVE_BYTES,
} from './topturnierImport';

const mapping = (status: string) => ({
  folder: `f-${status}`,
  label: 'Nat, Adults Avancé Latin',
  status,
  eventId: null,
  eventName: null,
  exact: null,
  rows: 1,
  message: null,
});

describe('topturnierImport', () => {
  it('checks the archive size', () => {
    expect(archiveSizeError({ size: MAX_TOPTURNIER_ARCHIVE_BYTES })).toBeNull();
    expect(archiveSizeError({ size: MAX_TOPTURNIER_ARCHIVE_BYTES + 1 })).toMatch(/10 Mo/);
  });

  it('reads the event mapping of a report or a refusal, ignoring anything else', () => {
    expect(eventMappings(null)).toEqual([]);
    expect(eventMappings('x')).toEqual([]);
    expect(eventMappings({ events: 'x' })).toEqual([]);
    expect(
      eventMappings({ events: [mapping('MATCHED'), mapping('WHAT'), { folder: 1 }, null] }),
    ).toEqual([mapping('MATCHED')]);
  });

  it('summarises the mapping', () => {
    expect(mappingSummary([mapping('MATCHED') as never])).toBe('1 épreuve importée sur 1');
    expect(
      mappingSummary([mapping('MATCHED'), mapping('MATCHED'), mapping('UNMATCHED')] as never),
    ).toBe('2 épreuves importées sur 3');
  });
});
