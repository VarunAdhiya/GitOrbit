import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'GitOrbit — Find your place in open source', template: '%s · GitOrbit' },
  description:
    'Discover open-source issues that fit your skills. Review your resume, find your match, and make a meaningful contribution.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
