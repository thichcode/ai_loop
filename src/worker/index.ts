import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../shared/config';
import { createDb } from '../shared/db';
import { runJob } from './jobRunner';

const config = loadConfig();
const db = createDb(config.databasePath);
let shuttingDown = false;

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

    await runJob(db, job, config);
  }

  db.close();
}

function stop() {
  shuttingDown = true;
}
