import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  CreateJobInput,
  JobArtifactRecord,
  JobLogRecord,
  JobRecord,
  LogStream,
  PlannedTask,
  TaskRecord
} from './types';

interface JobRow {
  id: string;
  repo_path: string;
  request: string;
  branch_name: string;
  max_rounds: number;
  planner_model: string;
  coder_model: string;
  reviewer_model: string;
  status: JobRecord['status'];
  phase: string;
  cancel_requested: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface TaskRow {
  id: string;
  job_id: string;
  task_index: number;
  title: string;
  prompt: string;
  verify_command: string;
  status: TaskRecord['status'];
  rounds: number;
  reviewer_verdict: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface JobLogRow {
  id: number;
  job_id: string;
  task_id: string | null;
  phase: string;
  stream: LogStream;
  message: string;
  created_at: string;
}

interface JobArtifactRow {
  id: number;
  job_id: string;
  task_id: string | null;
  name: string;
  content: string;
  created_at: string;
}

export function createDb(databasePath: string) {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  runMigrations(db);

  function getJob(id: string): JobRecord | null {
    const row = db.prepare<string[], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? mapJob(row) : null;
  }

  function getTask(id: string): TaskRecord | null {
    const row = db.prepare<string[], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? mapTask(row) : null;
  }

  function getArtifact(id: number): JobArtifactRecord | null {
    const row = db.prepare<[number], JobArtifactRow>('SELECT * FROM job_artifacts WHERE id = ?').get(id);
    return row ? mapArtifact(row) : null;
  }

  return {
    createJob(input: CreateJobInput): JobRecord {
      const now = new Date().toISOString();
      const id = randomUUID();

      db.prepare(`
        INSERT INTO jobs (
          id, repo_path, request, branch_name, max_rounds, planner_model, coder_model, reviewer_model,
          status, phase, cancel_requested, error, created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.repoPath,
        input.request,
        input.branchName ?? '',
        input.maxRounds,
        input.plannerModel,
        input.coderModel,
        input.reviewerModel,
        'queued',
        'queued',
        0,
        null,
        now,
        now,
        null,
        null
      );

      const job = getJob(id);
      if (!job) throw new Error('Failed to create job');
      return job;
    },

    claimNextJob(): JobRecord | null {
      const claim = db.transaction(() => {
        const row = db
          .prepare<[], Pick<JobRow, 'id'>>(
            "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1"
          )
          .get();
        if (!row) return null;

        const now = new Date().toISOString();
        db.prepare("UPDATE jobs SET status = 'running', phase = 'starting', started_at = ?, updated_at = ? WHERE id = ?")
          .run(now, now, row.id);
        return getJob(row.id);
      });

      return claim();
    },

    getJob,

    listJobs(limit = 100): JobRecord[] {
      return db
        .prepare<[number], JobRow>('SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit)
        .map(mapJob);
    },

    updateJob(
      id: string,
      patch: Partial<Pick<JobRecord, 'status' | 'phase' | 'error' | 'startedAt' | 'finishedAt' | 'cancelRequested'>>
    ): JobRecord | null {
      const fields: string[] = [];
      const values: unknown[] = [];
      const now = new Date().toISOString();

      if (patch.status !== undefined) {
        fields.push('status = ?');
        values.push(patch.status);
      }
      if (patch.phase !== undefined) {
        fields.push('phase = ?');
        values.push(patch.phase);
      }
      if (patch.error !== undefined) {
        fields.push('error = ?');
        values.push(patch.error);
      }
      if (patch.startedAt !== undefined) {
        fields.push('started_at = ?');
        values.push(patch.startedAt);
      }
      if (patch.finishedAt !== undefined) {
        fields.push('finished_at = ?');
        values.push(patch.finishedAt);
      }
      if (patch.cancelRequested !== undefined) {
        fields.push('cancel_requested = ?');
        values.push(patch.cancelRequested ? 1 : 0);
      }

      if (fields.length === 0) return getJob(id);

      fields.push('updated_at = ?');
      values.push(now, id);
      db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return getJob(id);
    },

    createTask(jobId: string, taskIndex: number, task: PlannedTask): TaskRecord {
      const now = new Date().toISOString();
      const id = randomUUID();

      db.prepare(`
        INSERT INTO tasks (
          id, job_id, task_index, title, prompt, verify_command, status, rounds,
          reviewer_verdict, failure_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, jobId, taskIndex, task.title, task.prompt, task.verify, 'pending', 0, null, null, now, now);

      const record = getTask(id);
      if (!record) throw new Error('Failed to create task');
      return record;
    },

    listTasks(jobId: string): TaskRecord[] {
      return db
        .prepare<string[], TaskRow>('SELECT * FROM tasks WHERE job_id = ? ORDER BY task_index ASC')
        .all(jobId)
        .map(mapTask);
    },

    updateTask(
      id: string,
      patch: Partial<Pick<TaskRecord, 'status' | 'rounds' | 'reviewerVerdict' | 'failureReason'>>
    ): TaskRecord | null {
      const fields: string[] = [];
      const values: unknown[] = [];
      const now = new Date().toISOString();

      if (patch.status !== undefined) {
        fields.push('status = ?');
        values.push(patch.status);
      }
      if (patch.rounds !== undefined) {
        fields.push('rounds = ?');
        values.push(patch.rounds);
      }
      if (patch.reviewerVerdict !== undefined) {
        fields.push('reviewer_verdict = ?');
        values.push(patch.reviewerVerdict);
      }
      if (patch.failureReason !== undefined) {
        fields.push('failure_reason = ?');
        values.push(patch.failureReason);
      }

      if (fields.length === 0) return getTask(id);

      fields.push('updated_at = ?');
      values.push(now, id);
      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return getTask(id);
    },

    addLog(jobId: string, taskId: string | null, phase: string, stream: LogStream, message: string): JobLogRecord {
      const createdAt = new Date().toISOString();
      const result = db
        .prepare('INSERT INTO job_logs (job_id, task_id, phase, stream, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(jobId, taskId, phase, stream, message, createdAt);
      const row = db.prepare<[number], JobLogRow>('SELECT * FROM job_logs WHERE id = ?').get(Number(result.lastInsertRowid));
      if (!row) throw new Error('Failed to create log');
      return mapLog(row);
    },

    listLogs(jobId: string, afterId = 0, limit = 200): JobLogRecord[] {
      return db
        .prepare<[string, number, number], JobLogRow>('SELECT * FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
        .all(jobId, afterId, limit)
        .map(mapLog);
    },

    upsertArtifact(jobId: string, taskId: string | null, name: string, content: string): JobArtifactRecord {
      const existing = db
        .prepare<[string, string | null, string | null, string], Pick<JobArtifactRow, 'id'>>(
          'SELECT id FROM job_artifacts WHERE job_id = ? AND ((task_id IS NULL AND ? IS NULL) OR task_id = ?) AND name = ? LIMIT 1'
        )
        .get(jobId, taskId, taskId, name);
      const createdAt = new Date().toISOString();

      if (existing) {
        db.prepare('UPDATE job_artifacts SET content = ?, created_at = ? WHERE id = ?').run(content, createdAt, existing.id);
        const artifact = getArtifact(existing.id);
        if (!artifact) throw new Error('Failed to update artifact');
        return artifact;
      }

      const result = db
        .prepare('INSERT INTO job_artifacts (job_id, task_id, name, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(jobId, taskId, name, content, createdAt);
      const artifact = getArtifact(Number(result.lastInsertRowid));
      if (!artifact) throw new Error('Failed to create artifact');
      return artifact;
    },

    listArtifacts(jobId: string): JobArtifactRecord[] {
      return db
        .prepare<string[], JobArtifactRow>('SELECT * FROM job_artifacts WHERE job_id = ? ORDER BY created_at DESC, id DESC')
        .all(jobId)
        .map(mapArtifact);
    },

    close(): void {
      db.close();
    }
  };
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      request TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      max_rounds INTEGER NOT NULL,
      planner_model TEXT NOT NULL,
      coder_model TEXT NOT NULL,
      reviewer_model TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      cancel_requested INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      task_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      verify_command TEXT NOT NULL,
      status TEXT NOT NULL,
      rounds INTEGER NOT NULL,
      reviewer_verdict TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      phase TEXT NOT NULL,
      stream TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs(status, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_tasks_job_id_task_index ON tasks(job_id, task_index);
    CREATE INDEX IF NOT EXISTS idx_job_logs_job_id_id ON job_logs(job_id, id);
    CREATE INDEX IF NOT EXISTS idx_job_artifacts_job_id_created_at ON job_artifacts(job_id, created_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_artifacts_unique_logical_name ON job_artifacts(job_id, ifnull(task_id, ''), name);
  `);
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    repoPath: row.repo_path,
    request: row.request,
    branchName: row.branch_name,
    maxRounds: row.max_rounds,
    plannerModel: row.planner_model,
    coderModel: row.coder_model,
    reviewerModel: row.reviewer_model,
    status: row.status,
    phase: row.phase,
    cancelRequested: row.cancel_requested === 1,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    taskIndex: row.task_index,
    title: row.title,
    prompt: row.prompt,
    verifyCommand: row.verify_command,
    status: row.status,
    rounds: row.rounds,
    reviewerVerdict: row.reviewer_verdict,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLog(row: JobLogRow): JobLogRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    taskId: row.task_id,
    phase: row.phase,
    stream: row.stream,
    message: row.message,
    createdAt: row.created_at
  };
}

function mapArtifact(row: JobArtifactRow): JobArtifactRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    taskId: row.task_id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at
  };
}
