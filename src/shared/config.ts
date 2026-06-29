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
