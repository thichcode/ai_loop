import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/shared/db';
import type { RunCommandOptions, RunCommandResult } from '../src/shared/command';
import { runJob } from '../src/worker/jobRunner';

type TestDb = ReturnType<typeof createDb>;
type CommandCall = { command: string; args: string[]; options: RunCommandOptions };
type ReviewerOutput = string | RunCommandResult;

const models = {
  plannerModel: 'planner/model',
  coderModel: 'coder/model',
  reviewerModel: 'reviewer/model'
};

function makeWorkspace() {
  const workspaceRoot = path.join(tmpdir(), `oc-worker-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const repoPath = path.join(workspaceRoot, 'repo');
  mkdirSync(repoPath, { recursive: true });
  return { workspaceRoot, repoPath };
}

function makeDb() {
  const dbPath = path.join(tmpdir(), `oc-worker-db-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  return createDb(dbPath);
}

function makeJob(db: TestDb, repoPath: string, overrides: Partial<Parameters<TestDb['createJob']>[0]> = {}) {
  return db.createJob({
    repoPath,
    request: 'Add the orchestrated feature',
    branchName: '',
    maxRounds: 2,
    ...models,
    ...overrides
  });
}

function ok(stdout = '', stderr = ''): RunCommandResult {
  return { code: 0, signal: null, timedOut: false, stdout, stderr };
}

function failing(stderr = 'failed'): RunCommandResult {
  return { code: 1, signal: null, timedOut: false, stdout: '', stderr };
}

function makeFakeRunner(repoPath: string, reviewerOutputs: ReviewerOutput[], plannedTasks: unknown = defaultPlannedTasks()) {
  const calls: CommandCall[] = [];

  const runCommand = async (command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> => {
    calls.push({ command, args, options });

    if (command === 'git' && args.join(' ') === 'status --short') {
      return ok(' M src/file.ts\n', 'status warning\n');
    }

    if (command === 'opencode' && args.includes('planner')) {
      const prompt = args.at(-1) ?? '';
      expect(prompt).toContain('Add the orchestrated feature');
      expect(prompt).toContain('TASKS.md');
      expect(prompt).toContain('tasks.json');
      writeFileSync(path.join(repoPath, 'TASKS.md'), '# Plan\n\n- Do the work\n');
      writeFileSync(path.join(repoPath, 'tasks.json'), JSON.stringify(plannedTasks));
      return ok('planned\n');
    }

    if (command === 'opencode' && args.includes('coder9b')) {
      return ok('coded\n');
    }

    if (command === 'npm test -- feature.test.ts') {
      expect(options.shell).toBe(true);
      return ok('verified\n');
    }

    if (command === 'git' && args.join(' ') === 'diff') {
      return ok('diff --git a/src/file.ts b/src/file.ts\n');
    }

    if (command === 'git' && args.join(' ') === 'diff --name-only') {
      return ok('src/file.ts\n');
    }

    if (command === 'opencode' && args.includes('reviewer')) {
      const output = reviewerOutputs.shift() ?? 'APPROVED';
      return typeof output === 'string' ? ok(`${output}\n`) : output;
    }

    return failing(`unexpected command: ${command} ${args.join(' ')}`);
  };

  return { calls, runCommand };
}

function defaultPlannedTasks() {
  return [{ title: 'Implement feature', prompt: 'Do the work', verify: 'npm test -- feature.test.ts' }];
}

describe('runJob', () => {
  it('plans, codes, verifies, reviews, and finalizes an approved job', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    const fake = makeFakeRunner(repoPath, ['APPROVED']);

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand: fake.runCommand });

    const storedJob = db.getJob(job.id);
    const tasks = db.listTasks(job.id);
    const logs = db.listLogs(job.id, 0, 1000);
    const artifacts = db.listArtifacts(job.id);

    expect(storedJob).toMatchObject({ status: 'done', phase: 'finalizing', error: null });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Implement feature', status: 'approved', rounds: 1 });
    expect(logs.map((log) => log.stream)).toEqual(expect.arrayContaining(['stdout', 'stderr', 'system']));
    expect(logs.map((log) => log.message).join('\n')).toContain('status warning');
    expect(artifacts.map((artifact) => artifact.name)).toEqual(expect.arrayContaining(['diff', 'changed_files', 'final_summary']));
    expect(artifacts.find((artifact) => artifact.name === 'changed_files')?.content).toBe('src/file.ts\n');
    expect(fake.calls.some((call) => call.command === 'opencode' && call.args.includes('planner'))).toBe(true);
    expect(fake.calls.some((call) => call.command === 'opencode' && call.args.includes('coder9b'))).toBe(true);
    expect(fake.calls.some((call) => call.command === 'opencode' && call.args.includes('reviewer'))).toBe(true);
    expect(readFileSync(path.join(repoPath, '.opencode', 'opencode.json'), 'utf8')).toContain('planner/model');
  });

  it('passes reviewer feedback into a second coder round before approval', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    const fake = makeFakeRunner(repoPath, ['NEEDS_FIX:\nAdd the missing assertion', 'APPROVED']);

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand: fake.runCommand });

    const task = db.listTasks(job.id)[0];
    const coderPrompts = fake.calls
      .filter((call) => call.command === 'opencode' && call.args.includes('coder9b'))
      .map((call) => call.args.at(-1) ?? '');

    expect(db.getJob(job.id)?.status).toBe('done');
    expect(task).toMatchObject({ status: 'approved', rounds: 2 });
    expect(coderPrompts[1]).toContain('Add the missing assertion');
  });

  it('logs command progress when a command stays silent', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    const fake = makeFakeRunner(repoPath, ['APPROVED']);
    const runCommand = async (command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> => {
      if (command === 'opencode' && args.includes('planner')) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return fake.runCommand(command, args, options);
    };

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000, commandProgressIntervalMs: 5 }, { runCommand });

    const logText = db.listLogs(job.id, 0, 1000).map((log) => log.message).join('\n');
    expect(logText).toContain('Still running: opencode run --agent planner');
  });

  it.each(['UNAPPROVED', 'This is not APPROVED'])('does not approve reviewer output %j', async (reviewerOutput) => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath, { maxRounds: 1 });
    const fake = makeFakeRunner(repoPath, [reviewerOutput]);

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand: fake.runCommand });

    expect(db.getJob(job.id)?.status).toBe('failed');
    expect(db.listTasks(job.id)[0]).toMatchObject({ status: 'failed', rounds: 1 });
  });

  it('does not approve when reviewer exits non-zero even if stdout says approved', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath, { maxRounds: 1 });
    const fake = makeFakeRunner(repoPath, [{ ...ok('APPROVED\n'), code: 1 }]);

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand: fake.runCommand });

    expect(db.getJob(job.id)?.status).toBe('failed');
    expect(db.listTasks(job.id)[0]).toMatchObject({ status: 'failed', rounds: 1 });
  });

  it('preserves the original planning error if final artifact collection fails', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    const fake = makeFakeRunner(repoPath, ['APPROVED']);
    const runCommand = async (command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> => {
      if (command === 'opencode' && args.includes('planner')) return failing('planner failed');
      if (command === 'git' && args.join(' ') === 'diff') throw new Error('final diff exploded');
      return fake.runCommand(command, args, options);
    };

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand });

    const storedJob = db.getJob(job.id);
    expect(storedJob).toMatchObject({ status: 'failed', error: expect.stringContaining('planner failed') });
    expect(db.listLogs(job.id, 0, 1000).map((log) => log.message).join('\n')).toContain('final diff exploded');
  });

  it('marks the running task failed when an unexpected task command error occurs', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    const fake = makeFakeRunner(repoPath, ['APPROVED']);
    const runCommand = async (command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> => {
      if (command === 'npm test -- feature.test.ts') throw new Error('verify exploded');
      return fake.runCommand(command, args, options);
    };

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand });

    expect(db.getJob(job.id)?.status).toBe('failed');
    expect(db.listTasks(job.id)[0]).toMatchObject({ status: 'failed', failureReason: expect.stringContaining('verify exploded') });
  });

  it.each([
    ['title', { title: ' ', prompt: 'Do the work', verify: 'npm test -- feature.test.ts' }],
    ['prompt', { title: 'Implement feature', prompt: ' ', verify: 'npm test -- feature.test.ts' }],
    ['verify', { title: 'Implement feature', prompt: 'Do the work', verify: ' ' }]
  ])('fails planning without inserting tasks when tasks.json has a blank %s', async (_field, plannedTask) => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    const fake = makeFakeRunner(repoPath, ['APPROVED'], [plannedTask]);

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand: fake.runCommand });

    expect(db.getJob(job.id)).toMatchObject({ status: 'failed', phase: 'finalizing' });
    expect(db.getJob(job.id)?.error).toContain('tasks.json item 0');
    expect(db.listTasks(job.id)).toHaveLength(0);
  });

  it('sets the job cancelled when cancellation is requested during command execution', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    const fake = makeFakeRunner(repoPath, ['APPROVED']);
    const runCommand = async (command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> => {
      if (command === 'opencode' && args.includes('coder9b')) {
        db.updateJob(job.id, { cancelRequested: true });
        expect(options.isCancelled?.()).toBe(true);
        return ok('stopped\n');
      }
      return fake.runCommand(command, args, options);
    };

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand });

    expect(db.getJob(job.id)).toMatchObject({ status: 'cancelled', phase: 'cancelled' });
  });

  it('fails when the repository path is outside the workspace root', async () => {
    const { workspaceRoot } = makeWorkspace();
    const outsideRepo = path.join(tmpdir(), `oc-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(outsideRepo, { recursive: true });
    const db = makeDb();
    const job = makeJob(db, outsideRepo);
    const fake = makeFakeRunner(outsideRepo, ['APPROVED']);

    await runJob(db, job, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand: fake.runCommand });

    expect(db.getJob(job.id)).toMatchObject({ status: 'failed', phase: 'validating' });
    expect(db.getJob(job.id)?.error).toContain('WORKSPACE_ROOT');
    expect(fake.calls).toHaveLength(0);
  });

  it('sets the job cancelled when cancellation was requested before work starts', async () => {
    const { workspaceRoot, repoPath } = makeWorkspace();
    const db = makeDb();
    const job = makeJob(db, repoPath);
    db.updateJob(job.id, { cancelRequested: true });
    const fake = makeFakeRunner(repoPath, ['APPROVED']);

    await runJob(db, db.getJob(job.id)!, { workspaceRoot, commandTimeoutMs: 1000 }, { runCommand: fake.runCommand });

    expect(db.getJob(job.id)).toMatchObject({ status: 'cancelled', phase: 'cancelled' });
    expect(fake.calls).toHaveLength(0);
  });
});
