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
