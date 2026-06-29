# OpenCode Web Orchestrator

Web-based orchestration system for OpenCode CLI. Submit a coding request, watch it plan, code, verify, review, retry, and report.

## Required Tools

- **Node.js** (v18+)
- **npm**
- **git**
- **OpenCode CLI** (`opencode` on PATH)
- Configured OpenCode providers (e.g. OpenAI, Ollama)

## Setup

```bash
npm install
npm run init-opencode
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKSPACE_ROOT` | Yes | — | Root directory for allowed repository paths |
| `DATABASE_PATH` | No | `.oc-web/orchestrator.db` | SQLite database file |
| `PORT` | No | `3000` | API server port |
| `COMMAND_TIMEOUT_MS` | No | `1800000` (30min) | Command timeout |
| `POLL_INTERVAL_MS` | No | `1000` | Worker poll interval |

## Development

```bash
# Terminal 1: API server + Vite dev server
npm run dev

# Terminal 2: Worker
npm run worker
```

## Production

```bash
npm run build
WORKSPACE_ROOT=/path/to/repos npm run start
WORKSPACE_ROOT=/path/to/repos npm run worker
```

## Usage

1. Open `http://localhost:3000`
2. Click **New Job**
3. Enter repository path, coding request, model selections, max rounds
4. Click **Run**
5. Watch live logs, task progress, diff, and final summary
6. Optionally commit when done

## Safety Model

- Repository paths are validated against `WORKSPACE_ROOT`
- No auto-push ever
- No auto-commit unless user clicks commit with a message
- Dirty git state is preserved and shown
- Final diff is displayed before commit
- Job cancellation stops all running commands
- Each command runs with configurable timeout

## Job Flow

1. Planner (`opencode run --agent planner`) creates `TASKS.md` + `tasks.json`
2. Coder (`opencode run --agent coder9b`) implements each task
3. Verify command from `tasks.json` runs
4. Reviewer (`opencode run --agent reviewer`) inspects and returns `APPROVED` or `NEEDS_FIX`
5. Retries until `maxRounds` or approval
6. Final status: done (all approved), partial (some approved), failed (none approved), or cancelled

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `WORKSPACE_ROOT is required` | Set env before starting |
| Repository path rejected | Path must be under `WORKSPACE_ROOT` |
| `opencode: command not found` | Install OpenCode CLI on PATH |
| Verify command fails | Check the verify command in `tasks.json` |
| Worker doesn't start | Ensure `WORKSPACE_ROOT` is set and DB parent dir exists |
