'use client';
import { ErrorState } from '@/components/states';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main">
      <ErrorState message="Something interrupted this page. Please try again." retry={reset} />
    </main>
  );
}
