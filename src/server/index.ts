import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { createDb } from '../shared/db';
import { loadConfig, loadEnvFile } from '../shared/config';
import { buildServer } from './routes';

loadEnvFile();

const config = loadConfig();
mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = createDb(config.databasePath);
const app = buildServer(db, config);
const clientRoot = path.resolve('dist/client');

if (existsSync(clientRoot)) {
  await app.register(fastifyStatic, { root: clientRoot });
}

await app.listen({ host: '0.0.0.0', port: config.port });
