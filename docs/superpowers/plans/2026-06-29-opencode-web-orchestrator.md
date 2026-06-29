# OpenCode Web Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working web app that queues coding jobs and orchestrates OpenCode CLI planner, coder, verifier, reviewer, retries, logs, diffs, cancellation, and optional commit.

**Architecture:** Single TypeScript package. Fastify serves the API and built React app; a separate worker process polls SQLite and runs OpenCode CLI through `child_process.spawn`; React uses REST plus SSE for live status.

**Tech Stack:** TypeScript, Node.js, Fastify, React, Vite, better-sqlite3, Server-Sent Events, child_process.spawn, Vitest.

---

## File Structure

- Create `package.json`: npm scripts and dependencies.
- Create `tsconfig.json`: shared TypeScript settings.
- Create `vite.config.ts`: Vite dev/build config for React.
- Create `index.html`: Vite frontend entry HTML.
- Create `src/shared/types.ts`: shared job, task, log, artifact, API payload, and status types.
- Create `src/shared/config.ts`: environment parsing, defaults, workspace root validation.
- Create `src/shared/db.ts`: SQLite connection, migrations, typed queries, queue claiming, log/artifact helpers.
- Create `src/shared/pathSafety.ts`: safe path resolution under `WORKSPACE_ROOT`.
- Create `src/shared/command.ts`: cross-platform process runner with timeout, streaming, cancellation hook, and shell/non-shell support.
- Create `src/server/index.ts`: Fastify app, API routes, SSE, static file serving.
- Create `src/server/routes.ts`: route registration kept separate from server bootstrap.
- Create `src/worker/index.ts`: polling loop and graceful shutdown.
- Create `src/worker/jobRunner.ts`: job lifecycle orchestration.
- Create `src/worker/opencode.ts`: OpenCode config generation and planner/coder/reviewer command helpers.
- Create `src/scripts/init-opencode.ts`: generates `.opencode` config and prompt files.
- Create `src/client/main.tsx`: React app bootstrap.
- Create `src/client/App.tsx`: router shell.
- Create `src/client/api.ts`: REST and SSE client helpers.
- Create `src/client/styles.css`: responsive practical UI.
- Create `src/client/pages/JobsList.tsx`: recent jobs page.
- Create `src/client/pages/NewJob.tsx`: job submission page.
- Create `src/client/pages/JobDetail.tsx`: live job detail page.
- Create `src/client/components/StatusBadge.tsx`: shared status badge.
- Create `src/client/components/LogViewer.tsx`: live logs.
- Create `src/client/components/DiffViewer.tsx`: diff display.
- Create `tests/pathSafety.test.ts`: workspace path validation tests.
- Create `tests/db.test.ts`: migration, job creation, queue claiming, task/log/artifact tests.
- Create `tests/api.test.ts`: Fastify API smoke tests.
- Create `README.md`: setup, scripts, safety, OpenCode requirements, usage.

## Task 1: Project Scaffold and Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `.gitignore`

- [ ] **Step 1: Create npm package and scripts**

Create `package.json` with this content:

```json
{
  "name": "opencode-web-orchestrator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \"tsx watch src/server/index.ts\" \"vite --host 0.0.0.0\"",
    "build": "tsc --noEmit && vite build && esbuild src/server/index.ts src/worker/index.ts src/scripts/init-opencode.ts --bundle --platform=node --format=esm --outdir=dist/node --packages=external",
    "start": "node dist/node/index.js",
    "worker": "tsx src/worker/index.ts",
    "init-opencode": "tsx src/scripts/init-opencode.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/static": "latest",
    "@vitejs/plugin-react": "latest",
    "better-sqlite3": "latest",
    "fastify": "latest",
    "react": "latest",
    "react-dom": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "concurrently": "latest",
    "esbuild": "latest",
    "jsdom": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 3: Create Vite config and HTML shell**

Create `vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenCode Web Orchestrator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create ignore rules**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.env
*.db
*.db-shm
*.db-wal
.oc-web/
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

Expected: `node_modules` is created and `package-lock.json` is written.

- [ ] **Step 6: Run initial build check**

Run: `npm run build`

Expected: fails because source entry files do not exist yet. This confirms scripts are wired and ready for later tasks.

## Task 2: Shared Types, Config, Path Safety, and Tests

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/config.ts`
- Create: `src/shared/pathSafety.ts`
- Create: `tests/pathSafety.test.ts`

- [ ] **Step 1: Write path safety tests first**

Create `tests/pathSafety.test.ts`:

```ts
import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRepoPathUnderRoot } from '../src/shared/pathSafety';

