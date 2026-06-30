import { loadEnvFile } from '../shared/config';
import { ensureOpenCodeConfig } from '../worker/opencode';

loadEnvFile();

const result = ensureOpenCodeConfig(process.cwd(), {
  plannerModel: 'azure-custom/gpt-4.1',
  coderModel: 'it-olama/qwen2.5:14b-instruct',
  reviewerModel: 'azure-custom/gpt-4.1-mini'
});

console.log(`created: ${result.created.length ? result.created.join(', ') : 'none'}`);
console.log(`skipped: ${result.skipped.length ? result.skipped.join(', ') : 'none'}`);
if (result.created.length) {
  console.log('Config created with values from .env (if available)');
}