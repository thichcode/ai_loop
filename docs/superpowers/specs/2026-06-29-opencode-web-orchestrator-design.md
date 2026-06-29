# OpenCode Web Orchestrator Design

Date: 2026-06-29

## Goal

Build a web-based orchestration system on top of the OpenCode CLI. A user opens a web page, submits a coding request for a repository, and waits while the system plans, codes, verifies, reviews, retries, and reports the final result.

The system must not call LLM APIs directly. All AI execution goes through `opencode run`.

## Scope

This is a new TypeScript application in the current workspace. The initial version is a real working app, not a mock UI.

Included:

- Fastify backend API.
- React + Vite frontend.
- Separate worker process started with `npm run worker`.
- SQLite persistence with `better-sqlite3`.
- OpenCode CLI execution through `child_process.spawn`.
- Server-Sent Events for live job updates and logs.
- Repository path safety under `WORKSPACE_ROOT`.
- Job cancellation and command timeout support.
- Final diff, changed files, logs, task states, and final summary.
- Optional commit endpoint and UI after user approval.
- `npm run init-opencode` to generate OpenCode config and agent prompts.

Excluded from the initial version:

- Direct LLM API calls.
- Auto-push.
- Auto-commit by default.
- Multi-worker locking beyond safe single-job claiming in SQLite.
- Authentication and multi-user authorization.

## Chosen Architecture

Use a single package full-stack app where the Fastify API serves both JSON endpoints and the built frontend in production. The worker is a separate Node.js process but shares TypeScript modules for database access, config, schemas, logging, and command execution.

This keeps the project simple while preserving a production-like separation between the HTTP server and long-running OpenCode execution.

## Components

### Frontend

React + Vite provides three pages:

- Jobs List: recent jobs, status, created time, duration, and links to details.
- New Job: repo path, coding request, optional branch, max rounds, planner model, coder model, reviewer model, and submit button.
- Job Detail: status badge, current phase, task list, live logs, diff, changed files, final summary, cancel button, and optional commit form.

The job detail page subscribes to `/api/jobs/:id/stream` and updates from real backend state. It does not fabricate progress client-side.

### Backend API

Fastify owns request validation, job creation, job reads, cancellation, optional commit, static frontend serving, and SSE streaming.

Endpoints:

- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/logs`
- `GET /api/jobs/:id/stream`
- `POST /api/jobs/:id/cancel`
- `POST /api/jobs/:id/commit`

### Worker

The worker runs as a separate process via `npm run worker`. It polls SQLite for queued jobs, claims one atomically, validates the repository path, prepares run directories, checks git state, optionally creates a branch, runs planner/coder/reviewer OpenCode commands, runs task verification commands, stores artifacts, and updates status.

Only the worker executes OpenCode.

### SQLite Database

Use `better-sqlite3` for a small, reliable queue and state store.

Tables:

- `jobs`: original request, status, phase, repo path, models, max rounds, timestamps, cancel flag, and error.
- `tasks`: planner-created tasks, prompt, verify command, status, rounds, reviewer verdict, and failure reason.
- `job_logs`: append-only timestamped logs with phase, task id, stream type, and message.
- `job_artifacts`: named text artifacts such as `tasks_md`, `tasks_json`, `diff`, `changed_files`, `final_summary`, planner output, and reviewer output.

Artifacts and logs are also written under `.oc-web/runs/<job_id>/` in the target repository when possible.

## Job Flow

1. User submits a job with repo path, request, optional branch, max rounds, and model selections.
2. API validates required fields and verifies the resolved repo path is under `WORKSPACE_ROOT`.
3. API inserts the job as `queued` in SQLite.
4. Worker claims a queued job and marks it `running`.
5. Worker revalidates the repo path under `WORKSPACE_ROOT`.
6. Worker creates `.oc-web/runs/<job_id>/`.
7. Worker runs `git status --short` and logs clean or dirty state. Dirty state is allowed and never reverted.
8. If a branch name is provided, worker runs `git switch -c <branch>` and fails the job if branch creation fails.
9. Worker runs planner with `opencode run --agent planner "<planning prompt>"`.
10. Planner must create `TASKS.md` and `tasks.json` in the target repository.
11. Worker reads `tasks.json`, inserts task rows, and stores planner artifacts.
12. For each task, worker runs coder with `opencode run --agent coder9b "<task prompt>"`.
13. Worker runs the task verify command from `tasks.json`, collecting stdout and stderr.
14. Worker collects `git diff` and changed files.
15. Worker runs reviewer with `opencode run --agent reviewer "<review prompt>"`.
16. If reviewer output contains `APPROVED`, the task is marked done.
17. If reviewer output contains `NEEDS_FIX`, the worker passes the reviewer feedback to coder and repeats until `maxRounds` is reached.
18. If reviewer output contains neither expected verdict, the task is marked failed.
19. Final job status is `done` if all tasks are approved, `partial` if at least one task is approved and one failed, `failed` if none are approved or setup/planning fails, and `cancelled` if cancellation is requested.
20. Worker stores final diff, changed files, logs, and final summary before finishing when possible.

## OpenCode Integration

The app never calls model APIs directly. It shells out to OpenCode CLI with `child_process.spawn`.

Default generated OpenCode config:

```json
{
  "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"],
  "model": "openai/gpt-4.1",
  "agent": {
    "planner": {
      "model": "openai/gpt-4.1",
      "prompt": ".opencode/agent/planner.md"
    },
    "coder9b": {
      "model": "ollama/qwen3-coder:9b",
      "prompt": ".opencode/agent/coder9b.md"
    },
    "reviewer": {
      "model": "openai/gpt-4.1",
      "prompt": ".opencode/agent/reviewer.md"
    }
  }
}
```

`npm run init-opencode` creates `.opencode/opencode.json` and prompt files in the orchestrator project. The worker also ensures target repositories have a usable `.opencode` setup when missing. It does not overwrite existing target repo OpenCode config in the initial version.

The submitted planner, coder, and reviewer model values are used when the worker generates missing target repo OpenCode config. If the target repo already has OpenCode config, the worker logs that the existing repo config controls the actual agent models and stores the submitted model values as job metadata. This avoids silently overwriting user repository configuration.

Planner contract:

```json
[
  {
    "title": "Implement API routes",
    "prompt": "Detailed coder instructions...",
    "verify": "npm test"
  }
]
```

Reviewer contract:

```text
APPROVED
```

or:

```text
NEEDS_FIX:
specific fix instructions
```

## Safety

- `WORKSPACE_ROOT` is required.
- API and worker both reject repository paths outside the resolved `WORKSPACE_ROOT`.
- OpenCode and git commands run with `spawn` arguments and `cwd` set to the target repository.
- Verify commands from `tasks.json` may use shell execution because they are arbitrary project commands; the command is logged before execution.
- The orchestrator does not implement file deletion helpers.
- The orchestrator never auto-pushes.
- The orchestrator never auto-commits unless the user clicks commit and provides a commit message.
- Existing dirty git state is preserved and shown.
- Final diff is shown before commit.
- Job cancellation is supported through a cancel flag and active child process termination.
- Timeouts apply to OpenCode, verify, and git commands.

## API Behavior

`POST /api/jobs` accepts:

- `repoPath`
- `request`
- `branchName`
- `maxRounds`
- `plannerModel`
- `coderModel`
- `reviewerModel`

`GET /api/jobs` returns recent jobs with status, phase, created time, finished time, duration, and request preview.

`GET /api/jobs/:id` returns the job, tasks, latest artifacts, and recent logs.

`GET /api/jobs/:id/logs` returns paginated logs with optional `afterId`.

`GET /api/jobs/:id/stream` is an SSE endpoint. It sends `job`, `tasks`, `log`, `artifact`, and `heartbeat` events. It polls SQLite periodically, emits only changed/new data, and closes when the client disconnects.

`POST /api/jobs/:id/cancel` requests cancellation. Queued jobs become `cancelled`; running jobs are stopped by the worker.

`POST /api/jobs/:id/commit` is allowed only for `done` or `partial` jobs. It requires a commit message, runs `git add -A` and `git commit`, logs output, and does not push.

## Frontend Behavior

The UI is practical and status-focused.

Desktop job detail uses a layout that keeps task state, logs, and diff visible together. Mobile collapses into a stacked or tabbed layout.

The New Job page posts to the backend and navigates to Job Detail after creation.

The Job Detail page opens an SSE connection and refreshes job state, task state, logs, and artifacts from server events. If SSE disconnects, the page shows a reconnecting state and attempts to reconnect.

## Scripts

Required npm scripts:

- `npm run dev`: run backend and frontend development servers together.
- `npm run build`: build backend, worker, and frontend.
- `npm run start`: start production Fastify server serving API and built frontend.
- `npm run worker`: start the worker process.
- `npm run init-opencode`: generate OpenCode config and agent prompts.

## Verification

Implementation should verify:

- TypeScript compiles for backend and worker.
- Vite frontend builds.
- API starts with required environment variables.
- SQLite migrations initialize tables.
- `POST /api/jobs` creates a queued job.
- SSE emits logs and state changes for a job.
- Worker can execute real `opencode run` commands when OpenCode CLI is installed.

## Open Questions Deferred

The initial version intentionally defers authentication, multi-user isolation, concurrent worker scaling, advanced diff visualization, and per-workspace policy management. These are not needed to satisfy the requested single-user orchestration flow.
