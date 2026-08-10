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

// Runs the fixture's dev command once so the timed run below does not pay
// pnpm's cold start, and returns how long that cost. `pnpm dev` in a project
// pnpm has not seen also triggers an implicit `pnpm install`; the fixture's
// .npmrc disables that, and this warm-up absorbs whatever start-up cost is left.
async function warmUpDevCommand(cwd) {
  const startedAt = Date.now();
  const warmup = spawn('pnpm', ['dev'], {
    cwd,
    env: { ...process.env, CARD_GRID_WARMUP: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  warmup.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  warmup.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  await once(warmup, 'close');
  return { elapsed: Date.now() - startedAt, output };
}

// Builds a fixture pnpm project whose `dev` script runs `body`, warms that
// command up, and hands back a readiness budget scaled to the start-up cost
// measured on this machine rather than a constant.
async function prepareFixtureProject(body) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'card-grid-runner-'));
  temporaryDirectories.push(cwd);
  await writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ scripts: { dev: 'node dev-command.mjs' } }),
  );
  await writeFile(path.join(cwd, '.npmrc'), 'verify-deps-before-run=false\n');
  await writeFile(
    path.join(cwd, 'dev-command.mjs'),
    `if (process.env.CARD_GRID_WARMUP === '1') {
      console.error('WARMUP_READY');
      process.exit(0);
    }
    ${body}`,
  );
  const warmup = await warmUpDevCommand(cwd);
  return {
    cwd,
    // The clamp keeps a pathological warm-up inside the test timeout.
    readinessBudget: Math.min(15_000, Math.max(4_000, warmup.elapsed * 6)),
    warmup,
  };
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
  const { cwd, readinessBudget, warmup } = await prepareFixtureProject(
    `const { createServer } = await import('node:net');
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
  // And: the dev command is known to reach its own code, so the timed run below
  // can only fail on the cancellation and log behaviour under test.
  expect(warmup.output).toContain('WARMUP_READY');

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
        totalDeadline: now + ${readinessBudget + 5_000},
        workDeadline: now + ${readinessBudget},
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

  // Then: the observed exit — not a deadline miss — is what ended the wait, so
  // the assertions below describe cancellation rather than a lost startup race.
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain('deadline exceeded');
  expect(stderr).toContain('child exited with 23');

  // And: cancellation is prompt, diagnostics survive, and no rejection leaks.
  expect(quiescence).not.toBeNull();
  expect(Number(quiescence?.[1])).toBeLessThan(250);
  expect(stderr).toContain('PROBE_ACCEPTED');
  expect(stderr).toContain('DETERMINISTIC_STARTUP_FAILURE');
  expect(stderr).toContain('DIAGNOSTIC_29');
  expect(stderr).not.toContain('DIAGNOSTIC_00');
  expect(stderr).toContain('LOG_TAIL_LENGTH 20');
  expect(stderr).not.toContain('UNHANDLED_REJECTION');
  expect(stdout).toBe('');
}, 40_000);

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
        // The grace has to outlast the child's own exit by a wide margin: this
        // asserts the *unused* branch, so a loaded machine must not be able to
        // turn a healthy SIGTERM exit into an escalation. It also sharpens the
        // quiescence bound below — a grace timer that survived the observed
        // exit now shows up as ~2s of lingering work rather than ~100ms, which
        // is under the threshold and would go unnoticed.
        await stopServer(child, Date.now() + 7_000, 2_000);
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
