import { useEffect, useState } from 'react';
import { listJobs } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import type { JobRecord } from '../../shared/types';

export function JobsList() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listJobs().then(({ jobs }) => { setJobs(jobs); setLoading(false); }).catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;

  return (
    <div>
      <h2>Jobs</h2>
      <a href="/new">New Job</a>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Phase</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Request</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Created</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Duration</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 8 }}><StatusBadge status={job.status} /></td>
              <td style={{ padding: 8 }}>{job.phase}</td>
              <td style={{ padding: 8, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.request}</td>
              <td style={{ padding: 8 }}>{new Date(job.createdAt).toLocaleString()}</td>
              <td style={{ padding: 8 }}>{job.finishedAt ? `${Math.round((new Date(job.finishedAt).getTime() - new Date(job.createdAt).getTime()) / 1000)}s` : '—'}</td>
              <td style={{ padding: 8 }}><a href={`/jobs/${job.id}`}>View</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      {jobs.length === 0 && <p>No jobs yet.</p>}
    </div>
  );
}
