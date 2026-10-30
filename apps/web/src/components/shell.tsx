'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Compass,
  Sparkles,
  ScanFace,
  ArrowUpRight,
  ArrowLeft,
  CircleHelp,
  GitBranch,
} from 'lucide-react';
import { Brand, OrbitMark } from './brand';
import { ThemeToggle } from './theme-toggle';
import { AccountControl } from './account-control';
const links = [
  { href: '/explore', label: 'Explore opportunities', icon: Compass },
  { href: '/recommendations', label: 'For you', icon: Sparkles },
  { href: '/resume', label: 'Your profile', icon: ScanFace },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-section-label">YOUR WORKSPACE</div>
        <nav aria-label="Workspace">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item ${path === href || (href === '/explore' && path.startsWith('/opportunities')) ? 'active' : ''}`}
              aria-current={path === href ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {href === '/recommendations' ? <span className="nav-new">AI</span> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <OrbitMark />
          <h3>
            A little code.
            <br />A bigger impact.
          </h3>
          <p>Your next contribution could be someone’s missing piece.</p>
          <Link href="/#how-it-works">
            How GitOrbit works <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <Link href="/#how-it-works">
            <CircleHelp size={17} /> A guide to getting started
          </Link>
          <div className="sidebar-footer">
            <GitBranch size={15} /> Built for open source<span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace-content">
        <header className="workspace-topbar">
          <div className="breadcrumb">
            <Link href="/">Workspace</Link>
            <span>/</span>
            <span>
              {path === '/resume'
                ? 'Your profile'
                : path === '/recommendations'
                  ? 'For you'
                  : 'Discover'}
            </span>
          </div>
          <div className="header-actions">
            <ThemeToggle />
            <AccountControl />
          </div>
        </header>
        <main id="main" className="workspace-main">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Made for the next generation of contributors.</span>
          <Link href="/">
            GitOrbit <ArrowLeft size={14} />
          </Link>
        </footer>
      </div>
    </div>
  );
}
