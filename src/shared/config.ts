import path from 'node:path';

export interface AppConfig {
  port: number;
  databasePath: string;
  workspaceRoot?: string;
  commandTimeoutMs: number;
  pollIntervalMs: number;
}

export function loadConfig(env = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    databasePath: path.resolve(env.DATABASE_PATH ?? '.oc-web/orchestrator.db'),
    workspaceRoot: env.WORKSPACE_ROOT ? path.resolve(env.WORKSPACE_ROOT) : undefined,
    commandTimeoutMs: Number(env.COMMAND_TIMEOUT_MS ?? 30 * 60 * 1000),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 1000)
  };
}
