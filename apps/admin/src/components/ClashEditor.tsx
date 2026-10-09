import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { type RefObject, useState } from 'react';
import {
  formatTimecode,
  MAX_CLASHES,
  parseTimecode,
  roundTenth,
  sortedUnique,
} from '../lib/moderation';

/** Lead-in before a clash when it is played, to hear it coming. */
export const CLASH_LEAD_IN_SECONDS = 3;

interface ClashEditorProps {
  value: number[];
  onChange: (next: number[]) => void;
  /** The page's `<audio>`: read for « Marquer ici », written to seek. */
  audioRef: RefObject<HTMLAudioElement | null>;
}

/** Paso doble clashes placed by ear: up to 3 chips in m:ss; an empty list means « no clash ». */
export function ClashEditor({ value, onChange, audioRef }: ClashEditorProps) {
  const [invalid, setInvalid] = useState<number | null>(null);
  const full = value.length >= MAX_CLASHES;

  const markHere = () => {
    const audio = audioRef.current;
    if (!audio || full) return;
    setInvalid(null);
    onChange(sortedUnique([...value, roundTenth(audio.currentTime)]));
  };

  const play = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds - CLASH_LEAD_IN_SECONDS);
    // Rejected when the browser blocks playback or the file is missing: the seek stays.
    void audio.play()?.catch(() => undefined);
  };

  const edit = (index: number, text: string) => {
    const seconds = parseTimecode(text);
    if (seconds === null) {
      setInvalid(index);
      return;
    }
    setInvalid(null);
    onChange(sortedUnique(value.map((v, i) => (i === index ? seconds : v))));
  };

  const remove = (index: number) => {
    setInvalid(null);
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        Clashes paso
      </Text>
      {value.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucun clash
        </Text>
      )}
      {value.map((seconds, index) => (
        <Group key={`${index}-${seconds}`} gap="xs" align="flex-start">
          <TextInput
            aria-label={`Clash ${index + 1}`}
            defaultValue={formatTimecode(seconds)}
            w={110}
            error={invalid === index ? 'Format m:ss' : undefined}
            onBlur={(e) => edit(index, e.currentTarget.value)}
          />
          <Button
            size="xs"
            variant="light"
            aria-label={`Écouter le clash ${index + 1}`}
            onClick={() => play(seconds)}
          >
            Écouter
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="red"
            aria-label={`Supprimer le clash ${index + 1}`}
            onClick={() => remove(index)}
          >
            Supprimer
          </Button>
        </Group>
      ))}
      <Group gap="xs">
        <Button size="xs" onClick={markHere} disabled={full}>
          Marquer ici
        </Button>
        {full && (
          <Text size="xs" c="dimmed">
            3 clashes au maximum
          </Text>
        )}
      </Group>
    </Stack>
  );
}
