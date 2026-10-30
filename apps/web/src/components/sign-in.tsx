'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from './auth-provider';

export function SignIn() {
  const params = useSearchParams();
  const { user, loading, error: sessionError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ url: string }>('/auth/google', { method: 'POST' });
      window.location.assign(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in. Please try again.');
      setBusy(false);
    }
  }
  const message =
    error ||
    (params.has('error')
      ? 'Google sign-in was cancelled or could not be completed. Please try again.'
      : sessionError);
  return (
    <section className="sign-in-card">
      <div className="sign-in-symbol">
        <ShieldCheck size={26} />
      </div>
      <span className="eyebrow">YOUR PLACE IN OPEN SOURCE</span>
      <h1>{user ? 'Welcome back.' : 'Keep your next\nchapter in orbit.'}</h1>
      <p>
        {user
          ? `You’re signed in as ${user.email || user.name}. Your profile is ready whenever you are.`
          : 'Sign in to save your skills and return to opportunities that fit you.'}
      </p>
      {message && (
        <div className="alert error" role="alert">
          {message}
        </div>
      )}
      {user ? (
        <Link href="/resume" className="button primary sign-in-button">
          Go to your profile <ArrowRight size={17} />
        </Link>
      ) : (
        <>
          <button
            className="button google-button sign-in-button"
            onClick={signIn}
            disabled={busy || loading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.23c1.89-1.74 2.99-4.3 2.99-7.36Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59C7.19 7.72 9.4 5.96 12 5.96Z"
              />
            </svg>
            {busy ? 'Connecting to Google…' : 'Continue with Google'}
          </button>
          <div className="sign-in-benefits">
            <span>
              <Check size={15} /> Keep your profile across visits
            </span>
            <span>
              <Check size={15} /> Upload a resume or add skills manually
            </span>
            <span>
              <Check size={15} /> Delete your profile whenever you want
            </span>
          </div>
          <p className="sign-in-privacy">
            We only use your basic Google profile to sign you in. Your resume stays private, and raw
            files are never stored.
          </p>
        </>
      )}
      <Link href="/explore" className="sign-in-guest">
        {user ? 'Explore opportunities' : 'Continue as a guest'} <ArrowRight size={15} />
      </Link>
    </section>
  );
}
