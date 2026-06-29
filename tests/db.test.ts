import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';

function tempDbPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'oc-db-')), 'test.db');
}

describe('database', () => {
  it('creates and claims a queued job', () => {
    const db = createDb(tempDbPath());
    const job = db.createJob({
      repoPath: '/workspace/repo',
      request: 'Add tests',
      branchName: '',
      maxRounds: 2,
      plannerModel: 'openai/gpt-4.1',
      coderModel: 'ollama/qwen3-coder:9b',
      reviewerModel: 'openai/gpt-4.1'
    });

    const claimed = db.claimNextJob();

    expect(claimed?.id).toBe(job.id);
    expect(db.getJob(job.id)?.status).toBe('running');
  });

  it('stores tasks, logs, and artifacts', () => {
    const db = createDb(tempDbPath());
    const job = db.createJob({ repoPath: '/repo', request: 'x', branchName: '', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    const task = db.createTask(job.id, 0, { title: 'Task A', prompt: 'Do A', verify: 'npm test' });
    db.addLog(job.id, task.id, 'coding', 'stdout', 'hello');
    db.upsertArtifact(job.id, task.id, 'diff', 'diff --git');

    expect(db.listTasks(job.id)).toHaveLength(1);
    expect(db.listLogs(job.id, 0)).toHaveLength(1);
    expect(db.listArtifacts(job.id).find((a) => a.name === 'diff')?.content).toBe('diff --git');
  });

  it('creates indexes for database access patterns', () => {
    const dbPath = tempDbPath();
    const db = createDb(dbPath);
    db.close();

    const raw = new Database(dbPath, { readonly: true });
    const indexes = raw.prepare<string[], { name: string }>('SELECT name FROM sqlite_master WHERE type = ?').all('index').map((row) => row.name);
    raw.close();

    expect(indexes).toEqual(expect.arrayContaining([
      'idx_jobs_status_created_at',
      'idx_tasks_job_id_task_index',
      'idx_job_logs_job_id_id',
      'idx_job_artifacts_job_id_created_at',
      'idx_job_artifacts_unique_logical_name'
    ]));
  });

  it('lists logs after a cursor in id ascending order', () => {
    const db = createDb(tempDbPath());
    const job = db.createJob({ repoPath: '/repo', request: 'x', branchName: '', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    db.addLog(job.id, null, 'planning', 'system', 'first');
    const second = db.addLog(job.id, null, 'planning', 'stdout', 'second');
    const third = db.addLog(job.id, null, 'coding', 'stderr', 'third');

    const logs = db.listLogs(job.id, second.id - 1);

    expect(logs.map((log) => log.id)).toEqual([second.id, third.id]);
    expect(logs.map((log) => log.message)).toEqual(['second', 'third']);
  });

  it('replaces artifact content for the same job, task, and name', () => {
    const db = createDb(tempDbPath());
    const job = db.createJob({ repoPath: '/repo', request: 'x', branchName: '', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    const task = db.createTask(job.id, 0, { title: 'Task A', prompt: 'Do A', verify: 'npm test' });

    db.upsertArtifact(job.id, task.id, 'diff', 'old diff');
    const updated = db.upsertArtifact(job.id, task.id, 'diff', 'new diff');
    const artifacts = db.listArtifacts(job.id).filter((artifact) => artifact.name === 'diff');

    expect(updated.content).toBe('new diff');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.content).toBe('new diff');
  });

  it('updates jobs and tasks and returns current records', () => {
    const db = createDb(tempDbPath());
    const job = db.createJob({ repoPath: '/repo', request: 'x', branchName: '', maxRounds: 1, plannerModel: 'p', coderModel: 'c', reviewerModel: 'r' });
    const task = db.createTask(job.id, 0, { title: 'Task A', prompt: 'Do A', verify: 'npm test' });

    const updatedJob = db.updateJob(job.id, { status: 'failed', phase: 'reviewing', error: 'boom', cancelRequested: true });
    const updatedTask = db.updateTask(task.id, { status: 'needs_fix', rounds: 2, reviewerVerdict: 'changes_requested', failureReason: 'missing tests' });

    expect(updatedJob).toMatchObject({ status: 'failed', phase: 'reviewing', error: 'boom', cancelRequested: true });
    expect(db.getJob(job.id)).toMatchObject({ status: 'failed', phase: 'reviewing', error: 'boom', cancelRequested: true });
    expect(updatedTask).toMatchObject({ status: 'needs_fix', rounds: 2, reviewerVerdict: 'changes_requested', failureReason: 'missing tests' });
    expect(db.listTasks(job.id)[0]).toMatchObject({ status: 'needs_fix', rounds: 2, reviewerVerdict: 'changes_requested', failureReason: 'missing tests' });
  });
});