describe('resolveRepoPathUnderRoot', () => {
  it('allows paths inside the workspace root', () => {
    const root = path.join(tmpdir(), `oc-root-${Date.now()}`);
    const repo = path.join(root, 'repo');
    mkdirSync(repo, { recursive: true });

    const result = resolveRepoPathUnderRoot(repo, root);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(realpathSync(repo));
  });

  it('rejects paths outside the workspace root', () => {
    const root = path.join(tmpdir(), `oc-root-${Date.now()}`);
    const outside = path.join(tmpdir(), `oc-outside-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });

    const result = resolveRepoPathUnderRoot(outside, root);

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/pathSafety.test.ts`

Expected: FAIL because `src/shared/pathSafety.ts` does not exist.

- [ ] **Step 3: Add shared types**

Create `src/shared/types.ts`:

```ts
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'partial' | 'cancelled';
export type TaskStatus = 'pending' | 'running' | 'approved' | 'needs_fix' | 'failed' | 'cancelled';
export type LogStream = 'stdout' | 'stderr' | 'system';

export interface CreateJobInput {
  repoPath: string;
  request: string;
  branchName?: string;
  maxRounds: number;
  plannerModel: string;
  coderModel: string;
  reviewerModel: string;
}

export interface JobRecord extends CreateJobInput {
  id: string;
  status: JobStatus;
  phase: string;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskRecord {
  id: string;
  jobId: string;
  taskIndex: number;
  title: string;
  prompt: string;
  verifyCommand: string;
  status: TaskStatus;
  rounds: number;
  reviewerVerdict: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobLogRecord {
  id: number;
  jobId: string;
  taskId: string | null;
  phase: string;
  stream: LogStream;
  message: string;
  createdAt: string;
}

export interface JobArtifactRecord {
  id: number;
  jobId: string;
  taskId: string | null;
  name: string;
  content: string;
  createdAt: string;
}

export interface PlannedTask {
  title: string;
  prompt: string;
  verify: string;
}
```

- [ ] **Step 4: Add config parser**

Create `src/shared/config.ts`:

```ts
import path from 'node:path';

export interface AppConfig {
  port: number;
  databasePath: string;
  workspaceRoot: string;
  commandTimeoutMs: number;
  pollIntervalMs: number;
}

export function loadConfig(env = process.env): AppConfig {
  if (!env.WORKSPACE_ROOT) {
    throw new Error('WORKSPACE_ROOT is required');
  }

  return {
    port: Number(env.PORT ?? 3000),
    databasePath: path.resolve(env.DATABASE_PATH ?? '.oc-web/orchestrator.db'),
    workspaceRoot: path.resolve(env.WORKSPACE_ROOT),
    commandTimeoutMs: Number(env.COMMAND_TIMEOUT_MS ?? 30 * 60 * 1000),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 1000)
  };
}
```

- [ ] **Step 5: Add path safety implementation**

Create `src/shared/pathSafety.ts`:

```ts
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export type SafePathResult = { ok: true; path: string } | { ok: false; error: string };

export function resolveRepoPathUnderRoot(repoPath: string, workspaceRoot: string): SafePathResult {
  if (!repoPath.trim()) return { ok: false, error: 'Repository path is required' };
  if (!existsSync(repoPath)) return { ok: false, error: 'Repository path does not exist' };
  if (!existsSync(workspaceRoot)) return { ok: false, error: 'WORKSPACE_ROOT does not exist' };

  const repoReal = realpathSync(repoPath);
  const rootReal = realpathSync(workspaceRoot);
  if (!statSync(repoReal).isDirectory()) return { ok: false, error: 'Repository path is not a directory' };

  const relative = path.relative(rootReal, repoReal);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return { ok: true, path: repoReal };
  }

  return { ok: false, error: 'Repository path must be under WORKSPACE_ROOT' };
}
```

- [ ] **Step 6: Run path safety tests**

Run: `npm test -- tests/pathSafety.test.ts`

Expected: PASS.

## Task 3: SQLite Database Layer and Tests

**Files:**
- Create: `src/shared/db.ts`
- Create: `tests/db.test.ts`

- [ ] **Step 1: Write database behavior tests**

Create `tests/db.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db.test.ts`

Expected: FAIL because `src/shared/db.ts` does not exist.

- [ ] **Step 3: Implement SQLite module**

Create `src/shared/db.ts` with migrations, row mapping, and these exported methods: `createDb`, `createJob`, `claimNextJob`, `getJob`, `listJobs`, `updateJob`, `createTask`, `listTasks`, `updateTask`, `addLog`, `listLogs`, `upsertArtifact`, `listArtifacts`, and `close`.

Use table columns matching `src/shared/types.ts`, store booleans as `0`/`1`, and generate IDs with `crypto.randomUUID()`.

- [ ] **Step 4: Run database tests**

Run: `npm test -- tests/db.test.ts`

Expected: PASS.

## Task 4: Command Runner

**Files:**
- Create: `src/shared/command.ts`

- [ ] **Step 1: Implement process runner**

Create `src/shared/command.ts`:

```ts
import { spawn } from 'node:child_process';

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  shell?: boolean;
  isCancelled?: () => boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      windowsHide: true,
      env: process.env
    });

    const finish = (result: RunCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(cancelCheck);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    const cancelCheck = setInterval(() => {
      if (options.isCancelled?.()) child.kill('SIGTERM');
    }, 500);

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on('error', (error) => {
      stderr += error.message;
      finish({ code: 1, signal: null, timedOut, stdout, stderr });
    });

    child.on('close', (code, signal) => {
      finish({ code, signal, timedOut, stdout, stderr });
    });
  });
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: PASS after Task 3 implementation is type-correct.

## Task 5: Fastify API and SSE

**Files:**
- Create: `src/server/index.ts`
- Create: `src/server/routes.ts`
- Create: `tests/api.test.ts`

- [ ] **Step 1: Write API smoke tests**

Create `tests/api.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run API test to verify it fails**

Run: `npm test -- tests/api.test.ts`

Expected: FAIL because server modules do not exist.

- [ ] **Step 3: Implement route module**

Create `src/server/routes.ts` with `buildServer(db, options)` that registers all required API routes, validates payloads with `zod`, calls `resolveRepoPathUnderRoot`, reads/writes database records, implements SSE polling, and implements optional commit using `runCommand('git', ['add', '-A'])` then `runCommand('git', ['commit', '-m', message])`.

For SSE, set headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, and write events as `event: <name>\ndata: <json>\n\n`.

- [ ] **Step 4: Implement server bootstrap**

Create `src/server/index.ts` that loads config, opens SQLite, starts Fastify on `0.0.0.0`, and serves `dist/client` when it exists.

- [ ] **Step 5: Run API tests**

Run: `npm test -- tests/api.test.ts`

Expected: PASS.

## Task 6: OpenCode Init and Agent Prompt Generation

**Files:**
- Create: `src/worker/opencode.ts`
- Create: `src/scripts/init-opencode.ts`

- [ ] **Step 1: Implement OpenCode config helpers**

Create `src/worker/opencode.ts` with helpers to write `.opencode/opencode.json`, `.opencode/agent/planner.md`, `.opencode/agent/coder9b.md`, and `.opencode/agent/reviewer.md` only when missing.

The planner prompt must explicitly require `TASKS.md` and `tasks.json`. The reviewer prompt must explicitly require a final `APPROVED` or `NEEDS_FIX:` verdict.

- [ ] **Step 2: Implement init script**

Create `src/scripts/init-opencode.ts` that calls the same helper for `process.cwd()` with default models: planner `openai/gpt-4.1`, coder `ollama/qwen3-coder:9b`, reviewer `openai/gpt-4.1`.

- [ ] **Step 3: Run init command**

Run: `npm run init-opencode`

Expected: `.opencode/opencode.json` and agent prompts are created.

## Task 7: Worker Job Orchestration

**Files:**
- Create: `src/worker/jobRunner.ts`
- Create: `src/worker/index.ts`

- [ ] **Step 1: Implement job runner**

Create `src/worker/jobRunner.ts` with `runJob(db, job, config)`. It must:

- Set phases: `validating`, `git`, `planning`, `coding`, `verifying`, `reviewing`, `finalizing`.
- Revalidate repo path under `WORKSPACE_ROOT`.
- Create `.oc-web/runs/<job_id>/`.
- Run `git status --short`.
- Optionally run `git switch -c <branch>`.
- Generate missing OpenCode config.
- Run planner with `opencode run --agent planner <prompt>`.
- Read `TASKS.md` and `tasks.json`.
- For each planned task, run coder, verify command, collect diff, run reviewer, retry on `NEEDS_FIX` until `maxRounds`.
- Store logs and artifacts during each phase.
- Store final diff, changed files, and final summary.
- Respect cancellation before and after each spawned command.

- [ ] **Step 2: Implement worker loop**

Create `src/worker/index.ts` that loads config, opens DB, polls `claimNextJob()`, calls `runJob`, sleeps when no job is available, and exits cleanly on `SIGINT`/`SIGTERM`.

- [ ] **Step 3: Type-check worker**

Run: `npx tsc --noEmit`

Expected: PASS.

## Task 8: React Frontend

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/api.ts`
- Create: `src/client/styles.css`
- Create: `src/client/pages/JobsList.tsx`
- Create: `src/client/pages/NewJob.tsx`
- Create: `src/client/pages/JobDetail.tsx`
- Create: `src/client/components/StatusBadge.tsx`
- Create: `src/client/components/LogViewer.tsx`
- Create: `src/client/components/DiffViewer.tsx`

- [ ] **Step 1: Implement API client**

Create `src/client/api.ts` with typed `fetchJson`, `createJob`, `listJobs`, `getJob`, `cancelJob`, `commitJob`, and `openJobStream` helpers.

- [ ] **Step 2: Implement app shell and routing**

Create `src/client/main.tsx` and `src/client/App.tsx` using simple state-based routing from `window.location.pathname`, links with normal anchors, and pages for `/`, `/new`, and `/jobs/:id`.

- [ ] **Step 3: Implement Jobs List page**

Create `src/client/pages/JobsList.tsx` to load `/api/jobs`, render recent jobs, status badge, phase, created time, duration, and request preview.

- [ ] **Step 4: Implement New Job page**

Create `src/client/pages/NewJob.tsx` with controlled form fields and defaults: `maxRounds=3`, planner `openai/gpt-4.1`, coder `ollama/qwen3-coder:9b`, reviewer `openai/gpt-4.1`. On submit, call API and navigate to `/jobs/<id>`.

- [ ] **Step 5: Implement Job Detail page**

Create `src/client/pages/JobDetail.tsx` to fetch initial job state, connect SSE, update tasks/logs/artifacts, show cancel button for queued/running jobs, show commit form for done/partial jobs, and render current diff and final summary.

- [ ] **Step 6: Implement shared UI components and styles**

Create `StatusBadge`, `LogViewer`, `DiffViewer`, and `styles.css` with responsive layout: desktop grid for summary/tasks/logs/diff and mobile stacked cards.

- [ ] **Step 7: Build frontend**

Run: `npm run build`

Expected: PASS and `dist/client` plus `dist/node` are created.

## Task 9: README and End-to-End Smoke Verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md` with sections:

- What this app does.
- Required tools: Node.js, npm, git, OpenCode CLI, configured OpenCode providers, optional Ollama model.
- Setup: `npm install`, `npm run init-opencode`.
- Environment: `WORKSPACE_ROOT`, `DATABASE_PATH`, `PORT`, `COMMAND_TIMEOUT_MS`, `POLL_INTERVAL_MS`.
- Development: run `npm run dev` and `npm run worker` in separate terminals.
- Production: `npm run build`, `npm run start`, `npm run worker`.
- Safety model: workspace boundary, no auto-push, no auto-commit, dirty git state preserved, final diff before commit.
- Job flow: planner, coder, verify, reviewer, retries, final status.
- Troubleshooting: OpenCode not found, missing `WORKSPACE_ROOT`, repo path rejected, verify command failure.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Manual API smoke test**

Start server with `WORKSPACE_ROOT=<absolute workspace root> npm run start` on Linux/macOS or `$env:WORKSPACE_ROOT='<absolute workspace root>'; npm run start` on PowerShell.

Expected: server logs a listening URL and `GET /api/jobs` returns an empty list or existing jobs.

- [ ] **Step 5: Manual worker smoke test**

Start worker with the same `WORKSPACE_ROOT` and `DATABASE_PATH` as the server.

Expected: worker starts polling without crashing. A real submitted job executes OpenCode only if `opencode` is installed and configured.

## Self-Review Notes

- Spec coverage: plan includes Fastify API, React/Vite frontend, SQLite persistence, separate worker, OpenCode CLI execution, SSE logs, safety boundary, cancellation, timeout, init-opencode, README, and npm scripts.
- Red-flag scan: the plan names every required file and behavior; the only intentionally flexible parts are exact UI styling values and internal implementation details of large modules, bounded by explicit exports and behavior.
- Type consistency: shared types define the naming used by database, API, worker, and frontend tasks.
