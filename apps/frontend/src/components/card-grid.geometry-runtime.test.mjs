import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const temporaryDirectories = [];
const runtimeUrl = new URL('./card-grid.geometry-runtime.mjs', import.meta.url);

async function runDriver(source) {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [exitCode] = await once(child, 'close');
  return { exitCode, stderr, stdout };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test('cancels readiness work and preserves logs when the child exits first', async () => {
  // Given: a dev command that logs a diagnostic and exits before serving HTTP.
  const cwd = await mkdtemp(path.join(tmpdir(), 'card-grid-runner-'));
  temporaryDirectories.push(cwd);
  await writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ scripts: { dev: 'node exit-before-readiness.mjs' } }),
  );
  await writeFile(
    path.join(cwd, 'exit-before-readiness.mjs'),
    `import { createServer } from 'node:net';
    for (let index = 0; index < 30; index += 1) {
      console.error(\`DIAGNOSTIC_\${String(index).padStart(2, '0')}\`);
    }
    console.error('DETERMINISTIC_STARTUP_FAILURE');
    const portIndex = process.argv.indexOf('--port');
    const port = Number(process.argv[portIndex + 1]);
    const server = createServer(() => {
      console.error('PROBE_ACCEPTED');
      server.close();
      setTimeout(() => process.exit(23), 25);
    });
    server.listen(port, '127.0.0.1');
    `,
  );
  const driver = `
    import { startServer } from ${JSON.stringify(runtimeUrl.href)};
    let rejectedAt;
    process.on('unhandledRejection', (error) => {
      console.error('UNHANDLED_REJECTION', error);
      process.exitCode = 70;
    });
    process.on('beforeExit', () => {
      console.error('QUIESCENT_AFTER', Date.now() - rejectedAt);
    });
    const now = Date.now();
    try {
      await startServer({
        cwd: ${JSON.stringify(cwd)},
        env: process.env,
        totalDeadline: now + 3_000,
        workDeadline: now + 2_000,
      });
    } catch (error) {
      rejectedAt = Date.now();
      console.error(error instanceof Error ? error.message : error);
      console.error('LOG_TAIL_LENGTH', error?.logTail?.length);
    }
  `;

  // When: startServer observes the child exit while its HTTP probe is pending.
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', driver],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [exitCode] = await once(child, 'close');
  const quiescence = stderr.match(/QUIESCENT_AFTER (\d+)/);

  // Then: cancellation is prompt, diagnostics survive, and no rejection leaks.
  expect(exitCode).toBe(0);
  expect(quiescence).not.toBeNull();
  expect(Number(quiescence?.[1])).toBeLessThan(250);
  expect(stderr).toContain('child exited with 23');
  expect(stderr).toContain('PROBE_ACCEPTED');
  expect(stderr).toContain('DETERMINISTIC_STARTUP_FAILURE');
  expect(stderr).toContain('DIAGNOSTIC_29');
  expect(stderr).not.toContain('DIAGNOSTIC_00');
  expect(stderr).toContain('LOG_TAIL_LENGTH 20');
  expect(stderr).not.toContain('UNHANDLED_REJECTION');
  expect(stdout).toBe('');
});

test('cancels the shutdown timeout when SIGTERM stops the child', async () => {
  // Given: a detached child with the default SIGTERM behavior.
  const driver = `
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { stopServer } from ${JSON.stringify(runtimeUrl.href)};
      const nativeKill = process.kill.bind(process);
      process.kill = (pid, signal) => {
        console.error('SIGNAL_SENT', signal);
        return nativeKill(pid, signal);
      };
      let stopReturnedAt;
      process.on('unhandledRejection', (error) => {
        console.error('UNHANDLED_REJECTION', error);
        process.exitCode = 70;
      });
      process.on('beforeExit', () => {
        console.error('QUIESCENT_MS', Date.now() - stopReturnedAt);
      });
      const child = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1_000)'], {
        detached: true,
        stdio: 'ignore',
      });
      await once(child, 'spawn');
      const startedAt = Date.now();
      try {
        await stopServer(child, Date.now() + 7_000, 100);
      } catch (error) {
        console.error('STOP_ERROR', error?.code ?? error);
      }
      stopReturnedAt = Date.now();
      console.error('STOP_RETURN_MS', stopReturnedAt - startedAt);
      console.error('SIGNAL_CODE', child.signalCode);
    `;

  // When: stopServer sends SIGTERM and the child exits by that signal.
  const { exitCode, stderr, stdout } = await runDriver(driver);
  const quiescence = stderr.match(/QUIESCENT_MS (\d+)/);

  // Then: no escalation or losing timer survives the observed exit.
  expect(exitCode).toBe(0);
  expect(stderr).toContain('SIGNAL_SENT SIGTERM');
  expect(stderr).not.toContain('SIGNAL_SENT SIGKILL');
  expect(stderr).not.toContain('STOP_ERROR');
  expect(stderr).toContain('SIGNAL_CODE SIGTERM');
  expect(Number(quiescence?.[1])).toBeLessThan(250);
  expect(stderr).not.toContain('UNHANDLED_REJECTION');
  expect(stdout).toBe('');
}, 10_000);

test('escalates to SIGKILL when the child ignores SIGTERM', async () => {
  // Given: a detached child that confirms its SIGTERM handler is active.
  const driver = `
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { stopServer } from ${JSON.stringify(runtimeUrl.href)};
      const nativeKill = process.kill.bind(process);
      process.kill = (pid, signal) => {
        console.error('SIGNAL_SENT', signal);
        return nativeKill(pid, signal);
      };
      process.on('unhandledRejection', (error) => {
        console.error('UNHANDLED_REJECTION', error);
        process.exitCode = 70;
      });
      const child = spawn(
        process.execPath,
        ['--eval', "process.on('SIGTERM', () => {}); console.log('READY'); setInterval(() => {}, 1_000)"],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      await once(child.stdout, 'data');
      await stopServer(child, Date.now() + 7_000, 100);
      console.error('SIGNAL_CODE', child.signalCode);
    `;

  // When: the grace period expires while the child remains alive.
  const { exitCode, stderr, stdout } = await runDriver(driver);

  // Then: stopServer safely escalates once and settles the child exit.
  expect(exitCode).toBe(0);
  expect(stderr.match(/SIGNAL_SENT SIGTERM/g)).toHaveLength(1);
  expect(stderr.match(/SIGNAL_SENT SIGKILL/g)).toHaveLength(1);
  expect(stderr).toContain('SIGNAL_CODE SIGKILL');
  expect(stderr).not.toContain('UNHANDLED_REJECTION');
  expect(stdout).toBe('');
}, 10_000);
