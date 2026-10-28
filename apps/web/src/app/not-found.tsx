import Link from 'next/link';
import { Brand } from '@/components/brand';
export default function NotFound() {
  return (
    <main id="main" className="not-found">
      <Brand />
      <span className="eyebrow">404 / OUT OF ORBIT</span>
      <h1>Let’s find your way back.</h1>
      <p>This page doesn’t exist. Your next contribution might.</p>
      <Link className="button primary" href="/explore">
        Explore opportunities →
      </Link>
    </main>
  );
}
