import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const maximumBindAttempts = 3;
const maximumLogCharacters = 16_384;

class GeometryRunnerError extends Error {
  constructor(stage, detail, logTail = []) {
    const diagnostics =
      logTail.length === 0 ? '' : `\nServer log tail:\n${logTail.join('\n')}`;
    super(`[${stage}] ${detail}${diagnostics}`);
    this.name = 'GeometryRunnerError';
    this.detail = detail;
    this.logTail = logTail;
    this.stage = stage;
  }
}

function remaining(deadline, stage) {
  const milliseconds = deadline - Date.now();
  if (milliseconds <= 0)
    throw new GeometryRunnerError(stage, 'total deadline exhausted');
  return milliseconds;
}

function within(promise, deadline, stage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new GeometryRunnerError(stage, 'deadline exceeded')),
      remaining(deadline, stage),
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function choosePort(deadline) {
  const socket = createServer();
  await within(
    new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.listen(0, '127.0.0.1', resolve);
    }),
    deadline,
    'port-allocation',
  );
  const address = socket.address();
  if (address === null || typeof address === 'string') {
    socket.close();
    throw new GeometryRunnerError(
      'port-allocation',
      'loopback port unavailable',
    );
  }
  await within(
    new Promise((resolve) => socket.close(resolve)),
    deadline,
    'port-release',
  );
  return address.port;
}

function probe(url, deadline, signal) {
  return new Promise((resolve) => {
    const request = get(
      url,
      {
        signal,
        timeout: Math.min(1_000, remaining(deadline, 'http-probe')),
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopServer(child, deadline, shutdownGraceMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid === undefined)
    throw new GeometryRunnerError('cleanup', 'server pid missing');
  const shutdown = new AbortController();
  const exited = once(child, 'exit', { signal: shutdown.signal }).then(
    () => 'exited',
  );
  const timedOut = delay(
    Math.min(shutdownGraceMs, remaining(deadline, 'server-cleanup')),
    'timeout',
    { signal: shutdown.signal },
  );
  let outcome;
  try {
    if (!signalProcessGroup(child.pid, 'SIGTERM')) return;
    outcome = await Promise.race([exited, timedOut]);
  } finally {
    shutdown.abort();
    await Promise.allSettled([exited, timedOut]);
  }
  if (outcome === 'exited') return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const killed = once(child, 'exit');
  if (!signalProcessGroup(child.pid, 'SIGKILL')) {
    if (child.exitCode === null && child.signalCode === null) {
      await within(killed, deadline, 'server-kill-observation');
    }
    return;
  }
  await within(killed, deadline, 'server-kill');
}

async function startServer({ cwd, env, totalDeadline, workDeadline }) {
  for (let attempt = 1; attempt <= maximumBindAttempts; attempt += 1) {
    // The OS cannot transfer an ephemeral listener to Next atomically, so a bind race retries.
    const port = await choosePort(workDeadline);
    const logs = [];
    const child = spawn(
      'pnpm',
      ['dev', '--hostname', '127.0.0.1', '--port', String(port)],
      {
        cwd,
        detached: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const outputClosed = new Promise((resolve) => child.once('close', resolve));
    let logCharacters = 0;
    const capture = (chunk) => {
      const text = chunk.toString();
      logs.push(text);
      logCharacters += text.length;
      while (logCharacters > maximumLogCharacters) {
        const excess = logCharacters - maximumLogCharacters;
        const first = logs[0];
        if (first.length <= excess) {
          logs.shift();
          logCharacters -= first.length;
        } else {
          logs[0] = first.slice(excess);
          logCharacters -= excess;
        }
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    try {
      const readiness = new AbortController();
      const url = `http://127.0.0.1:${port}/programs?status=recruiting`;
      const ready = (async () => {
        while (!(await probe(url, workDeadline, readiness.signal))) {
          await within(
            delay(100, undefined, { signal: readiness.signal }),
            workDeadline,
            'http-probe-interval',
          );
        }
      })();
      const exited = once(child, 'exit', { signal: readiness.signal }).then(
        ([code]) => {
          throw new GeometryRunnerError(
            'server-start',
            `child exited with ${code}`,
          );
        },
      );
      try {
        await within(
          Promise.race([ready, exited]),
          workDeadline,
          'server-readiness',
        );
      } finally {
        readiness.abort();
        await Promise.allSettled([ready, exited]);
      }
      return { attempt, child, logs, port };
    } catch (error) {
      await stopServer(child, totalDeadline);
      await within(outputClosed, totalDeadline, 'server-output-drain');
      const logTail = logs.join('').split('\n').slice(-20);
      const bindRace = /EADDRINUSE|address already in use/i.test(
        logTail.join(''),
      );
      if (!bindRace || attempt === maximumBindAttempts) {
        if (error instanceof GeometryRunnerError) {
          throw new GeometryRunnerError(error.stage, error.detail, logTail);
        }
        throw new GeometryRunnerError('server-start', String(error), logTail);
      }
    }
  }
  throw new GeometryRunnerError('server-start', 'bind retries exhausted');
}

export { GeometryRunnerError, remaining, startServer, stopServer, within };
