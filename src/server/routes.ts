import Fastify from 'fastify';
import { z } from 'zod';
import { runCommand, type RunCommandResult } from '../shared/command';
import { createDb } from '../shared/db';
import { resolveRepoPathUnderRoot } from '../shared/pathSafety';

type AppDb = ReturnType<typeof createDb>;

export interface ServerOptions {
  workspaceRoot?: string;
  commandTimeoutMs: number;
}

const createJobSchema = z.object({
  repoPath: z.string().min(1),
  request: z.string().min(1),
  branchName: z.string().optional(),
  maxRounds: z.number().int().positive(),
  plannerModel: z.string().min(1),
  coderModel: z.string().min(1),
  reviewerModel: z.string().min(1)
});

const commitSchema = z.object({
  message: z.string().min(1)
});

const paramsSchema = z.object({
  id: z.string().min(1)
});

const logsQuerySchema = z.object({
  afterId: z.coerce.number().int().nonnegative().optional().default(0)
});

export function buildServer(db: AppDb, options: ServerOptions) {
  const app = Fastify({ logger: false });

  app.post('/api/jobs', async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const repo = resolveRepoPathUnderRoot(parsed.data.repoPath, options.workspaceRoot);
    if (!repo.ok) return reply.code(400).send({ error: repo.error });

    const job = db.createJob({ ...parsed.data, repoPath: repo.path });
    return { job };
  });

  app.get('/api/jobs', async () => ({ jobs: db.listJobs() }));

  app.get('/api/jobs/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const job = db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    return {
      job,
      tasks: db.listTasks(id),
      artifacts: db.listArtifacts(id),
      logs: db.listLogs(id)
    };
  });

  app.get('/api/jobs/:id/logs', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    if (!db.getJob(id)) return reply.code(404).send({ error: 'Job not found' });

    const parsed = logsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const { afterId } = parsed.data;
    return { logs: db.listLogs(id, afterId) };
  });

  app.get('/api/jobs/:id/stream', (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    if (!db.getJob(id)) {
      reply.code(404).send({ error: 'Job not found' });
      return;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });

    let lastLogId = 0;
    let lastArtifactId = 0;
    let lastJob = '';
    let lastTasks = '';
    let closed = false;

    const sendEvent = (event: string, data: unknown) => {
      if (closed) return;
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendSnapshot = () => {
      const job = db.getJob(id);
      if (!job) return;

      const jobJson = JSON.stringify(job);
      if (jobJson !== lastJob) {
        lastJob = jobJson;
        sendEvent('job', job);
      }

      const tasks = db.listTasks(id);
      const tasksJson = JSON.stringify(tasks);
      if (tasksJson !== lastTasks) {
        lastTasks = tasksJson;
        sendEvent('tasks', tasks);
      }

      for (const log of db.listLogs(id, lastLogId)) {
        lastLogId = Math.max(lastLogId, log.id);
        sendEvent('log', log);
      }

      for (const artifact of db.listArtifacts(id).filter((item) => item.id > lastArtifactId).reverse()) {
        lastArtifactId = Math.max(lastArtifactId, artifact.id);
        sendEvent('artifact', artifact);
      }
    };

    const cleanup = () => {
      closed = true;
      clearInterval(interval);
      if (!reply.raw.destroyed) reply.raw.end();
    };

    const interval = setInterval(() => {
      sendSnapshot();
      sendEvent('heartbeat', { now: new Date().toISOString() });
    }, 1000);

    request.raw.on('close', cleanup);
    sendSnapshot();
    sendEvent('heartbeat', { now: new Date().toISOString() });
  });

  app.post('/api/jobs/:id/cancel', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const job = db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const updated =
      job.status === 'queued'
        ? db.updateJob(id, { status: 'cancelled', phase: 'cancelled', finishedAt: new Date().toISOString() })
        : job.status === 'running'
          ? db.updateJob(id, { cancelRequested: true, phase: 'cancelling' })
          : job;

    return { job: updated };
  });

  app.post('/api/jobs/:id/commit', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const job = db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    if (job.status !== 'done' && job.status !== 'partial') {
      return reply.code(409).send({ error: 'Job must be done or partial before committing' });
    }

    const parsed = commitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const repo = resolveRepoPathUnderRoot(job.repoPath, options.workspaceRoot);
    if (!repo.ok) return reply.code(400).send({ error: repo.error });

    const add = await runGitAndLog(db, job.id, repo.path, options.commandTimeoutMs, ['add', '-A']);
    if (add.code !== 0) return reply.code(409).send({ error: 'git add failed', add });

    const commit = await runGitAndLog(db, job.id, repo.path, options.commandTimeoutMs, ['commit', '-m', parsed.data.message]);
    if (commit.code !== 0) return reply.code(409).send({ error: 'git commit failed', add, commit });

    return { ok: true, add, commit };
  });

  app.post('/api/jobs/:id/retry', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const job = db.getJob(id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    if (job.status === 'queued' || job.status === 'running') {
      return reply.code(409).send({ error: 'Cannot retry a queued or running job' });
    }

    db.deleteJobTasks(id);
    const updated = db.updateJob(id, {
      status: 'queued',
      phase: 'queued',
      error: null,
      startedAt: null,
      finishedAt: null
    });
    return { job: updated };
  });

  return app;
}

async function runGitAndLog(
  db: AppDb,
  jobId: string,
  repoPath: string,
  timeoutMs: number,
  args: string[]
): Promise<RunCommandResult> {
  const result = await runCommand('git', args, { cwd: repoPath, timeoutMs });
  if (result.stdout) db.addLog(jobId, null, 'commit', 'stdout', result.stdout);
  if (result.stderr) db.addLog(jobId, null, 'commit', 'stderr', result.stderr);
  return result;
}
