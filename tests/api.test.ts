import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import { buildServer } from '../src/server/routes';

describe('api', () => {
  it('creates and reads a job', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const create = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' }
    });

    expect(create.statusCode).toBe(200);
    const body = create.json();
    const read = await app.inject({ method: 'GET', url: `/api/jobs/${body.job.id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().job.status).toBe('queued');
  });

  it('rejects repo paths outside the workspace root', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}-root`);
    const repo = path.join(tmpdir(), `oc-api-root-${Date.now()}-outside`);
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const create = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' }
    });

    expect(create.statusCode).toBe(400);
    expect(create.json().error).toContain('WORKSPACE_ROOT');
  });

  it('cancels a queued job', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });
    const create = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' }
    });
    const jobId = create.json().job.id;

    const cancel = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/cancel` });

    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().job.status).toBe('cancelled');
    expect(cancel.json().job.phase).toBe('cancelled');
    expect(cancel.json().job.finishedAt).toEqual(expect.any(String));
  });

  it('returns 400 for invalid log afterId', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const job = db.createJob({ repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const logs = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}/logs?afterId=abc` });

    expect(logs.statusCode).toBe(400);
  });

  it('rejects commit when persisted repo path is outside the workspace root', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}-root`);
    const repo = path.join(tmpdir(), `oc-api-root-${Date.now()}-outside`);
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const job = db.createJob({ repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    db.updateJob(job.id, { status: 'done', phase: 'done', finishedAt: new Date().toISOString() });
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const commit = await app.inject({ method: 'POST', url: `/api/jobs/${job.id}/commit`, payload: { message: 'save work' } });

    expect(commit.statusCode).toBe(400);
    expect(commit.json().error).toContain('WORKSPACE_ROOT');
    expect(db.listLogs(job.id)).toEqual([]);
  });

  it('retries a done job', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const job = db.createJob({ repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    db.updateJob(job.id, { status: 'done', phase: 'done', finishedAt: new Date().toISOString() });
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const retry = await app.inject({ method: 'POST', url: `/api/jobs/${job.id}/retry` });

    expect(retry.statusCode).toBe(200);
    expect(retry.json().job.status).toBe('queued');
    expect(retry.json().job.phase).toBe('queued');
    expect(retry.json().job.error).toBeNull();
    expect(retry.json().job.startedAt).toBeNull();
    expect(retry.json().job.finishedAt).toBeNull();
  });

  it('clones a done job', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const job = db.createJob({ repoPath: repo, request: 'Original request', maxRounds: 3, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const clone = await app.inject({ method: 'POST', url: `/api/jobs/${job.id}/clone` });

    expect(clone.statusCode).toBe(200);
    expect(clone.json().job.id).not.toBe(job.id);
    expect(clone.json().job.request).toBe('Original request');
    expect(clone.json().job.maxRounds).toBe(3);
    expect(clone.json().job.status).toBe('queued');
    expect(clone.json().job.repoPath).toBe(job.repoPath);
  });

  it('rejects retry for a queued job', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const job = db.createJob({ repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const retry = await app.inject({ method: 'POST', url: `/api/jobs/${job.id}/retry` });

    expect(retry.statusCode).toBe(409);
  });

  it('requests cancellation for a running job', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const job = db.createJob({ repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    db.updateJob(job.id, { status: 'running', phase: 'coding', startedAt: new Date().toISOString() });
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const cancel = await app.inject({ method: 'POST', url: `/api/jobs/${job.id}/cancel` });

    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().job.status).toBe('running');
    expect(cancel.json().job.cancelRequested).toBe(true);
    expect(cancel.json().job.phase).toBe('cancelling');
  });

  it('returns SSE response headers', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const job = db.createJob({ repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });
    const controller = new AbortController();

    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const stream = await fetch(`${address}/api/jobs/${job.id}/stream`, { signal: controller.signal });

      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
    } finally {
      controller.abort();
      await app.close();
    }
  });

  it('lists created jobs', async () => {
    const workspaceRoot = path.join(tmpdir(), `oc-api-root-${Date.now()}`);
    const repo = path.join(workspaceRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    const db = createDb(':memory:');
    const app = buildServer(db, { workspaceRoot, commandTimeoutMs: 1000 });

    const create = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { repoPath: repo, request: 'Do work', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' }
    });

    const list = await app.inject({ method: 'GET', url: '/api/jobs' });

    expect(list.statusCode).toBe(200);
    expect(list.json().jobs).toEqual([create.json().job]);
  });
});
