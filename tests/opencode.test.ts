import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureOpenCodeConfig } from '../src/worker/opencode';

function makeRepoPath() {
  const repoPath = path.join(tmpdir(), `oc-opencode-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(repoPath, { recursive: true });
  return repoPath;
}

const models = {
  plannerModel: 'planner/model',
  coderModel: 'coder/model',
  reviewerModel: 'reviewer/model'
};

describe('ensureOpenCodeConfig', () => {
  it('creates opencode.json and all prompt files when missing', () => {
    const repoPath = makeRepoPath();

    const result = ensureOpenCodeConfig(repoPath, models);

    expect(existsSync(path.join(repoPath, '.opencode', 'opencode.json'))).toBe(true);
    expect(existsSync(path.join(repoPath, '.opencode', 'agent', 'planner.md'))).toBe(true);
    expect(existsSync(path.join(repoPath, '.opencode', 'agent', 'coder9b.md'))).toBe(true);
    expect(existsSync(path.join(repoPath, '.opencode', 'agent', 'reviewer.md'))).toBe(true);
    expect(result.created).toEqual([
      '.opencode/opencode.json',
      '.opencode/agent/planner.md',
      '.opencode/agent/coder9b.md',
      '.opencode/agent/reviewer.md'
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('overwrites opencode.json and all prompt files when they exist', () => {
    const repoPath = makeRepoPath();
    const configPath = path.join(repoPath, '.opencode', 'opencode.json');
    const plannerPath = path.join(repoPath, '.opencode', 'agent', 'planner.md');
    mkdirSync(path.dirname(plannerPath), { recursive: true });
    writeFileSync(configPath, '{"existing":true}\n');
    writeFileSync(plannerPath, 'existing planner prompt\n');

    const result = ensureOpenCodeConfig(repoPath, models);

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.model).toBe('planner/model');
    expect(readFileSync(plannerPath, 'utf8')).toContain('model: planner/model');
    expect(existsSync(path.join(repoPath, '.opencode', 'agent', 'coder9b.md'))).toBe(true);
    expect(existsSync(path.join(repoPath, '.opencode', 'agent', 'reviewer.md'))).toBe(true);
    expect(result.created).toContain('.opencode/opencode.json');
    expect(result.created).toContain('.opencode/agent/planner.md');
    expect(result.created).toContain('.opencode/agent/coder9b.md');
    expect(result.created).toContain('.opencode/agent/reviewer.md');
    expect(result.skipped).toEqual([]);
  });

  it('writes schema and supplied model values to opencode.json without prompt paths', () => {
    const repoPath = makeRepoPath();

    ensureOpenCodeConfig(repoPath, models);

    const config = JSON.parse(readFileSync(path.join(repoPath, '.opencode', 'opencode.json'), 'utf8'));
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.model).toBe('planner/model');
    expect(config.agent.planner.model).toBe('planner/model');
    expect(config.agent.coder9b.model).toBe('coder/model');
    expect(config.agent.reviewer.model).toBe('reviewer/model');
    expect(config.agent.planner.prompt).toBeUndefined();
    expect(config.agent.coder9b.prompt).toBeUndefined();
    expect(config.agent.reviewer.prompt).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain('.opencode/agent/');
    expect(config.provider).toBeDefined();
    expect(config.provider['it-olama']).toBeDefined();
    expect(config.provider['azure-custom']).toBeDefined();
  });

  it('writes agent files with frontmatter and corresponding model values', () => {
    const repoPath = makeRepoPath();

    ensureOpenCodeConfig(repoPath, models);

    const plannerPrompt = readFileSync(path.join(repoPath, '.opencode', 'agent', 'planner.md'), 'utf8');
    const coderPrompt = readFileSync(path.join(repoPath, '.opencode', 'agent', 'coder9b.md'), 'utf8');
    const reviewerPrompt = readFileSync(path.join(repoPath, '.opencode', 'agent', 'reviewer.md'), 'utf8');

    expect(plannerPrompt).toContain('---\ndescription: Creates TASKS.md and tasks.json plans for orchestrated work.\nmode: primary\nmodel: planner/model\n---');
    expect(coderPrompt).toContain('---\ndescription: Implements one assigned orchestrator task without committing.\nmode: primary\nmodel: coder/model\n---');
    expect(reviewerPrompt).toContain('---\ndescription: Reviews assigned task diffs and returns a parseable verdict.\nmode: primary\nmodel: reviewer/model\n---');
  });

  it('writes deterministic reviewer final verdict instructions', () => {
    const repoPath = makeRepoPath();

    ensureOpenCodeConfig(repoPath, models);

    const prompt = readFileSync(path.join(repoPath, '.opencode', 'agent', 'reviewer.md'), 'utf8');
    expect(prompt).toContain('APPROVED');
    expect(prompt).toContain('NEEDS_FIX:');
    expect(prompt).toContain('No other final verdict is allowed.');
  });
});
