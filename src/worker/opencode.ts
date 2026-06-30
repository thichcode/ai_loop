import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface OpenCodeModels {
  plannerModel: string;
  coderModel: string;
  reviewerModel: string;
}

export interface EnsureOpenCodeConfigResult {
  created: string[];
  skipped: string[];
}

const CONFIG_PATH = '.opencode/opencode.json';
const PLANNER_PROMPT_PATH = '.opencode/agent/planner.md';
const CODER_PROMPT_PATH = '.opencode/agent/coder9b.md';
const REVIEWER_PROMPT_PATH = '.opencode/agent/reviewer.md';

const plannerPrompt = `You are the planner for the OpenCode Web Orchestrator.

Create a TASKS.md file and a tasks.json file for the requested work. The tasks.json file must be a JSON array where each item has exactly these fields: title, prompt, verify. Keep tasks independently executable and include a concrete verification command for each task.
`;

const coderPrompt = `You are the coder for the OpenCode Web Orchestrator.

Implement only the assigned task. Follow the repository's existing conventions and keep changes focused. Run or carefully consider the task's verify command before reporting completion. Do not create commits, push branches, or modify unrelated files.
`;

const reviewerPrompt = `You are the reviewer for the OpenCode Web Orchestrator.

Inspect the assigned task, the diff, and the verification output. Decide whether the implementation satisfies the task without unrelated changes. Your final response must end with exactly one of these forms: APPROVED, or NEEDS_FIX: followed by specific fix instructions. No other final verdict is allowed.
`;

export function ensureOpenCodeConfig(repoPath: string, models: OpenCodeModels): EnsureOpenCodeConfigResult {
  const created: string[] = [];
  const skipped: string[] = [];

  mkdirSync(path.join(repoPath, '.opencode', 'agent'), { recursive: true });

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://your-ollama-endpoint/v1';
  const azureBaseUrl = process.env.AZURE_BASE_URL || 'https://your-azure-proxy/v1';

  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    plugin: ['superpowers@git+https://github.com/obra/superpowers.git'],
    model: models.plannerModel,
    provider: {
      'it-olama': {
        name: 'it-olama',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: ollamaBaseUrl },
        models: {
          'qwen2.5:14b-instruct': { name: 'qwen2.5:14b-instruct' },
          'qwen3.5:9b': { name: 'qwen3.5:9b' },
          'gemma4:12b-it-qat': { name: 'gemma4:12b-it-qat' }
        }
      },
      'azure-custom': {
        name: 'azure-custom',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: azureBaseUrl },
        models: {
          'gpt-4.1': { name: 'gpt-4.1' },
          'gpt-4.1-mini': { name: 'gpt-4.1-mini' }
        }
      }
    },
    agent: {
      planner: { model: models.plannerModel },
      coder9b: { model: models.coderModel },
      reviewer: { model: models.reviewerModel }
    }
  };

  writeFileSync(path.join(repoPath, CONFIG_PATH), `${JSON.stringify(config, null, 2)}\n`);
  created.push(CONFIG_PATH);

  const promptFiles = [
    {
      relativePath: PLANNER_PROMPT_PATH,
      description: 'Creates TASKS.md and tasks.json plans for orchestrated work.',
      model: models.plannerModel,
      body: plannerPrompt
    },
    {
      relativePath: CODER_PROMPT_PATH,
      description: 'Implements one assigned orchestrator task without committing.',
      model: models.coderModel,
      body: coderPrompt
    },
    {
      relativePath: REVIEWER_PROMPT_PATH,
      description: 'Reviews assigned task diffs and returns a parseable verdict.',
      model: models.reviewerModel,
      body: reviewerPrompt
    }
  ];

  for (const promptFile of promptFiles) {
    writeIfMissing(
      repoPath,
      promptFile.relativePath,
      `---\ndescription: ${promptFile.description}\nmode: primary\nmodel: ${promptFile.model}\n---\n\n${promptFile.body}`,
      created,
      skipped
    );
  }

  return { created, skipped };
}

function writeIfMissing(
  repoPath: string,
  relativePath: string,
  contents: string,
  created: string[],
  skipped: string[]
) {
  const absolutePath = path.join(repoPath, relativePath);

  if (existsSync(absolutePath)) {
    skipped.push(relativePath);
    return;
  }

  writeFileSync(absolutePath, contents);
  created.push(relativePath);
}
