import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { createDb } from '../shared/db';
import { runCommand as defaultRunCommand, type RunCommandOptions, type RunCommandResult } from '../shared/command';
import { resolveRepoPathUnderRoot } from '../shared/pathSafety';
import type { JobRecord, JobStatus, PlannedTask, TaskRecord } from '../shared/types';
import { ensureOpenCodeConfig } from './opencode';

type AppDb = ReturnType<typeof createDb>;
type CommandRunner = (command: string, args: string[], options: RunCommandOptions) => Promise<RunCommandResult>;

export interface JobRunnerConfig {
  workspaceRoot?: string;
  commandTimeoutMs: number;
}

export interface JobRunnerDeps {
  runCommand?: CommandRunner;
}

class CancelledError extends Error {
  constructor() {
    super('Job cancelled');
  }
}

export async function runJob(db: AppDb, job: JobRecord, config: JobRunnerConfig, deps: JobRunnerDeps = {}) {
  const runCommand = deps.runCommand ?? defaultRunCommand;
  let repoPath: string | null = null;
  let logFilePath = '';
  let finalError: string | null = null;

  try {
    await throwIfCancelled(db, job.id);
    db.updateJob(job.id, { status: 'running', phase: 'validating', startedAt: job.startedAt ?? new Date().toISOString(), error: null });

    const safePath = resolveRepoPathUnderRoot(job.repoPath, config.workspaceRoot);
    if (!safePath.ok) throw new Error(safePath.error);
    repoPath = safePath.path;

    const runDir = path.join(repoPath, '.oc-web', 'runs', job.id);
    logFilePath = path.join(runDir, 'log.txt');
    mkdirSync(runDir, { recursive: true });
    await throwIfCancelled(db, job.id);

    db.updateJob(job.id, { phase: 'git' });
    const status = await runLoggedCommand(db, job.id, null, 'git', runCommand, repoPath, config.commandTimeoutMs, logFilePath, 'git', ['status', '--short']);
    if (status.code !== 0) throw new Error(commandFailureMessage('git status --short', status));

    if (job.branchName) {
      const branch = await runLoggedCommand(
        db,
        job.id,
        null,
        'git',
        runCommand,
        repoPath,
        config.commandTimeoutMs,
        logFilePath,
        'git',
        ['switch', '-c', job.branchName]
      );
      if (branch.code !== 0) throw new Error(commandFailureMessage(`git switch -c ${job.branchName}`, branch));
    }

    const opencodeConfig = ensureOpenCodeConfig(repoPath, {
      plannerModel: job.plannerModel,
      coderModel: job.coderModel,
      reviewerModel: job.reviewerModel
    });
    appendLogLine(logFilePath, 'system', `OpenCode config created: ${opencodeConfig.created.join(', ') || 'none'}`);
    appendLogLine(logFilePath, 'system', `OpenCode config skipped: ${opencodeConfig.skipped.join(', ') || 'none'}`);
    db.addLog(job.id, null, 'git', 'system', `OpenCode config created: ${opencodeConfig.created.join(', ') || 'none'}`);
    db.addLog(job.id, null, 'git', 'system', `OpenCode config skipped: ${opencodeConfig.skipped.join(', ') || 'none'}`);

    db.updateJob(job.id, { phase: 'planning' });
    const planner = await runLoggedCommand(
      db,
      job.id,
      null,
      'planning',
      runCommand,
      repoPath,
      config.commandTimeoutMs,
      logFilePath,
      'opencode',
      ['run', '--agent', 'planner', plannerPrompt(job.request)]
    );
    if (planner.code !== 0) throw new Error(commandFailureMessage('opencode planner', planner));

    const tasks = readPlannedTasks(repoPath, db, job.id, logFilePath);
    const taskRecords = tasks.map((task, index) => db.createTask(job.id, index, task));
    db.upsertArtifact(job.id, null, 'planning_tasks', JSON.stringify(tasks, null, 2));

    for (const task of taskRecords) {
      await runTask(db, job, task, repoPath, config.commandTimeoutMs, logFilePath, runCommand);
    }

    await finalizeJob(db, job, repoPath, config.commandTimeoutMs, logFilePath, runCommand, null);
  } catch (error) {
    if (error instanceof CancelledError) {
      db.updateJob(job.id, { status: 'cancelled', phase: 'cancelled', finishedAt: new Date().toISOString() });
      db.addLog(job.id, null, 'cancelled', 'system', 'Job cancelled');
      return;
    }

    finalError = error instanceof Error ? error.message : String(error);
    db.addLog(job.id, null, db.getJob(job.id)?.phase ?? 'failed', 'system', finalError);
    if (repoPath) {
      await finalizeJob(db, job, repoPath, config.commandTimeoutMs, logFilePath, runCommand, finalError);
    } else {
      db.updateJob(job.id, { status: 'failed', error: finalError, finishedAt: new Date().toISOString() });
    }
  }
}

