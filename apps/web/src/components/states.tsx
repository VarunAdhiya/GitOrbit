import Link from 'next/link';
import { ArrowRight, Compass, RefreshCw, TriangleAlert } from 'lucide-react';
export function LoadingState({ label = 'Finding your next contribution…' }: { label?: string }) {
  return (
    <div role="status" className="loading-state">
      <span className="loader" />
      <p>{label}</p>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton short" />
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <span className="empty-icon">
        <TriangleAlert size={27} />
      </span>
      <h2>We couldn’t load this just yet.</h2>
      <p>{message}</p>
      {retry ? (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={16} /> Try again
        </button>
      ) : (
        <Link href="/explore" className="button secondary">
          Back to explore <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function EmptyState({ filtered, reset }: { filtered: boolean; reset: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Compass size={30} />
      </span>
      <span className="eyebrow">ROOM FOR DISCOVERY</span>
      <h2>
        {filtered
          ? 'A different search could be the start.'
          : 'The next opportunity is on its way.'}
      </h2>
      <p>
        {filtered
          ? 'No open issues match these filters. Try another language or a wider difficulty range.'
          : 'There are no fresh, open opportunities in the catalog yet. Once the discovery worker synchronizes GitHub, they’ll appear here.'}
      </p>
      {filtered ? (
        <button className="button secondary" onClick={reset}>
          Clear filters <ArrowRight size={16} />
        </button>
      ) : (
        <Link className="button secondary" href="/resume">
          Build your profile while you wait <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
