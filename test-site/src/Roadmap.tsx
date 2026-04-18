import { useEffect, useState } from 'react';

interface Issue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  reactions?: { '+1'?: number; '-1'?: number };
  comments: number;
  pull_request?: unknown;
}

export function Roadmap() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('https://api.github.com/repos/MarcusRobbins/chorus/issues?state=open&per_page=30')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((data: Issue[]) => {
        setIssues(data.filter((i) => !i.pull_request));
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  if (error) return <p style={{ color: '#a00', fontSize: '0.875rem' }}>Could not load roadmap: {error}</p>;
  if (issues === null) return <p style={{ color: '#888', fontSize: '0.875rem' }}>Loading…</p>;
  if (issues.length === 0) {
    return (
      <p style={{ color: '#888', fontSize: '0.875rem' }}>
        No open issues yet — file one using the Chorus trigger to add the first.
      </p>
    );
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {issues.map((i) => (
        <li
          key={i.number}
          style={{
            marginBottom: '0.5rem',
            paddingBottom: '0.5rem',
            borderBottom: '1px solid #eee',
          }}
        >
          <a href={i.html_url} target="_blank" rel="noopener">
            #{i.number} {i.title}
          </a>
          <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#888' }}>
            👍 {i.reactions?.['+1'] ?? 0} · 💬 {i.comments}
          </span>
        </li>
      ))}
    </ul>
  );
}
