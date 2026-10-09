import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { vi } from 'vitest';
import { ClashEditor } from './ClashEditor';

function Harness({ initial }: { initial: number[] }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [value, setValue] = useState(initial);
  return (
    <MantineProvider>
      <audio ref={ref} data-testid="audio" />
      <ClashEditor value={value} onChange={setValue} audioRef={ref} />
      <p data-testid="value">{JSON.stringify(value)}</p>
    </MantineProvider>
  );
}

const setTime = (seconds: number) =>
  Object.defineProperty(screen.getByTestId('audio'), 'currentTime', {
    configurable: true,
    writable: true,
    value: seconds,
  });

const value = () => screen.getByTestId('value').textContent;

describe('ClashEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the player time, rounded to 0.1 s, keeping the chips sorted', async () => {
    render(<Harness initial={[90]} />);
    setTime(83.46);
    await userEvent.click(screen.getByRole('button', { name: 'Marquer ici' }));
    expect(value()).toBe('[83.5,90]');
    expect(screen.getByLabelText('Clash 1')).toHaveValue('1:23.5');
    expect(screen.getByLabelText('Clash 2')).toHaveValue('1:30');
  });

  it('refuses a 4th clash', async () => {
    render(<Harness initial={[10, 20, 30]} />);
    const mark = screen.getByRole('button', { name: 'Marquer ici' });
    expect(mark).toBeDisabled();
    expect(screen.getByText('3 clashes au maximum')).toBeInTheDocument();
    setTime(50);
    await userEvent.click(mark);
    expect(value()).toBe('[10,20,30]');
  });

  it('edits a chip in m:ss and flags an invalid one', async () => {
    render(<Harness initial={[40, 80]} />);
    const first = screen.getByLabelText('Clash 1');
    await userEvent.clear(first);
    await userEvent.type(first, '1:45');
    await userEvent.tab();
    expect(value()).toBe('[80,105]');
    const again = screen.getByLabelText('Clash 1');
    await userEvent.clear(again);
    await userEvent.type(again, 'abc');
    await userEvent.tab();
    expect(screen.getByText('Format m:ss')).toBeInTheDocument();
    expect(value()).toBe('[80,105]');
  });

  it('removes chips down to an empty list (« no clash »)', async () => {
    render(<Harness initial={[40]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer le clash 1' }));
    expect(value()).toBe('[]');
    expect(screen.getByText('Aucun clash')).toBeInTheDocument();
  });

  it('plays a chip from 3 s before it, never before 0', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<Harness initial={[2, 40]} />);
    setTime(0);
    await userEvent.click(screen.getByRole('button', { name: 'Écouter le clash 2' }));
    expect((screen.getByTestId('audio') as HTMLAudioElement).currentTime).toBe(37);
    await userEvent.click(screen.getByRole('button', { name: 'Écouter le clash 1' }));
    expect((screen.getByTestId('audio') as HTMLAudioElement).currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
