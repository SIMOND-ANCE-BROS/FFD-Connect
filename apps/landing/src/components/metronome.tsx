import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Play, Square } from 'lucide-react';
export function Metronome() {
  const [tempo, setTempo] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const alive = useRef(true);

  async function toggleAudio() {
    if (playing) {
      setPlaying(false);
      return;
    }
    setStarting(true);
    try {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) throw new Error();
      if (!audio.current || audio.current.state === 'closed') audio.current = new AudioCtor();
      await audio.current.resume();
      if (alive.current) {
        setAudioError(false);
        setPlaying(true);
      }
    } catch {
      if (alive.current) setAudioError(true);
    } finally {
      if (alive.current) setStarting(false);
    }
  }

  useEffect(() => {
    if (!playing || !audio.current) return;
    const ctx = audio.current;
    let next = ctx.currentTime;
    const scheduled: OscillatorNode[] = [];
    const schedule = () => {
      while (next < ctx.currentTime + 0.08) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.1, next);
        gain.gain.exponentialRampToValueAtTime(0.001, next + 0.06);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(next);
        oscillator.stop(next + 0.065);
        scheduled.push(oscillator);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          const index = scheduled.indexOf(oscillator);
          if (index !== -1) scheduled.splice(index, 1);
        };
        next += 60 / tempo;
      }
    };
    schedule();
    const timer = window.setInterval(schedule, 25);
    return () => {
      window.clearInterval(timer);
      scheduled.forEach((oscillator) => {
        try {
          oscillator.stop();
        } catch {
          /* The audio context may already be closed. */
        }
      });
    };
  }, [playing, tempo]);

  useEffect(() => {
    alive.current = true;
    function pauseWhenHidden() {
      if (document.hidden) setPlaying(false);
    }
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      void audio.current?.close();
    };
  }, []);

  return (
    <div className="metronome-demo">
      {' '}
      <div
        className={'app-audio ' + (playing ? 'is-playing' : '')}
        style={{ '--beat-duration': 60 / tempo + 's' } as React.CSSProperties}
      >
        <div className="audio-bars" aria-hidden="true">
          {Array.from({ length: 19 }, (_, i) => (
            <span
              key={i}
              style={
                {
                  '--bar-size': 24 + Math.sin(i * 1.7) * 14 + (i % 3) * 9 + 'px',
                  '--bar-delay': i * 0.02 + 's',
                } as React.CSSProperties
              }
            />
          ))}
        </div>
        <h4>Métronome</h4>
        <div className="audio-tempo">
          <button
            type="button"
            aria-label="Diminuer le tempo"
            disabled={tempo <= 60}
            onClick={() => setTempo((value) => Math.max(60, value - 5))}
          >
            <Minus size={18} />
          </button>
          <div>
            <output aria-live="polite" aria-label="Tempo en battements par minute">
              {tempo}
            </output>
            <span>BPM</span>
          </div>
          <button
            type="button"
            aria-label="Augmenter le tempo"
            disabled={tempo >= 180}
            onClick={() => setTempo((value) => Math.min(180, value + 5))}
          >
            <Plus size={18} />
          </button>
        </div>
        <button
          type="button"
          className="audio-play"
          aria-pressed={playing}
          disabled={starting}
          onClick={toggleAudio}
        >
          {playing ? <Square size={16} /> : <Play size={16} />}
          {starting ? 'Activation…' : playing ? 'Arrêter' : 'Écouter le tempo'}
        </button>
      </div>
      <p className="app-disclaimer" role={audioError ? 'status' : undefined}>
        {audioError
          ? 'L’audio n’est pas disponible sur ce navigateur.'
          : 'Démo sonore · Bibliothèque musicale non connectée.'}
      </p>
    </div>
  );
}
