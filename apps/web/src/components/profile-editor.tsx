'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  FileText,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { categorySchema, normalizeSkill, type Profile, type ProfileInput } from '@gitorbit/shared';
import { api, ApiClientError, dateLabel } from '@/lib/api';
import { LoadingState } from './states';
type Config = { aiConfigured: boolean; aiProvider: string; profileTtlHours: number };
const blank: ProfileInput = {
  skills: [],
  experienceLevel: 'unknown',
  interests: [],
  preferredLanguages: [],
  desiredDifficulty: 'any',
};
const categories: Record<string, string> = {
  programmingLanguages: 'Language',
  frameworks: 'Framework / library',
  databases: 'Database',
  tools: 'Tool / cloud',
  domains: 'Domain',
};
export function ProfileEditor() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<ProfileInput>(blank);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'upload' | 'save' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [skill, setSkill] = useState('');
  const [category, setCategory] =
    useState<ProfileInput['skills'][number]['category']>('programmingLanguages');
  const [interests, setInterests] = useState('');
  const [languages, setLanguages] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    function load(p: Profile) {
      setProfile(p);
      setForm(p);
      setInterests(p.interests.join(', '));
      setLanguages(p.preferredLanguages.join(', '));
    }
    Promise.allSettled([
      api<Config>('/config', { signal: controller.signal }).then(setConfig),
      api<Profile>('/profiles/current', { signal: controller.signal })
        .then(load)
        .catch((e) => {
          if (!(e instanceof ApiClientError && [401, 404].includes(e.status))) throw e;
        }),
    ]).then((results) => {
      if (controller.signal.aborted) return;
      if (results.some((r) => r.status === 'rejected'))
        setError(
          'Some services are unavailable. You can edit your skills, but saving requires the API and database.',
        );
      setLoading(false);
    });
    return () => controller.abort();
  }, []);
  function chooseFile(selected?: File) {
    setError('');
    if (!selected) return;
    if (selected.type !== 'application/pdf' && !selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF resume.');
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      setError('Your PDF must be 5 MB or smaller.');
      return;
    }
    setFile(selected);
  }
  async function upload() {
    if (!file || !consent) return;
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      body.append('resume', file);
      const result = await api<Profile>('/resumes/analyze', {
        method: 'POST',
        headers: { 'X-Resume-Consent': 'true' },
        body,
      });
      setProfile(result);
      setForm(result);
      setInterests('');
      setLanguages('');
      setFile(null);
      setNotice(
        result.skills.length
          ? 'Your skills are ready to review. Correct anything that doesn’t look right.'
          : 'No skills could be verified from this resume. Add them below to continue.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to analyze this resume.');
    } finally {
      setBusy(null);
    }
  }
  function addSkill() {
    if (!skill.trim() || form.skills.length >= 80) return;
    const name = normalizeSkill(skill);
    if (!form.skills.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      setForm((f) => ({
        ...f,
        skills: [...f.skills, { name, category, source: 'user', confidence: 1 }],
      }));
    setSkill('');
  }
  async function save() {
    if (!form.skills.length) {
      setError('Add at least one skill to personalize your recommendations.');
      return;
    }
    setBusy('save');
    setError('');
    const list = (value: string) => [
      ...new Set(
        value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    try {
      const input: ProfileInput = {
        skills: form.skills,
        experienceLevel: form.experienceLevel,
        desiredDifficulty: form.desiredDifficulty,
        interests: list(interests),
        preferredLanguages: list(languages).map(normalizeSkill),
      };
      await api<Profile>(profile ? `/profiles/${profile.id}` : '/profiles', {
        method: profile ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      });
      router.push(
        `/recommendations${input.preferredLanguages.length === 1 ? `?language=${encodeURIComponent(input.preferredLanguages[0])}` : ''}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save your profile.');
    } finally {
      setBusy(null);
    }
  }
  async function removeProfile() {
    if (!profile) return;
    setBusy('delete');
    setError('');
    try {
      await api(`/profiles/${profile.id}`, { method: 'DELETE' });
      setProfile(null);
      setForm(blank);
      setInterests('');
      setLanguages('');
      setFile(null);
      setConfirmDelete(false);
      setNotice('Your active profile has been deleted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete your profile.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A STARTING POINT THAT’S YOURS</span>
          <h1>Bring your skills into orbit.</h1>
          <p>A little about you helps us find a better place to contribute.</p>
        </div>
      </div>
      <div className="profile-progress">
        <span className="current">
          <i>01</i>Your experience
        </span>
        <span className="progress-line" />
        <span>
          <i>02</i>Review your skills
        </span>
        <span className="progress-line" />
        <span>
          <i>03</i>Find your match
        </span>
      </div>
      {loading ? (
        <LoadingState label="Loading your workspace…" />
      ) : (
        <div className="profile-layout">
          <div className="profile-main">
            {error ? (
              <div className="alert error" role="alert">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="alert success" role="status">
                <Check size={17} />
                {notice}
              </div>
            ) : null}
            <section className="panel upload-panel">
              <div className="panel-heading">
                <span className="section-number">01</span>
                <div>
                  <h2>Start with your resume</h2>
                  <p>Or skip the upload and add your skills below.</p>
                </div>
                <span className="tag">Optional</span>
              </div>
              <div
                className={`dropzone ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!busy) chooseFile(e.dataTransfer.files[0]);
                }}
              >
                <span className="upload-icon">
                  {file ? <FileText size={27} /> : <Upload size={27} />}
                </span>
                <h3>{file ? file.name : 'A small upload. A world of possibility.'}</h3>
                <p>
                  {file
                    ? `${(file.size / 1024).toFixed(0)} KB · Ready to analyze`
                    : 'Drop your resume here, or choose a file to get started.'}
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="Choose PDF resume"
                  className="visually-hidden"
                  onChange={(e) => chooseFile(e.target.files?.[0])}
                  disabled={Boolean(busy)}
                />
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  className="button secondary small"
                  onClick={() => fileInput.current?.click()}
                >
                  {file ? 'Choose another file' : 'Choose PDF'}
                  <Plus size={15} />
                </button>
                <span className="fine-print">Text-based PDF · Up to 5 MB · Maximum 20 pages</span>
              </div>
              {config && !config.aiConfigured ? (
                <div className="alert neutral">
                  Resume analysis isn’t enabled on this instance yet. You can create a complete
                  profile manually below.
                </div>
              ) : null}
              <label className="consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={Boolean(busy)}
                />
                <span>
                  I agree to send my resume text to{' '}
                  <strong>{config?.aiProvider || 'the configured AI provider'}</strong> for skill
                  extraction. GitOrbit won’t save my raw resume. The provider’s retention policy
                  applies.
                </span>
              </label>
              <button
                className="button dark"
                disabled={!file || !consent || !config?.aiConfigured || Boolean(busy)}
                onClick={upload}
              >
                {busy === 'upload' ? (
                  <>
                    <span className="loader" /> Reading your resume…
                  </>
                ) : (
                  <>
                    <Sparkles size={17} /> Analyze resume
                  </>
                )}
              </button>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <span className="section-number">02</span>
                <div>
                  <h2>Make your profile your own</h2>
                  <p>Review detected skills, or add what you know.</p>
                </div>
              </div>
              <div className="skill-tags">
                {form.skills.length ? (
                  form.skills.map((s) => (
                    <span className="editable-tag" key={s.name}>
                      <span>
                        {s.name}
                        <small>
                          {s.source === 'extracted' ? 'From resume' : categories[s.category]}
                        </small>
                      </span>
                      <button
                        aria-label={`Remove ${s.name}`}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            skills: f.skills.filter((x) => x.name !== s.name),
                          }))
                        }
                        disabled={Boolean(busy)}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))
                ) : (
                  <p className="muted small-copy">
                    No skills added yet. Try a language, framework, or tool you enjoy using.
                  </p>
                )}
              </div>
              <form
                className="add-skill-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  addSkill();
                }}
              >
                <label className="grow">
                  Skill
                  <input
                    value={skill}
                    maxLength={80}
                    placeholder="e.g. TypeScript"
                    onChange={(e) => setSkill(e.target.value)}
                    disabled={Boolean(busy)}
                  />
                </label>
                <label>
                  Category
                  <select
                    value={category}
                    onChange={(e) => setCategory(categorySchema.parse(e.target.value))}
                    disabled={Boolean(busy)}
                  >
                    {Object.entries(categories).map(([key, label]) => (
                      <option value={key} key={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="button secondary"
                  disabled={!skill.trim() || Boolean(busy)}
                >
                  <Plus size={16} />
                  Add
                </button>
              </form>
              <div className="form-grid">
                <label>
                  Experience level
                  <select
                    value={form.experienceLevel}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        experienceLevel: e.target.value as ProfileInput['experienceLevel'],
                      }))
                    }
                  >
                    <option value="unknown">Not sure yet</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                  <small>
                    {profile?.experienceInferred
                      ? 'AI estimate, not a verified proficiency. Please review.'
                      : 'Choose what feels right for you.'}
                  </small>
                </label>
                <label>
                  Preferred issue difficulty
                  <select
                    value={form.desiredDifficulty}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        desiredDifficulty: e.target.value as ProfileInput['desiredDifficulty'],
                      }))
                    }
                  >
                    <option value="any">Open to anything</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="unknown">Unknown</option>
                  </select>
                  <small>Unknown means the issue needs a closer look.</small>
                </label>
                <label>
                  Interests
                  <input
                    value={interests}
                    onChange={(e) => setInterests(e.target.value)}
                    maxLength={500}
                    placeholder="Developer tools, accessibility, web"
                  />
                  <small>Separate interests with commas. Up to 15.</small>
                </label>
                <label>
                  Preferred languages
                  <input
                    value={languages}
                    onChange={(e) => setLanguages(e.target.value)}
                    maxLength={500}
                    placeholder="TypeScript, Python"
                  />
                  <small>Used to focus your recommendation search.</small>
                </label>
              </div>
              {profile?.experienceSummary.length ? (
                <details className="experience-details">
                  <summary>Experience excerpts supporting the estimate</summary>
                  <ul>
                    {profile.experienceSummary.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="profile-save">
                <p>Saving confirms these skills as your choices.</p>
                <button className="button primary" disabled={Boolean(busy)} onClick={save}>
                  {busy === 'save' ? 'Saving profile…' : 'Find my opportunities'}
                  <ArrowRight size={17} />
                </button>
              </div>
            </section>
            {profile ? (
              <section className="profile-delete">
                <div>
                  <h3>Your profile, your control.</h3>
                  <p>Expires {dateLabel(profile.expiresAt)}. You can delete it now.</p>
                </div>
                {confirmDelete ? (
                  <div className="delete-confirm">
                    <span>Delete this profile permanently?</span>
                    <button
                      className="button danger small"
                      disabled={Boolean(busy)}
                      onClick={removeProfile}
                    >
                      Delete profile
                    </button>
                    <button className="text-button" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="text-button danger-text"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={15} />
                    Delete profile
                  </button>
                )}
              </section>
            ) : null}
          </div>
          <aside className="profile-aside">
            <div className="privacy-card">
              <ShieldCheck size={25} />
              <h3>
                A profile.
                <br />
                Not a paper trail.
              </h3>
              <p>
                No account to create. No raw resume to store. Just the skills you choose to share.
              </p>
              <ul>
                <li>
                  <Check size={15} />
                  Private anonymous session
                </li>
                <li>
                  <Check size={15} />
                  Editable, evidence-based skills
                </li>
                <li>
                  <Check size={15} />
                  Auto-expires in {config?.profileTtlHours || 24} hours
                </li>
                <li>
                  <Check size={15} />
                  Delete your profile anytime
                </li>
              </ul>
            </div>
            <div className="matching-note">
              <span className="eyebrow">HOW YOUR MATCH IS MADE</span>
              <h3>More than a keyword.</h3>
              {[
                ['Skill compatibility', 40],
                ['Difficulty fit', 25],
                ['Repository activity', 20],
                ['Shared interests', 15],
              ].map(([label, value]) => (
                <div className="weight-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}%</strong>
                  <i style={{ width: `${value}%` }} />
                </div>
              ))}
              <p>
                Scores are a starting point. Always review the issue and talk to the maintainers.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
