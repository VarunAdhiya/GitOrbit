'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CircleDot,
  Clock3,
  Code2,
  GitFork,
  Github,
  Star,
} from 'lucide-react';
import type { Opportunity } from '@gitorbit/shared';
import { api, dateLabel } from '@/lib/api';
import { ErrorState, LoadingState } from './states';
export function OpportunityDetail({ id }: { id: string }) {
  const [item, setItem] = useState<Opportunity | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<Opportunity>(`/opportunities/${id}`, { signal: controller.signal })
      .then(setItem)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, revision]);
  if (error) return <ErrorState message={error} retry={() => setRevision((r) => r + 1)} />;
  if (!item) return <LoadingState label="Opening the opportunity…" />;
  const repo = item.repository;
  return (
    <>
      <Link className="back-link" href="/explore">
        <ArrowLeft size={15} />
        Back to opportunities
      </Link>
      <div className="detail-header">
        <div className="repo-identity">
          <span className="repo-avatar">{repo.owner[0].toUpperCase()}</span>
          <a href={repo.sourceUrl} target="_blank" rel="noopener noreferrer">
            {repo.owner} / <strong>{repo.name}</strong>
          </a>
          <span className="issue-number">#{item.issueNumber}</span>
        </div>
        <h1>{item.title}</h1>
        <div className="card-tags">
          <span className={`tag difficulty ${item.difficulty}`}>
            <CircleDot size={13} />
            {item.difficulty === 'unknown' ? 'Difficulty unknown' : item.difficulty}
          </span>
          <span className="tag">{item.state}</span>
          {item.assigned ? <span className="tag assigned">Assigned</span> : null}
          {item.inProgress ? <span className="tag assigned">In progress</span> : null}
          {item.labels.slice(0, 8).map((l) => (
            <span className="tag" key={l}>
              {l}
            </span>
          ))}
        </div>
      </div>
      {item.stale || item.state !== 'open' || repo.archived ? (
        <div role="status" className="alert error">
          This issue is{' '}
          {item.state !== 'open'
            ? item.state
            : repo.archived
              ? 'in an archived repository'
              : 'not recently synchronized'}
          . It is excluded from recommendations. Check the source for its latest status.
        </div>
      ) : null}
      <div className="detail-layout">
        <div>
          <section className="panel">
            <div className="panel-heading">
              <BookOpen size={20} />
              <h2>About this issue</h2>
              <a
                className="text-button"
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View original <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="issue-body">
              {item.description ||
                'No description was provided. Open the original issue to ask the maintainers about its scope.'}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <Code2 size={20} />
              <h2>Skills & scope</h2>
            </div>
            <p>
              These skills are mentioned in the issue. They aren’t a verified checklist of
              prerequisites.
            </p>
            <div className="card-tags">
              {item.relevantSkills.length ? (
                item.relevantSkills.map((s) => (
                  <span key={s} className="tag skill">
                    {s}
                  </span>
                ))
              ) : (
                <span className="muted">No issue-specific skills confirmed.</span>
              )}
            </div>
            <p className="data-note">{item.difficultyEvidence}</p>
            <h3>Repository context</h3>
            <p>
              {repo.languages.join(', ') || repo.primaryLanguage || 'Languages unavailable'}. A
              repository’s languages may not be required for this particular issue.
            </p>
          </section>
        </div>
        <aside>
          <section className="contribute-card">
            <Github size={27} />
            <h2>A good place to begin?</h2>
            <p>
              Read the discussion, check whether someone is already working on it, and introduce
              yourself.
            </p>
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="button lime"
            >
              Open issue on GitHub <ArrowUpRight size={17} />
            </a>
            {repo.contributionUrl ? (
              <a
                className="guidelines-link"
                href={repo.contributionUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Contribution guidelines <ArrowUpRight size={15} />
              </a>
            ) : (
              <p className="fine-print">
                No contribution guide was found. Ask the maintainers how to get started.
              </p>
            )}
          </section>
          <section className="panel repo-panel">
            <h3>Meet the project</h3>
            <h2>{repo.name}</h2>
            <p>{repo.description || 'No repository description available.'}</p>
            <div className="repo-meta">
              <span>
                <Star size={15} />
                {repo.stars.toLocaleString()} stars
              </span>
              <span>
                <GitFork size={15} />
                {repo.forks.toLocaleString()}
              </span>
            </div>
            <div className="card-tags">
              {repo.topics.slice(0, 6).map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <dl className="date-list">
              <div>
                <dt>Repository created</dt>
                <dd>{dateLabel(repo.createdAtSource)}</dd>
              </div>
              <div>
                <dt>Last repository push</dt>
                <dd>{dateLabel(repo.lastPushedAt)}</dd>
              </div>
              <div>
                <dt>Issue created</dt>
                <dd>{dateLabel(item.createdAtSource)}</dd>
              </div>
              <div>
                <dt>Issue updated</dt>
                <dd>{dateLabel(item.updatedAtSource)}</dd>
              </div>
              <div>
                <dt>
                  <Clock3 size={12} />
                  Last synchronized
                </dt>
                <dd>{dateLabel(item.lastSyncedAt)}</dd>
              </div>
            </dl>
            <p className="fine-print">
              Recent activity does not guarantee maintainer responsiveness.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
