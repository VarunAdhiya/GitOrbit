'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type User = { id: string; name: string; email: string | null };
type Session = { user: User | null; configured: boolean };
const AuthContext = createContext<{ user: User | null; loading: boolean; error: string }>({
  user: null,
  loading: true,
  error: '',
});
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Session>('/auth/session', { signal: controller.signal })
      .then(setSession)
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Unable to check your sign-in. Please refresh to try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <AuthContext.Provider value={{ user: session?.user || null, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
