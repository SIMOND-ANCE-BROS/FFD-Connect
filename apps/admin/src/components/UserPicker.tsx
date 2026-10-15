import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { usersQuery } from '../api/queries';

/** Same minimum as the users list search. */
const MIN_SEARCH = 2;
const RESULTS = 10;

interface UserPickerProps {
  label: string;
  /** Selected user id, or none. */
  value: string | undefined;
  /** Name of the selected user, shown while no search is typed. */
  valueLabel?: string;
  onChange: (id: string | undefined) => void;
}

/**
 * Picks one account by name or e-mail, searched on the server (the users
 * list), for a filter whose API takes a user id (#606). Kept inside the
 * header menu: a portal would count as a click outside and close it.
 */
export function UserPicker({ label, value, valueLabel, onChange }: UserPickerProps) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(search.trim(), 300);
  // Once an account is picked, the input shows its label: not a new search.
  const enabled = debounced.length >= MIN_SEARCH && debounced !== picked;
  const found = useQuery({
    ...usersQuery({ search: debounced, take: RESULTS }),
    enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const options = (enabled ? (found.data?.data ?? []) : []).map((u) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName} (${u.email})`,
  }));
  // The current value stays selectable even when the search no longer lists it.
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: valueLabel ?? value });
  }
  return (
    <Select
      label={label}
      placeholder="Nom ou email"
      searchable
      clearable
      data={options}
      value={value ?? null}
      searchValue={search}
      onSearchChange={setSearch}
      // The server already filtered: do not filter again on the label.
      filter={({ options: all }) => all}
      nothingFoundMessage={enabled ? 'Aucun compte' : `${MIN_SEARCH} caractères au moins`}
      comboboxProps={{ withinPortal: false }}
      onChange={(id, option) => {
        setPicked(option?.label ?? null);
        onChange(id ?? undefined);
      }}
    />
  );
}
