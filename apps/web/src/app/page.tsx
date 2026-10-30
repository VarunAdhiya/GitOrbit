import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  Code2,
  Compass,
  FileText,
  GitPullRequest,
  Github,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Brand, OrbitMark } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { AccountControl } from '@/components/account-control';
export default function HomePage() {
  return (
    <div className="landing">
      <header className="landing-header">
        <Brand />
        <nav aria-label="Main navigation">
          <Link href="/explore">Explore opportunities</Link>
          <Link href="#how-it-works">How it works</Link>
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <AccountControl />
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span /> OPEN SOURCE. OPEN POSSIBILITIES.
            </div>
            <h1>
              Your skills.
              <br />A shared mission.
              <br />
              <em>A place to start.</em>
            </h1>
            <p>
              There’s an open-source project that needs what you know. Find your next meaningful
              contribution with GitOrbit.
            </p>
            <div className="hero-actions">
              <Link className="button lime" href="/resume">
                Find my match <ArrowUpRight size={19} />
              </Link>
              <Link className="hero-secondary" href="/explore">
                Explore opportunities <ArrowRight size={17} />
              </Link>
            </div>
            <div className="hero-reassurance">
              <span>
                <Check size={14} /> Free to explore
              </span>
              <span>
                <Check size={14} /> Always open source
              </span>
            </div>
          </div>
          <div className="orbit-art" aria-label="Your skills connect to open-source opportunities">
            <div className="orbit-grid" />
            <div className="orbit-ring ring-one" />
            <div className="orbit-ring ring-two" />
            <div className="orbit-ring ring-three" />
            <div className="orbit-axis" />
            <div className="orbit-core">
              <OrbitMark />
              <span>
                YOUR NEXT
                <br />
                CONTRIBUTION
              </span>
            </div>
            <div className="orbit-node node-typescript">
              <Code2 />
              <span>TypeScript</span>
            </div>
            <div className="orbit-node node-python">
              <Braces />
              <span>Python</span>
            </div>
            <div className="orbit-node node-react">
              <span className="react-symbol">⚛</span>
              <span>React</span>
            </div>
            <div className="orbit-node node-pr">
              <GitPullRequest />
              <span>
                Something
                <br />
                meaningful.
              </span>
            </div>
            <div className="orbital-dot dot-one" />
            <div className="orbital-dot dot-two" />
            <span className="orbit-coordinate">SKILLS → POSSIBILITIES</span>
          </div>
          <div className="hero-bottom">
            <span>A BETTER WAY INTO OPEN SOURCE</span>
            <span>
              Built for the curious. Designed for the doers. <ArrowUpRight size={15} />
            </span>
          </div>
        </section>
        <section className="language-strip" aria-label="Discover across programming languages">
          <span>FIND YOUR ORBIT IN</span>
          <strong>TypeScript</strong>
          <strong>Python</strong>
          <strong>JavaScript</strong>
          <strong>Go</strong>
          <strong>Rust</strong>
          <strong>Java</strong>
          <span>and beyond ↗</span>
        </section>
        <section className="how-section" id="how-it-works">
          <div className="section-heading">
            <div>
              <span className="eyebrow">FROM “WHERE DO I START?” TO YOUR FIRST ISSUE.</span>
              <h2>
                A little direction.
                <br />
                <em>A world of possibility.</em>
              </h2>
            </div>
            <p>
              You bring the curiosity. We bring a clearer path to projects and people worth building
              with.
            </p>
          </div>
          <div className="steps-grid">
            <article>
              <span className="step-number">01 /</span>
              <FileText size={28} />
              <h3>Start with what you know.</h3>
              <p>
                Upload a text-based PDF resume or add your skills yourself. Review and refine your
                profile before moving on.
              </p>
              <span className="step-caption">YOUR EXPERIENCE, YOUR SAY</span>
            </article>
            <article>
              <span className="step-number">02 /</span>
              <Compass size={28} />
              <h3>Discover your corner.</h3>
              <p>
                Explore open GitHub issues, or get a ranked shortlist based on your skills,
                interests, and preferred difficulty.
              </p>
              <span className="step-caption">LESS NOISE, MORE RELEVANCE</span>
            </article>
            <article>
              <span className="step-number">03 /</span>
              <GitPullRequest size={28} />
              <h3>Make something better.</h3>
              <p>
                See why an issue fits, read the contribution guidelines, and head to GitHub to join
                the conversation.
              </p>
              <span className="step-caption">SMALL CONTRIBUTIONS COUNT</span>
            </article>
          </div>
        </section>
        <section className="principles">
          <div>
            <ShieldCheck size={22} />
            <h3>Your resume stays yours.</h3>
            <p>
              Raw files aren’t saved. Sign in to create your profile and delete it whenever you
              want.
            </p>
          </div>
          <div>
            <Sparkles size={22} />
            <h3>A match, with a reason.</h3>
            <p>
              Transparent scores. Visible skill overlap. Honest uncertainty when an issue’s
              requirements aren’t clear.
            </p>
          </div>
          <div>
            <Github size={22} />
            <h3>Connected to the source.</h3>
            <p>
              Background workers keep the catalog in sync. Every issue links back to the maintainers
              on GitHub.
            </p>
          </div>
        </section>
        <section className="landing-cta">
          <OrbitMark />
          <div>
            <h2>Your next contribution is out there.</h2>
            <p>Let’s find a good place to begin.</p>
          </div>
          <Link href="/explore" className="button dark">
            Explore opportunities <ArrowUpRight size={18} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>A little code can go a long way.</span>
        <Link href="/resume">
          Find your orbit <ArrowUpRight size={15} />
        </Link>
      </footer>
    </div>
  );
}
