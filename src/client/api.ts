import type { JobRecord, TaskRecord, JobLogRecord, JobArtifactRecord } from '../shared/types';

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' }, ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function createJob(payload: {
  repoPath: string;
  request: string;
  branchName?: string;
  maxRounds: number;
  plannerModel: string;
  coderModel: string;
  reviewerModel: string;
}): Promise<{ job: JobRecord }> {
  return fetchJson('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function listJobs(): Promise<{ jobs: JobRecord[] }> {
  return fetchJson('/api/jobs');
}

export async function getJob(id: string): Promise<{ job: JobRecord; tasks: TaskRecord[]; artifacts: JobArtifactRecord[]; logs: JobLogRecord[] }> {
  return fetchJson(`/api/jobs/${id}`);
}

export async function cancelJob(id: string): Promise<{ job: JobRecord }> {
  return fetchJson(`/api/jobs/${id}/cancel`, { method: 'POST' });
}

export async function retryJob(id: string): Promise<{ job: JobRecord }> {
  return fetchJson(`/api/jobs/${id}/retry`, { method: 'POST' });
}

export async function cloneJob(id: string): Promise<{ job: JobRecord }> {
  return fetchJson(`/api/jobs/${id}/clone`, { method: 'POST' });
}

export async function commitJob(id: string, message: string): Promise<{ ok: boolean }> {
  return fetchJson(`/api/jobs/${id}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

export function openJobStream(id: string, onEvent: (event: string, data: unknown) => void): EventSource {
  const es = new EventSource(`/api/jobs/${id}/stream`);
  es.onmessage = (e) => onEvent('message', JSON.parse(e.data));
  es.addEventListener('job', (e) => onEvent('job', JSON.parse((e as MessageEvent).data)));
  es.addEventListener('tasks', (e) => onEvent('tasks', JSON.parse((e as MessageEvent).data)));
  es.addEventListener('log', (e) => onEvent('log', JSON.parse((e as MessageEvent).data)));
  es.addEventListener('artifact', (e) => onEvent('artifact', JSON.parse((e as MessageEvent).data)));
  return es;
}
