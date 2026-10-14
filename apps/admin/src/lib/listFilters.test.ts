import {
  type ActiveFilter,
  describeFilter,
  type FilterSpecs,
  filtersQuery,
  isValidFilter,
  opsFor,
  readFilters,
  withFilter,
  writeFilters,
} from './listFilters';

const SPECS: FilterSpecs<'name' | 'login' | 'bpm' | 'role' | 'reason'> = {
  name: { label: 'Nom', kind: 'text' },
  login: { label: 'Connexion', kind: 'date', nullable: true },
  bpm: { label: 'MPM', kind: 'number' },
  role: {
    label: 'Rôle',
    kind: 'enum',
    options: [
      { value: 'CLUB', label: 'Club' },
      { value: 'ADMIN', label: 'Admin' },
    ],
  },
  reason: {
    label: 'Motif',
    kind: 'enum',
    nullable: true,
    options: [{ value: 'OTHER', label: 'Autre' }],
  },
};

const read = (query: string) => readFilters(new URLSearchParams(query), SPECS);

describe('operator filters (#557)', () => {
  it('offers the operators of the issue per kind, « est vide » only where a value can be missing', () => {
    expect(opsFor(SPECS.name)).toEqual([
      'contains',
      'notContains',
      'equals',
      'startsWith',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(opsFor(SPECS.login)).toEqual(['lt', 'gt', 'eq', 'between', 'isEmpty', 'isNotEmpty']);
    expect(opsFor(SPECS.bpm)).toEqual(['lt', 'gt', 'eq', 'between']);
    expect(opsFor(SPECS.role)).toEqual(['in', 'notIn']);
    expect(opsFor(SPECS.reason)).toEqual(['in', 'notIn', 'isEmpty']);
  });

  it.each<[string, ActiveFilter, boolean]>([
    ['a text', { field: 'name', op: 'contains', value: 'mar' }, true],
    ['a blank text', { field: 'name', op: 'contains', value: '  ' }, false],
    ['a too long text', { field: 'name', op: 'contains', value: 'x'.repeat(101) }, false],
    ['« est vide » without value', { field: 'name', op: 'isEmpty' }, true],
    ['« est vide » with a value', { field: 'name', op: 'isEmpty', value: 'x' }, false],
    ['a day', { field: 'login', op: 'lt', value: '2026-10-14' }, true],
    ['an impossible day', { field: 'login', op: 'lt', value: '2026-02-30' }, false],
    ['ordered days', { field: 'login', op: 'between', value: ['2026-01-01', '2026-01-31'] }, true],
    [
      'reversed days',
      { field: 'login', op: 'between', value: ['2026-02-01', '2026-01-31'] },
      false,
    ],
    ['a number', { field: 'bpm', op: 'gt', value: 30 }, true],
    ['NaN', { field: 'bpm', op: 'gt', value: Number.NaN }, false],
    ['a number range', { field: 'bpm', op: 'between', value: [28, 31] }, true],
    ['known values', { field: 'role', op: 'in', value: ['CLUB'] }, true],
    ['an unknown value', { field: 'role', op: 'in', value: ['ROOT'] }, false],
    ['no value', { field: 'role', op: 'in', value: [] }, false],
    ['an operator of another kind', { field: 'role', op: 'contains', value: 'x' }, false],
  ])('validates %s', (_label, filter, valid) => {
    const spec = SPECS[filter.field as keyof typeof SPECS];
    expect(isValidFilter(filter, spec)).toBe(valid);
  });

  describe('URL', () => {
    it('reads each kind back from `f.<field>=<op>[:<value>]`', () => {
      expect(
        read('f.name=startsWith:Du&f.login=isEmpty&f.bpm=between:28,31&f.role=notIn:CLUB,ADMIN'),
      ).toEqual([
        { field: 'name', op: 'startsWith', value: 'Du' },
        { field: 'login', op: 'isEmpty' },
        { field: 'bpm', op: 'between', value: [28, 31] },
        { field: 'role', op: 'notIn', value: ['CLUB', 'ADMIN'] },
      ]);
    });

    it('drops unknown fields, operators, missing or extra values and empty numbers', () => {
      expect(
        read(
          'f.password=isEmpty&f.name=regex:x&f.name=contains&f.login=isEmpty:x&f.bpm=gt:&f.bpm=between:28,',
        ),
      ).toEqual([]);
      // The first valid value of a field wins.
      expect(read('f.name=contains:a&f.name=contains:b')).toEqual([
        { field: 'name', op: 'contains', value: 'a' },
      ]);
    });

    it('writes what it reads', () => {
      const filters: ActiveFilter[] = [
        { field: 'name', op: 'notContains', value: 'a,b' },
        { field: 'reason', op: 'isEmpty' },
        { field: 'login', op: 'between', value: ['2026-01-01', '2026-01-31'] },
      ];
      const params = new URLSearchParams();
      writeFilters(params, filters);
      expect(readFilters(params, SPECS)).toEqual(filters);
    });
  });

  it('sends the JSON array the API expects, nothing without filter', () => {
    expect(filtersQuery([])).toEqual({});
    expect(
      filtersQuery([
        { field: 'name', op: 'isEmpty' },
        { field: 'bpm', op: 'lt', value: 30 },
      ]),
    ).toEqual({
      filters: '[{"field":"name","op":"isEmpty"},{"field":"bpm","op":"lt","value":30}]',
    });
  });

  it('replaces or removes the filter of one field', () => {
    const filters: ActiveFilter<'name' | 'bpm'>[] = [
      { field: 'name', op: 'contains', value: 'a' },
      { field: 'bpm', op: 'gt', value: 1 },
    ];
    expect(withFilter(filters, 'name', { field: 'name', op: 'isEmpty' })).toEqual([
      { field: 'bpm', op: 'gt', value: 1 },
      { field: 'name', op: 'isEmpty' },
    ]);
    expect(withFilter(filters, 'bpm', null)).toEqual([
      { field: 'name', op: 'contains', value: 'a' },
    ]);
  });

  it('describes a filter in French for its chip', () => {
    expect(describeFilter({ field: 'name', op: 'contains', value: 'mar' }, SPECS.name)).toBe(
      'Nom contient « mar »',
    );
    expect(describeFilter({ field: 'login', op: 'isEmpty' }, SPECS.login)).toBe(
      'Connexion est vide',
    );
    expect(
      describeFilter(
        { field: 'login', op: 'between', value: ['2026-01-01', '2026-01-31'] },
        SPECS.login,
      ),
    ).toBe('Connexion entre 01/01/2026 et 31/01/2026');
    expect(describeFilter({ field: 'bpm', op: 'lt', value: 30 }, SPECS.bpm)).toBe(
      'MPM inférieur à 30',
    );
    expect(
      describeFilter({ field: 'role', op: 'notIn', value: ['CLUB', 'ADMIN'] }, SPECS.role),
    ).toBe("Rôle n'est aucune de Club, Admin");
  });
});
