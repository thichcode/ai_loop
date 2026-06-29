import { useEffect, useState, useRef, useCallback } from 'react';
import { getJob, cancelJob, commitJob, openJobStream } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { LogViewer } from '../components/LogViewer';
import { DiffViewer } from '../components/DiffViewer';
import type { JobRecord, TaskRecord, JobLogRecord, JobArtifactRecord } from '../../shared/types';

export function JobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<JobRecord | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [logs, setLogs] = useState<JobLogRecord[]>([]);
  const [artifacts, setArtifacts] = useState<JobArtifactRecord[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [connected, setConnected] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const loadData = useCallback(async () => {
    try {
      const data = await getJob(id);
      setJob(data.job);
      setTasks(data.tasks);
      setLogs(data.logs);
      setArtifacts(data.artifacts);
      setLoadError('');
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setInitialLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
    const es = openJobStream(id, (event, data) => {
      if (event === 'job') setJob(data as JobRecord);
      if (event === 'tasks') setTasks(data as TaskRecord[]);
      if (event === 'log') setLogs((prev) => [...prev, data as JobLogRecord]);
      if (event === 'artifact') {
        setArtifacts((prev) => {
          const existing = prev.findIndex((a) => a.name === (data as JobArtifactRecord).name && a.taskId === (data as JobArtifactRecord).taskId);
          if (existing >= 0) { const copy = [...prev]; copy[existing] = data as JobArtifactRecord; return copy; }
          return [...prev, data as JobArtifactRecord];
        });
      }
    });
    es.onerror = () => { setConnected(false); };
    es.onopen = () => { setConnected(true); };
    esRef.current = es;
    return () => es.close();
  }, [id, loadData]);

  const handleCancel = async () => {
    await cancelJob(id);
    loadData();
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCommitting(true);
    try {
      await commitJob(id, commitMsg);
      loadData();
    } catch (err) {
      alert(`Commit failed: ${err}`);
    } finally {
      setCommitting(false);
    }
  };

  if (initialLoading) return <div>Loading...</div>;
  if (loadError) return <div style={{ color: 'red' }}>Error loading job: {loadError}. <a href="/">Back to jobs list</a></div>;
  if (!job) return <div>Job not found. <a href="/">Back to jobs list</a></div>;

  const diffArtifact = artifacts.find((a) => a.name === 'diff');
  const summaryArtifact = artifacts.find((a) => a.name === 'final_summary');
  const canCommit = job.status === 'done' || job.status === 'partial';
  const canCancel = job.status === 'queued' || job.status === 'running';

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <a href="/">← Back</a>
        <h2 style={{ margin: 0 }}>Job {id.slice(0, 8)}</h2>
        <StatusBadge status={job.status} />
        <span style={{ color: '#6b7280' }}>{job.phase}</span>
        {!connected && <span style={{ color: '#f59e0b', fontStyle: 'italic' }}>Reconnecting…</span>}
        {canCancel && <button onClick={handleCancel} style={{ marginLeft: 'auto' }}>Cancel</button>}
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Request:</strong> {job.request}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Repo:</strong> {job.repoPath}
        {job.branchName && <> | <strong>Branch:</strong> {job.branchName}</>}
      </div>

      <h3>Tasks</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: 6 }}>#</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Title</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Status</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Rounds</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Failure</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 6 }}>{t.taskIndex}</td>
              <td style={{ padding: 6 }}>{t.title}</td>
              <td style={{ padding: 6 }}><StatusBadge status={t.status} type="task" /></td>
              <td style={{ padding: 6 }}>{t.rounds}</td>
              <td style={{ padding: 6, color: '#ef4444' }}>{t.failureReason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Logs</h3>
      <LogViewer logs={logs} />

      <h3>Diff</h3>
      <DiffViewer diff={diffArtifact?.content ?? ''} />

      {summaryArtifact && (
        <>
          <h3>Summary</h3>
          <pre style={{ fontFamily: 'monospace', fontSize: 12, background: '#f3f4f6', padding: 8, borderRadius: 4 }}>{summaryArtifact.content}</pre>
        </>
      )}

      {canCommit && (
        <>
          <h3>Commit</h3>
          <form onSubmit={handleCommit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message" required style={{ flex: 1 }} />
            <button type="submit" disabled={committing}>{committing ? 'Committing...' : 'Commit'}</button>
          </form>
        </>
      )}
    </div>
  );
}
