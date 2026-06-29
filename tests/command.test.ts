import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/shared/command';

const itPosix = process.platform === 'win32' ? it.skip : it;

describe('runCommand', () => {
  it('captures stdout and stderr and streams chunks to callbacks', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await runCommand(process.execPath, ['-e', "process.stdout.write('out'); process.stderr.write('err')"], {
      cwd: process.cwd(),
      timeoutMs: 1000,
      onStdout: (chunk) => stdoutChunks.push(chunk),
      onStderr: (chunk) => stderrChunks.push(chunk)
    });

    expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, stdout: 'out', stderr: 'err' });
    expect(stdoutChunks.join('')).toBe('out');
    expect(stderrChunks.join('')).toBe('err');
  });

  it('terminates the process when the timeout expires', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
      cwd: process.cwd(),
      timeoutMs: 50
    });

    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });

  it('captures stdout callback errors without rejecting or hanging', async () => {
    const result = await runCommand(process.execPath, ['-e', "process.stdout.write('out')"], {
      cwd: process.cwd(),
      timeoutMs: 1000,
      onStdout: () => {
        throw new Error('callback boom');
      }
    });

    expect(result.stdout).toBe('out');
    expect(result.stderr).toContain('callback boom');
  }, 3000);

  itPosix('forces the process to close after timeout when SIGTERM is ignored', async () => {
    const result = await runCommand(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 100)"], {
      cwd: process.cwd(),
      timeoutMs: 50
    });

    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  }, 3000);

  it('terminates the process when cancellation is requested', async () => {
    let checks = 0;

    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], {
      cwd: process.cwd(),
      timeoutMs: 5000,
      isCancelled: () => {
        checks += 1;
        return checks > 1;
      }
    });

    expect(result.timedOut).toBe(false);
    expect(result.code).toBeNull();
    expect(checks).toBeGreaterThan(1);
  });
});
