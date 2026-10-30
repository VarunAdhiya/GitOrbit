'use client';
import Link from 'next/link';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from './auth-provider';
import { api } from '@/lib/api';

export function AccountControl() {
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/sign-out', { method: 'POST' });
      window.location.assign('/');
    } catch {
      setError('Unable to sign out. Please try again.');
      setBusy(false);
    }
  }
  if (loading) return <span className="account-loading" aria-label="Checking sign-in" />;
  if (!user)
    return (
      <Link href="/sign-in" className="button secondary small">
        Sign in
      </Link>
    );
  return (
    <div className="account-control">
      <Link href="/resume" className="account-link" title={user.name}>
        <span className="account-avatar" aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{user.name}</span>
      </Link>
      <button
        className="theme-toggle"
        disabled={busy}
        onClick={signOut}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={17} />
      </button>
      {error && (
        <span className="account-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
