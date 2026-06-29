import { ensureOpenCodeConfig } from '../worker/opencode';

const result = ensureOpenCodeConfig(process.cwd(), {
  plannerModel: 'openai/gpt-4.1',
  coderModel: 'ollama/qwen3-coder:9b',
  reviewerModel: 'openai/gpt-4.1'
});

console.log(`created: ${result.created.length ? result.created.join(', ') : 'none'}`);
console.log(`skipped: ${result.skipped.length ? result.skipped.join(', ') : 'none'}`);
