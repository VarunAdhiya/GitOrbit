import Link from 'next/link';
export function OrbitMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="20"
        cy="20"
        rx="18"
        ry="9"
        transform="rotate(-35 20 20)"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="20" cy="20" r="5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="33" cy="11" r="3" fill="currentColor" />
    </svg>
  );
}
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="GitOrbit home">
      <OrbitMark />
      <span>
        GitOrbit<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