async function runTask(
  db: AppDb,
  job: JobRecord,
  task: TaskRecord,
  repoPath: string,
  timeoutMs: number,
  logFilePath: string,
  runCommand: CommandRunner
) {
  let feedback = '';

  for (let round = 1; round <= job.maxRounds; round += 1) {
    try {
    await throwIfCancelled(db, job.id);
    db.updateJob(job.id, { phase: 'coding' });
    db.updateTask(task.id, { status: 'running', rounds: round, failureReason: null });

    const coder = await runLoggedCommand(
      db,
      job.id,
      task.id,
      'coding',
      runCommand,
      repoPath,
      timeoutMs,
      logFilePath,
      'opencode',
      ['run', '--agent', 'coder9b', coderPrompt(task, feedback)]
    );
    if (coder.code !== 0) {
      db.updateTask(task.id, { status: 'failed', failureReason: commandFailureMessage('opencode coder9b', coder) });
      return;
    }

    db.updateJob(job.id, { phase: 'verifying' });
    const verify = await runLoggedCommand(
      db,
      job.id,
      task.id,
      'verifying',
      runCommand,
      repoPath,
      timeoutMs,
      logFilePath,
      task.verifyCommand,
      [],
      true
    );

    const diff = await collectGitOutput(db, job.id, task.id, 'git diff', repoPath, timeoutMs, logFilePath, runCommand, ['diff']);
    const changedFiles = await collectGitOutput(db, job.id, task.id, 'git diff --name-only', repoPath, timeoutMs, logFilePath, runCommand, ['diff', '--name-only']);
    db.upsertArtifact(job.id, task.id, 'diff', diff.stdout);
    db.upsertArtifact(job.id, task.id, 'changed_files', changedFiles.stdout);

    db.updateJob(job.id, { phase: 'reviewing' });
    const reviewer = await runLoggedCommand(
      db,
      job.id,
      task.id,
      'reviewing',
      runCommand,
      repoPath,
      timeoutMs,
      logFilePath,
      'opencode',
      ['run', '--agent', 'reviewer', reviewerPrompt(task, verify, diff.stdout, changedFiles.stdout)]
    );
    if (reviewer.code !== 0) {
      db.updateTask(task.id, { status: 'failed', failureReason: commandFailureMessage('opencode reviewer', reviewer) });
      return;
    }

    const reviewOutput = `${reviewer.stdout}\n${reviewer.stderr}`;
    db.updateTask(task.id, { reviewerVerdict: reviewOutput.trim() });
    const verdict = parseReviewerVerdict(reviewOutput);

    if (verdict.type === 'approved') {
      db.updateTask(task.id, { status: 'approved', failureReason: null });
      return;
    }

    if (verdict.type === 'needs_fix') {
      feedback = verdict.feedback;
      if (round < job.maxRounds) {
        db.updateTask(task.id, { status: 'needs_fix', failureReason: feedback });
        continue;
      }
      db.updateTask(task.id, { status: 'failed', failureReason: feedback });
      return;
    }

    db.updateTask(task.id, { status: 'failed', failureReason: `Unexpected reviewer verdict: ${reviewOutput.trim()}` });
    return;
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      db.updateTask(task.id, { status: 'failed', failureReason: message });
      return;
    }
  }
}

