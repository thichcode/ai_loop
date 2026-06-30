import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadEnvFile(): void {
  const envPath = path.resolve('.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

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
