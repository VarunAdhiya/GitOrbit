import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Brand, OrbitMark } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignIn } from '@/components/sign-in';
export const metadata: Metadata = { title: 'Sign in' };
export default function SignInPage() {
  return (
    <div className="sign-in-page">
      <header className="sign-in-header">
        <Brand />
        <ThemeToggle />
      </header>
      <main id="main" className="sign-in-main">
        <div className="sign-in-orbit" aria-hidden="true">
          <OrbitMark />
        </div>
        <Suspense fallback={<p>Loading sign-in…</p>}>
          <SignIn />
        </Suspense>
      </main>
      <footer className="sign-in-footer">A little code. A bigger impact.</footer>
    </div>
  );
}
