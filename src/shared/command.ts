import { spawn } from 'node:child_process';

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  shell?: boolean;
  isCancelled?: () => boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let cancelInterval: NodeJS.Timeout | undefined;
    let forceKillTimeout: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (cancelInterval) clearInterval(cancelInterval);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
    };

    const finish = (result: RunCommandResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const captureCallbackError = (error: unknown) => {
      stderr += error instanceof Error ? error.message : String(error);
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: options.shell ?? false,
        windowsHide: true,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
          NODE_NO_WARNINGS: '1'
        },
        stdio: ['pipe', 'overlapped', 'overlapped']
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish({ code: 1, signal: null, timedOut, stdout, stderr: message });
      return;
    }

    child.stdout?.on('data', (data: Buffer | string) => {
      const chunk = data.toString();
      stdout += chunk;
      try {
        options.onStdout?.(chunk);
      } catch (error) {
        captureCallbackError(error);
      }
    });

    child.stderr?.on('data', (data: Buffer | string) => {
      const chunk = data.toString();
      stderr += chunk;
      try {
        options.onStderr?.(chunk);
      } catch (error) {
        captureCallbackError(error);
      }
    });

    child.on('error', (error) => {
      stderr += error.message;
      finish({ code: 1, signal: null, timedOut, stdout, stderr });
    });

    child.on('close', (code, signal) => {
      finish({ code, signal, timedOut, stdout, stderr });
    });

    const killChild = () => {
      child.kill('SIGTERM');
      forceKillTimeout ??= setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1000);
    };

    timeout = setTimeout(() => {
      timedOut = true;
      killChild();
    }, options.timeoutMs);

    cancelInterval = setInterval(() => {
      if (options.isCancelled?.()) {
        killChild();
      }
    }, 500);
  });
}
