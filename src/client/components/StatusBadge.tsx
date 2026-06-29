import type { JobStatus, TaskStatus } from '../../shared/types';

const JOB_COLORS: Record<JobStatus, string> = {
  queued: '#6b7280', running: '#3b82f6', done: '#22c55e', failed: '#ef4444', partial: '#f59e0b', cancelled: '#9ca3af',
};

const TASK_COLORS: Record<TaskStatus, string> = {
  pending: '#6b7280', running: '#3b82f6', approved: '#22c55e', needs_fix: '#f59e0b', failed: '#ef4444', cancelled: '#9ca3af',
};

export function StatusBadge({ status, type = 'job' }: { status: string; type?: 'job' | 'task' }) {
  const colors = type === 'job' ? JOB_COLORS : TASK_COLORS;
  const color = colors[status as JobStatus & TaskStatus] ?? '#6b7280';
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: color, color: '#fff', fontSize: 12, fontWeight: 600 }}>{status}</span>;
}
