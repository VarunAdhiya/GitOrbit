import Link from 'next/link';
import { ArrowUpRight, CircleDot, GitFork, Star, Clock3 } from 'lucide-react';
import type { Opportunity } from '@gitorbit/shared';
import { dateLabel } from '@/lib/api';
export function OpportunityCard({ item }: { item: Opportunity }) {
  const repo = item.repository;
  const summary = item.description
    .replace(/[#*`>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
  return (
    <article className="opportunity-card">
      <div className="card-top">
        <div className="repo-identity">
          <span className="repo-avatar" aria-hidden="true">
            {repo.owner.slice(0, 1).toUpperCase()}
          </span>
          <span>
            {repo.owner}
            <span className="muted"> / </span>
            <strong>{repo.name}</strong>
          </span>
        </div>
        {item.match ? (
          <span className="match-badge">
            <span className="match-dot" />
            {item.match.score}% match
          </span>
        ) : (
          <span className="issue-number">#{item.issueNumber}</span>
        )}
      </div>
      <div className="card-title-row">
        <h2>
          <Link href={`/opportunities/${item.id}`}>{item.title}</Link>
        </h2>
        <Link
          href={`/opportunities/${item.id}`}
          className="card-arrow"
          aria-label={`View ${item.title}`}
        >
          <ArrowUpRight size={21} />
        </Link>
      </div>
      <p className="card-description">
        {summary || 'Open this issue to review its scope and contribution details.'}
      </p>
      <div className="card-tags">
        <span className={`tag difficulty ${item.difficulty}`}>
          <CircleDot size={12} />
          {item.difficulty === 'unknown' ? 'Difficulty unknown' : item.difficulty}
        </span>
        {item.labels
          .filter((l) => !['good first issue', 'beginner'].includes(l.toLowerCase()))
          .slice(0, 2)
          .map((label) => (
            <span className="tag" key={label}>
              {label}
            </span>
          ))}
        {item.assigned || item.inProgress ? (
          <span className="tag assigned">{item.assigned ? 'Assigned' : 'In progress'}</span>
        ) : null}
      </div>
      {item.match ? (
        <>
          <div className="match-explanation">
            <span>WHY THIS FITS</span>
            <p>{item.match.explanation}</p>
          </div>
          <details className="match-details">
            <summary>See match breakdown</summary>
            <dl>
              <dt>Skills · 40% weight</dt>
              <dd>{item.match.skillScore}/100</dd>
              <dt>Difficulty · 25%</dt>
              <dd>{item.match.difficultyScore}/100</dd>
              <dt>Activity · 20%</dt>
              <dd>{item.match.activityScore}/100</dd>
              <dt>Interests · 15%</dt>
              <dd>{item.match.interestScore}/100</dd>
            </dl>
            <p>{item.match.activitySummary}</p>
            {item.match.matchingSkills.length ? (
              <p>
                <strong>Matching skills:</strong> {item.match.matchingSkills.join(', ')}
              </p>
            ) : null}
            {item.match.uncertainPrerequisites.length ? (
              <>
                <p>
                  <strong>Worth checking:</strong>
                </p>
                <ul>
                  {item.match.uncertainPrerequisites.map((skill) => (
                    <li key={skill}>{skill}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </details>
        </>
      ) : null}
      <div className="card-footer">
        <div className="repo-meta">
          <span>
            <i className={`language-dot ${repo.primaryLanguage?.toLowerCase()}`} />
            {repo.primaryLanguage || 'Mixed languages'}
          </span>
          <span title="Repository stars">
            <Star size={14} />
            {Intl.NumberFormat('en', { notation: 'compact' }).format(repo.stars)}
          </span>
          <span className="forks" title="Repository forks">
            <GitFork size={14} />
            {Intl.NumberFormat('en', { notation: 'compact' }).format(repo.forks)}
          </span>
        </div>
        <span className="updated">
          <Clock3 size={13} />
          Updated {dateLabel(item.updatedAtSource)}
        </span>
      </div>
    </article>
  );
}
