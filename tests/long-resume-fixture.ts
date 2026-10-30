// Synthetic resume that reproduced Groq's HTTP 400 json_validate_failed response.
export const longResumeSkills = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'C++',
  'Go',
  'Rust',
  'HTML',
  'CSS',
  'SQL',
  'React',
  'Next.js',
  'Node.js',
  'Express',
  'Django',
  'Flask',
  'Spring',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Git',
  'GitHub',
  'Docker',
  'Kubernetes',
  'Linux',
  'AWS',
  'Azure',
  'Vercel',
  'Supabase',
  'Jest',
  'Vitest',
  'Playwright',
  'GraphQL',
  'REST',
  'Tailwind CSS',
  'Bootstrap',
  'TensorFlow',
  'PyTorch',
  'scikit-learn',
];
export const longResumeText =
  'Software developer. Technical skills and projects:\n' +
  longResumeSkills
    .map(
      (skill) =>
        `Used ${skill} to build and test a project. Implemented features, reviewed changes, and documented the results.`,
    )
    .join('\n');
