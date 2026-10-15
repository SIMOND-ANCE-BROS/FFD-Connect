import { Button, Group, Modal, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { apiErrorMessage } from '../lib/apiError';

export interface InlineEditConfirm {
  title: string;
  body: ReactNode;
  confirmLabel: string;
}

interface Props {
  /** Visible label, also the input's label ("Email", "Licence"). */
  label: string;
  /** Current value, the starting point of the edit. */
  value: string;
  /** What is shown outside of editing (defaults to `value`). */
  display?: ReactNode;
  /** Accessible name of the value when it can be edited ("Modifier l'email"). */
  editLabel: string;
  editable: boolean;
  /** Error message for a draft, or null when it can be saved. */
  validate: (draft: string) => string | null;
  /** True when saving the draft would change nothing (no server call then). */
  isUnchanged: (draft: string) => boolean;
  /** Shown under the input while the draft differs from the value. */
  changeWarning?: ReactNode;
  /** A changed value is saved only after this confirmation. */
  confirm?: InlineEditConfirm;
  /** Saves the draft; a rejection keeps the field in edition with its message. */
  onSave: (draft: string) => Promise<unknown>;
}

function PencilIcon() {
  return (
    <svg
      className="app-inline-edit-pencil"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/**
 * A value of a record page edited in place (#672): a click (or Enter) on the
 * value turns it into a field, Enter or « Enregistrer » saves, Escape or
 * « Annuler » restores it without calling the server. Errors stay under the
 * field, which remains in edition.
 */
export function InlineEditField({
  label,
  value,
  display,
  editLabel,
  editable,
  validate,
  isUnchanged,
  changeWarning,
  confirm,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const shown = display ?? value;

  if (!editable || !editing) {
    return (
      <Text size="sm" component="div">
        {label} :{' '}
        {editable ? (
          <UnstyledButton
            className="app-inline-edit"
            aria-label={`${editLabel} (${value || 'vide'})`}
            title="Cliquer pour modifier"
            onClick={() => {
              setDraft(value);
              setError(null);
              setEditing(true);
            }}
          >
            {shown}
            <PencilIcon />
          </UnstyledButton>
        ) : (
          shown
        )}
      </Text>
    );
  }

  const cancel = () => {
    setEditing(false);
    setConfirming(false);
    setError(null);
    setDraft(value);
  };

  const save = async () => {
    setConfirming(false);
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(apiErrorMessage(e, "Échec de l'enregistrement"));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (saving) return;
    const invalid = validate(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (isUnchanged(draft)) {
      cancel();
      return;
    }
    if (confirm) setConfirming(true);
    else void save();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  const changed = !isUnchanged(draft);

  return (
    <Stack gap={6}>
      <TextInput
        size="xs"
        label={label}
        value={draft}
        // The admin just asked to edit this value.
        autoFocus
        error={error}
        disabled={saving}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {changed && changeWarning}
      {/* Named after the field: the page has its own « Enregistrer » below. */}
      <Group gap="xs">
        <Button size="xs" loading={saving} onClick={submit} aria-label={`Enregistrer (${label})`}>
          Enregistrer
        </Button>
        <Button
          size="xs"
          variant="default"
          disabled={saving}
          onClick={cancel}
          aria-label={`Annuler (${label})`}
        >
          Annuler
        </Button>
      </Group>
      {confirm && (
        <Modal opened={confirming} onClose={() => setConfirming(false)} title={confirm.title}>
          <Stack>
            {confirm.body}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirming(false)}>
                Retour
              </Button>
              <Button onClick={() => void save()}>{confirm.confirmLabel}</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
