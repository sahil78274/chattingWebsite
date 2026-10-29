import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';

export function ThemeToggle({ variant = 'icon' }) {
  const { theme, setTheme } = useTheme();

  if (variant === 'segmented') {
    return (
      <div className="theme-switch" role="radiogroup" aria-label="Colour theme">
        <button
          type="button"
          role="radio"
          aria-checked={theme === 'dark'}
          className={theme === 'dark' ? 'is-active' : ''}
          onClick={() => setTheme('dark')}
        >
          <Moon size={14} aria-hidden />
          Dark
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={theme === 'light'}
          className={theme === 'light' ? 'is-active' : ''}
          onClick={() => setTheme('light')}
        >
          <Sun size={14} aria-hidden />
          Light
        </button>
      </div>
    );
  }

  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme(next)}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={theme === 'dark'}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export default ThemeToggle;
