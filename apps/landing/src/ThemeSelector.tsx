import { useTheme } from './ThemeContext';
import type { ThemePreference } from './ThemeContext';

const order: ThemePreference[] = ['system', 'light', 'dark'];

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {preference === 'system' && (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </>
      )}
      {preference === 'light' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </>
      )}
      {preference === 'dark' && (
        <>
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </>
      )}
    </svg>
  );
}

export function ThemeSelector() {
  const { preference, setPreference } = useTheme();

  const cycle = () => {
    const i = order.indexOf(preference);
    const next = order[(i + 1) % order.length];
    setPreference(next);
  };

  const labels: Record<ThemePreference, string> = {
    system: 'Thème système (auto)',
    light: 'Thème clair',
    dark: 'Thème sombre',
  };

  return (
    <button
      type="button"
      className="theme-icon-btn"
      onClick={cycle}
      title={labels[preference]}
      aria-label={labels[preference]}
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}
