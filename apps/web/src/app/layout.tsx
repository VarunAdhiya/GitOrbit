import type { Metadata } from 'next';
import './globals.css';
import './theme.css';
import { AuthProvider } from '@/components/auth-provider';
export const metadata: Metadata = {
  title: { default: 'GitOrbit — Find your place in open source', template: '%s · GitOrbit' },
  description:
    'Discover open-source issues that fit your skills. Review your resume, find your match, and make a meaningful contribution.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('gitorbit-theme')==='light'?'light':'dark'}catch{}",
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