function parseReviewerVerdict(output: string): { type: 'approved' } | { type: 'needs_fix'; feedback: string } | { type: 'unknown' } {
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return { type: 'unknown' };

  if (lines[lines.length - 1].trim() === 'APPROVED') return { type: 'approved' };

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line === 'NEEDS_FIX:' || line.startsWith('NEEDS_FIX:')) {
      const sameLineFeedback = line.slice('NEEDS_FIX:'.length).trim();
      const followingFeedback = lines.slice(index + 1).join('\n').trim();
      return { type: 'needs_fix', feedback: [sameLineFeedback, followingFeedback].filter(Boolean).join('\n') };
    }
  }

  return { type: 'unknown' };
}

async function finalizeJob(
  db: AppDb,
  job: JobRecord,
  repoPath: string,
  timeoutMs: number,
  logFilePath: string,
  runCommand: CommandRunner,
  setupError: string | null
) {
  await throwIfCancelled(db, job.id);
  db.updateJob(job.id, { phase: 'finalizing' });

  try {
    const diff = await collectGitOutput(db, job.id, null, 'git diff', repoPath, timeoutMs, logFilePath, runCommand, ['diff']);
    const changedFiles = await collectGitOutput(db, job.id, null, 'git diff --name-only', repoPath, timeoutMs, logFilePath, runCommand, ['diff', '--name-only']);
    db.upsertArtifact(job.id, null, 'diff', diff.stdout);
    db.upsertArtifact(job.id, null, 'changed_files', changedFiles.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.addLog(job.id, null, 'finalizing', 'system', `Final artifact collection failed: ${message}`);
  }

  const tasks = db.listTasks(job.id);
  const approved = tasks.filter((task) => task.status === 'approved').length;
  const failed = tasks.filter((task) => task.status === 'failed').length;
  const status: JobStatus = setupError ? 'failed' : approved === tasks.length && tasks.length > 0 ? 'done' : approved > 0 && failed > 0 ? 'partial' : 'failed';
  const summary = [
    `status: ${status}`,
    `approved_tasks: ${approved}`,
    `failed_tasks: ${failed}`,
    setupError ? `error: ${setupError}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  db.upsertArtifact(job.id, null, 'final_summary', `${summary}\n`);
  db.updateJob(job.id, { status, phase: 'finalizing', error: setupError, finishedAt: new Date().toISOString() });
}

async function collectGitOutput(
  db: AppDb,
  jobId: string,
  taskId: string | null,
  label: string,
  repoPath: string,
  timeoutMs: number,
  logFilePath: string,
  runCommand: CommandRunner,
  args: string[]
) {
  const result = await runLoggedCommand(db, jobId, taskId, 'finalizing', runCommand, repoPath, timeoutMs, logFilePath, 'git', args);
  if (result.code !== 0) db.addLog(jobId, taskId, 'finalizing', 'system', `${label} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function runLoggedCommand(
  db: AppDb,
  jobId: string,
  taskId: string | null,
  phase: string,
  runCommand: CommandRunner,
  cwd: string,
  timeoutMs: number,
  logFilePath: string,
  command: string,
  args: string[],
  shell = false
) {
  await throwIfCancelled(db, jobId);
  const line = `$ ${[command, ...args].join(' ')}`;
  db.addLog(jobId, taskId, phase, 'system', line);
  appendLogLine(logFilePath, 'system', line);
  let streamedStdout = false;
  let streamedStderr = false;
  const result = await runCommand(command, args, {
    cwd,
    timeoutMs,
    shell,
    isCancelled: () => db.getJob(jobId)?.cancelRequested ?? false,
    onStdout: (chunk) => {
      streamedStdout = true;
      db.addLog(jobId, taskId, phase, 'stdout', chunk);
      appendLogLine(logFilePath, 'stdout', chunk);
    },
    onStderr: (chunk) => {
      streamedStderr = true;
      db.addLog(jobId, taskId, phase, 'stderr', chunk);
      appendLogLine(logFilePath, 'stderr', chunk);
    }
  });

  if (result.stdout && !streamedStdout) { db.addLog(jobId, taskId, phase, 'stdout', result.stdout); appendLogLine(logFilePath, 'stdout', result.stdout); }
  if (result.stderr && !streamedStderr) { db.addLog(jobId, taskId, phase, 'stderr', result.stderr); appendLogLine(logFilePath, 'stderr', result.stderr); }
  await throwIfCancelled(db, jobId);
  return result;
}

async function throwIfCancelled(db: AppDb, jobId: string) {
  if (db.getJob(jobId)?.cancelRequested) throw new CancelledError();
}

function appendLogLine(logFilePath: string, stream: string, message: string) {
  if (!logFilePath) return;
  try { appendFileSync(logFilePath, `[${new Date().toISOString()}] [${stream}] ${message}\n`, 'utf8'); } catch { /* ignore file write errors */ }
}

function readPlannedTasks(repoPath: string, db: AppDb, jobId: string, logFilePath: string): PlannedTask[] {
  try {
    const tasksMd = readFileSync(path.join(repoPath, 'TASKS.md'), 'utf8');
    db.upsertArtifact(jobId, null, 'TASKS_md', tasksMd);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    db.addLog(jobId, null, 'planning', 'system', `Could not read TASKS.md: ${msg}`);
    appendLogLine(logFilePath, 'system', `Could not read TASKS.md: ${msg}`);
  }
  const parsed = JSON.parse(readFileSync(path.join(repoPath, 'tasks.json'), 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('tasks.json must be an array');

  return parsed.map((task, index) => {
    if (!isPlannedTask(task)) throw new Error(`tasks.json item ${index} must include title, prompt, and verify strings`);
    return task;
  });
}

function isPlannedTask(value: unknown): value is PlannedTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  return typeof task.title === 'string' && typeof task.prompt === 'string' && typeof task.verify === 'string' &&
    task.title.trim() !== '' && task.prompt.trim() !== '' && task.verify.trim() !== '';
}

function plannerPrompt(request: string) {
  return `Original user request:\n${request}\n\nCreate TASKS.md and tasks.json in the repository root. tasks.json must be a JSON array of objects with title, prompt, and verify fields.`;
}

function coderPrompt(task: TaskRecord, feedback: string) {
  return [
    `Task: ${task.title}`,
    '',
    task.prompt,
    '',
    `Verification command: ${task.verifyCommand}`,
    feedback ? `\nReviewer feedback to address:\n${feedback}` : ''
  ].join('\n');
}

function reviewerPrompt(task: TaskRecord, verify: RunCommandResult, diff: string, changedFiles: string) {
  return [
    `Review task: ${task.title}`,
    '',
    `Task prompt:\n${task.prompt}`,
    '',
    `Verify command: ${task.verifyCommand}`,
    `Verify exit code: ${verify.code}`,
    `Verify stdout:\n${verify.stdout}`,
    `Verify stderr:\n${verify.stderr}`,
    '',
    `Changed files:\n${changedFiles}`,
    '',
    `Diff:\n${diff}`,
    '',
    'Return APPROVED if the task is complete, otherwise return NEEDS_FIX: followed by specific fix instructions.'
  ].join('\n');
}

function commandFailureMessage(label: string, result: RunCommandResult) {
  return `${label} failed with exit code ${result.code}${result.timedOut ? ' (timed out)' : ''}: ${result.stderr || result.stdout}`;
}
