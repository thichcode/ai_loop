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

  it('rejects sibling paths whose name starts with the workspace root name', () => {
    const base = path.join(tmpdir(), `oc-prefix-${Date.now()}`);
    const root = path.join(base, 'root');
    const outsideRepo = path.join(base, 'root2', 'repo');
    mkdirSync(root, { recursive: true });
    mkdirSync(outsideRepo, { recursive: true });

    const result = resolveRepoPathUnderRoot(outsideRepo, root);

    expect(result.ok).toBe(false);
  });
});
