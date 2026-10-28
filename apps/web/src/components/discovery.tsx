'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  Radio,
} from 'lucide-react';
import type { Facets, OpportunityPage } from '@gitorbit/shared';
import { api, ApiClientError, dateLabel } from '@/lib/api';
import { OpportunityCard } from './opportunity-card';
import { EmptyState, ErrorState, LoadingState } from './states';
import { OrbitMark } from './brand';
export function Discovery({ personalized = false }: { personalized?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const [search, setSearch] = useState(params.get('q') || '');
  const [data, setData] = useState<OpportunityPage | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api<OpportunityPage>(`/${personalized ? 'recommendations' : 'opportunities'}?${query}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, personalized, revision]);
  useEffect(() => {
    const controller = new AbortController();
    api<Facets>('/opportunities/facets', { signal: controller.signal })
      .then(setFacets)
      .catch(() => {});
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    setSearch(params.get('q') || '');
  }, [params]);
  function change(key: string, value: string) {
    const next = new URLSearchParams(query);
    if (value && value !== 'any') next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.replace(`?${next}`, { scroll: false });
  }
  function reset() {
    setSearch('');
    router.replace(personalized ? '/recommendations' : '/explore', { scroll: false });
  }
  const activeFilters = [...params.entries()].filter(([key]) => !['page', 'sort'].includes(key));
  const needsProfile = error && ['PROFILE_REQUIRED', 'PROFILE_NOT_FOUND'].includes(error.code);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="small-line" />
            {personalized ? 'YOUR SKILLS, PUT TO WORK' : 'GOOD CODE STARTS WITH CURIOSITY'}
          </div>
          <h1>
            {personalized ? 'Find your kind of contribution.' : 'Find your next contribution.'}
          </h1>
          <p>
            {personalized
              ? 'Open issues, ranked around what you know and what you want to explore.'
              : 'Meaningful projects. Welcoming communities. A place for your skills.'}
          </p>
        </div>
        <span className="heading-orbit">
          <OrbitMark />
        </span>
      </div>
      {!personalized ? (
        <section className="match-callout">
          <div className="callout-symbol">
            <Sparkles size={22} />
          </div>
          <div>
            <h2>Less searching. More making.</h2>
            <p>Let your skills point you toward the right issues.</p>
          </div>
          <Link href="/resume" className="button dark">
            Find my match <ArrowUpRight size={16} />
          </Link>
          <div className="callout-orbits" aria-hidden="true" />
        </section>
      ) : (
        <div className="personalized-note">
          <Sparkles size={17} />
          <span>
            Ranked by skills (40%), difficulty (25%), activity (20%), and interests (15%).
          </span>
          <Link href="/resume">
            Edit profile <ArrowUpRight size={14} />
          </Link>
        </div>
      )}
      <div className="discovery-tabs">
        <div role="navigation" aria-label="Discovery mode">
          <Link className={!personalized ? 'selected' : ''} href="/explore">
            Explore all <span>↗</span>
          </Link>
          <Link className={personalized ? 'selected' : ''} href="/recommendations">
            <Sparkles size={15} /> For you
          </Link>
        </div>
        <span className="catalog-label">
          <Radio size={13} /> GitHub opportunities
        </span>
      </div>
      <div className="search-toolbar">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            change('q', search);
          }}
        >
          <Search size={19} />
          <input
            aria-label="Search opportunities"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues, projects, or a little inspiration…"
            maxLength={160}
          />
          <button type="submit" aria-label="Search">
            <ArrowRight size={18} />
          </button>
        </form>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`button filter-button ${showFilters ? 'pressed' : ''}`}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal size={17} />
          Filters{activeFilters.length ? <span>{activeFilters.length}</span> : null}
        </button>
      </div>
      <div className={`filter-bar ${showFilters ? 'expanded' : ''}`}>
        <label>
          Language
          <select
            aria-label="Programming language"
            value={params.get('language') || ''}
            onChange={(e) => change('language', e.target.value)}
          >
            <option value="">All languages</option>
            {(
              facets?.languages || [
                'TypeScript',
                'JavaScript',
                'Python',
                'Go',
                'Rust',
                'Java',
                'C++',
              ]
            ).map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Difficulty
          <select
            value={params.get('difficulty') || 'any'}
            onChange={(e) => change('difficulty', e.target.value)}
          >
            <option value="any">Any difficulty</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          Repository activity
          <select
            value={params.get('activity') || 'any'}
            onChange={(e) => change('activity', e.target.value)}
          >
            <option value="any">Any activity</option>
            <option value="month">Pushed in 30 days</option>
            <option value="quarter">Pushed in 90 days</option>
          </select>
        </label>
        <label className="check-filter">
          <input
            type="checkbox"
            checked={params.get('available') === 'true'}
            onChange={(e) => change('available', e.target.checked ? 'true' : '')}
          />
          Unassigned only
        </label>
      </div>
      {showFilters ? (
        <div className="advanced-filters">
          <label>
            Issue-specific skill
            <select
              value={params.get('skill') || ''}
              onChange={(e) => change('skill', e.target.value)}
            >
              <option value="">All skills</option>
              {facets?.skills.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Repository
            <select
              value={params.get('repository') || ''}
              onChange={(e) => change('repository', e.target.value)}
            >
              <option value="">All repositories</option>
              {facets?.repositories.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.owner}/{r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Program
            <select
              disabled={!facets?.programs.length}
              value={params.get('program') || ''}
              onChange={(e) => change('program', e.target.value)}
            >
              <option value="">
                {facets?.programs.length ? 'All verified programs' : 'No verified programs yet'}
              </option>
              {facets?.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {activeFilters.length ? (
        <div className="active-filters">
          {activeFilters.map(([key, value]) => (
            <button className="tag" key={key} onClick={() => change(key, '')}>
              {key}: {value}
              <X size={12} />
            </button>
          ))}
          <button className="text-button" onClick={reset}>
            Clear all
          </button>
        </div>
      ) : null}
      <div className="results-heading">
        <h2>
          {loading ? (
            'Finding opportunities'
          ) : data && !error ? (
            <>
              <strong>{data.total.toLocaleString()}</strong> open opportunities
            </>
          ) : (
            'Open opportunities'
          )}
        </h2>
        <label className="sort-control">
          Sort by
          <select
            aria-label="Sort opportunities"
            value={params.get('sort') || (personalized ? 'match' : 'updated')}
            onChange={(e) => change('sort', e.target.value)}
          >
            {personalized ? <option value="match">Highest match</option> : null}
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
          </select>
        </label>
      </div>
      {loading ? (
        <LoadingState />
      ) : needsProfile ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Sparkles size={28} />
          </span>
          <h2>Your next chapter starts with you.</h2>
          <p>
            Add a few skills or upload your resume. We’ll connect the dots between what you know and
            where you can help.
          </p>
          <Link className="button primary" href="/resume">
            Build my profile <ArrowRight size={17} />
          </Link>
          <span className="fine-print">No signup. Just your skills.</span>
        </div>
      ) : error ? (
        <ErrorState message={error.message} retry={() => setRevision((r) => r + 1)} />
      ) : data?.items.length ? (
        <>
          <div className="opportunity-grid">
            {data.items.map((item) => (
              <OpportunityCard key={item.id} item={item} />
            ))}
          </div>
          {data.rankingLimited ? (
            <p className="data-note">
              Matching considers the 1,000 most recently updated issues in this search. Narrow your
              filters to rank a more focused set.
            </p>
          ) : null}
          <nav className="pagination" aria-label="Opportunity pages">
            <span>
              Page {data.page} of {data.pages}
            </span>
            <div>
              <button
                className="button secondary small"
                disabled={data.page <= 1}
                onClick={() => change('page', String(data.page - 1))}
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <button
                className="button secondary small"
                disabled={data.page >= data.pages}
                onClick={() => change('page', String(data.page + 1))}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </nav>
        </>
      ) : (
        <EmptyState filtered={activeFilters.length > 0} reset={reset} />
      )}
      <div className="discovery-footnote">
        <span>
          <span className="status-dot" />
          Last catalog sync: {dateLabel(facets?.lastSyncedAt || null)}
        </span>
        <span>Issue status can change. Check GitHub before starting.</span>
      </div>
    </>
  );
}
