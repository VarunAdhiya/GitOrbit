'use client';
import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

function subscribe(callback: () => void) {
  const sync = () => {
    try {
      document.documentElement.dataset.theme =
        localStorage.getItem('gitorbit-theme') === 'light' ? 'light' : 'dark';
    } catch {
      /* Storage can be disabled. */
    }
    callback();
  };
  window.addEventListener('storage', sync);
  window.addEventListener('gitorbit-theme', callback);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener('gitorbit-theme', callback);
  };
}
export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme || 'dark',
    () => 'dark',
  );
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('gitorbit-theme', next);
    } catch {
      /* Keep the in-memory preference. */
    }
    window.dispatchEvent(new Event('gitorbit-theme'));
  }
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
