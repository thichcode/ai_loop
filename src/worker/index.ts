import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, loadEnvFile } from '../shared/config';
import { createDb } from '../shared/db';
import { runJob } from './jobRunner';

loadEnvFile();

if (!process.env.AZURE_BASE_URL) {
  console.warn('WARN .env file not found or AZURE_BASE_URL not set — LLM calls will fail (using placeholder URL)');
}
if (!process.env.OLLAMA_BASE_URL) {
  console.warn('WARN .env file not found or OLLAMA_BASE_URL not set — local model calls will fail (using placeholder URL)');
}

const config = loadConfig();
const db = createDb(config.databasePath);
let shuttingDown = false;
let currentJobId: string | null = null;

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

void main();

async function main() {
  while (!shuttingDown) {
    const job = db.claimNextJob();

    if (!job) {
      await sleep(config.pollIntervalMs);
      continue;
    }

    currentJobId = job.id;
    try {
      await runJob(db, job, config);
    } finally {
      currentJobId = null;
    }
  }

  db.close();
}

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (currentJobId) {
    db.updateJob(currentJobId, { cancelRequested: true });
  }
}
