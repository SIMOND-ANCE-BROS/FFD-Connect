import {
  type ActiveFilter,
  describeFilter,
  type FilterSpecs,
  filtersQuery,
  isValidFilter,
  MAX_FIELD_CONDITIONS,
  MAX_FILTERS,
  opsFor,
  readFilters,
  withFieldFilters,
  withoutCondition,
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
    });

    it('reads several conditions of one column, joined by AND unless `j.<field>=or` (#673)', () => {
      expect(read('f.name=contains:a&f.bpm=gt:30&f.name=notContains:b')).toEqual([
        { field: 'name', op: 'contains', value: 'a' },
        { field: 'name', op: 'notContains', value: 'b' },
        { field: 'bpm', op: 'gt', value: 30 },
      ]);
      expect(read('f.name=contains:a&f.name=contains:b&j.name=or&j.bpm=or&f.bpm=gt:1')).toEqual([
        { field: 'name', op: 'contains', value: 'a', join: 'or' },
        { field: 'name', op: 'contains', value: 'b', join: 'or' },
        // A single condition has nothing to join.
        { field: 'bpm', op: 'gt', value: 1 },
      ]);
    });

    it('keeps the API bounds: conditions per column and in total (#673)', () => {
      const many = (field: string, count: number) =>
        Array.from({ length: count }, (_, i) => `f.${field}=contains:v${i}`).join('&');
      expect(read(many('name', MAX_FIELD_CONDITIONS + 2))).toHaveLength(MAX_FIELD_CONDITIONS);
      const bpm = Array.from({ length: 5 }, (_, i) => `f.bpm=gt:${i}`).join('&');
      const role = Array.from({ length: 5 }, () => 'f.role=in:CLUB').join('&');
      expect(read([many('name', 5), bpm, role].join('&'))).toHaveLength(MAX_FILTERS);
    });

    it('writes what it reads', () => {
      const filters: ActiveFilter[] = [
        { field: 'name', op: 'notContains', value: 'a,b', join: 'or' },
        { field: 'name', op: 'isEmpty', join: 'or' },
        { field: 'reason', op: 'isEmpty' },
        { field: 'login', op: 'between', value: ['2026-01-01', '2026-01-31'] },
        { field: 'login', op: 'isEmpty' },
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
    expect(
      JSON.parse(
        filtersQuery([
          { field: 'name', op: 'contains', value: 'gmail', join: 'or' },
          { field: 'bpm', op: 'lt', value: 30 },
          { field: 'name', op: 'contains', value: 'hotmail', join: 'or' },
        ]).filters ?? '',
      ),
    ).toEqual([
      { field: 'name', op: 'contains', value: 'gmail', join: 'or' },
      { field: 'name', op: 'contains', value: 'hotmail', join: 'or' },
      { field: 'bpm', op: 'lt', value: 30 },
    ]);
  });

  it('replaces or removes the conditions of one field', () => {
    const filters: ActiveFilter<'name' | 'bpm'>[] = [
      { field: 'name', op: 'contains', value: 'a' },
      { field: 'bpm', op: 'gt', value: 1 },
    ];
    expect(
      withFieldFilters(filters, 'name', [
        { field: 'name', op: 'isEmpty', join: 'or' },
        { field: 'name', op: 'contains', value: 'b', join: 'or' },
      ]),
    ).toEqual([
      { field: 'bpm', op: 'gt', value: 1 },
      { field: 'name', op: 'isEmpty', join: 'or' },
      { field: 'name', op: 'contains', value: 'b', join: 'or' },
    ]);
    expect(withFieldFilters(filters, 'bpm', [])).toEqual([
      { field: 'name', op: 'contains', value: 'a' },
    ]);
  });

  it('removes one condition, the join going with the last but one (#673)', () => {
    const filters: ActiveFilter<'name' | 'bpm'>[] = [
      { field: 'name', op: 'contains', value: 'a', join: 'or' },
      { field: 'name', op: 'contains', value: 'b', join: 'or' },
      { field: 'bpm', op: 'gt', value: 1 },
    ];
    expect(withoutCondition(filters, 0)).toEqual([
      { field: 'name', op: 'contains', value: 'b' },
      { field: 'bpm', op: 'gt', value: 1 },
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
