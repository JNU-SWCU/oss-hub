import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { runWithDockerLock } from './docker-lock.mjs';
import { run } from './tools.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-docker-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, lock: join(dir, 'lock') };
}

test('Docker runs from separate worktrees wait for the shared lock through cleanup', async (t) => {
  const { dir, lock } = fixture(t);
  const other = join(dir, 'other');
  mkdirSync(other);
  const gate = join(dir, 'finish');
  const timeline = join(dir, 'timeline');
  const { promise: started, resolve: start } = Promise.withResolvers();
  const { promise: waiting, resolve: wait } = Promise.withResolvers();
  const first = runWithDockerLock(
    'bash',
    [
      '-c',
      'touch ready; until test -f finish; do sleep .05; done; echo cleanup >> timeline; exit 3',
    ],
    { cwd: dir },
    { lock },
  );
  const observer = run(
    'bash',
    ['-c', 'until test -f ready; do sleep .05; done'],
    { cwd: dir, timeoutMs: 5000 },
  ).then(start);
  await started;
  const second = runWithDockerLock(
    'bash',
    ['-c', 'echo next >> ../timeline; cat ../timeline'],
    { cwd: other },
    { lock, log: wait },
  );
  assert.match(await waiting, /waiting for another Docker-backed run/);
  await run('touch', [gate]);
  assert.equal((await first).code, 3);
  assert.equal((await second).code, 0);
  await observer;
  assert.equal((await run('cat', [timeline])).stdout, 'cleanup\nnext\n');
});

const moduleUrl = new URL('./docker-lock.mjs', import.meta.url).href;

function contender(dir, lock, name, command, preload = []) {
  return spawn(
    process.execPath,
    [
      ...preload,
      '--input-type=module',
      '-e',
      `import { runWithDockerLock } from ${JSON.stringify(moduleUrl)};
       const result = await runWithDockerLock('bash', ['-c', ${JSON.stringify(command)}],
         {cwd: ${JSON.stringify(dir)}, timeoutMs: 4000}, {lock: ${JSON.stringify(lock)}});
       process.exitCode = result.code;`,
    ],
    {
      cwd: dir,
      env: { ...process.env, CASE_NAME: name },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
}

async function waitForFile(file) {
  const deadline = Date.now() + 3000;
  while (!existsSync(file) && Date.now() < deadline) await setTimeout(10);
  assert.ok(existsSync(file), `child did not create ${file}`);
}

async function expectWait(child, done) {
  const line = await Promise.race([
    once(child.stdout, 'data').then(([chunk]) => chunk.toString()),
    done.then(([code, signal]) => `exited early: ${code ?? signal}`),
  ]);
  assert.match(line, /waiting for another Docker-backed run/);
}

test('killing the verifier inside spawn cannot let a peer overtake its live child', async (t) => {
  const { dir, lock } = fixture(t);
  const ready = join(dir, 'ready');
  const finish = join(dir, 'finish');
  t.after(() => {
    if (existsSync(dir)) writeFileSync(finish, '');
  });
  const intercept = `
    import cp from 'node:child_process';
    import { existsSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const spawn = cp.spawn;
    cp.spawn = (...args) => {
      spawn(...args);
      const deadline = Date.now() + 3000;
      while (!existsSync('ready') && Date.now() < deadline)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      process.kill(process.pid, 'SIGKILL');
    };
    syncBuiltinESMExports();
  `;
  const first = contender(
    dir,
    lock,
    'first',
    'touch ready; for i in {1..80}; do test -e finish && break; sleep .05; done; echo cleanup >> timeline',
    ['--import', `data:text/javascript,${encodeURIComponent(intercept)}`],
  );
  const firstDone = once(first, 'exit');
  await waitForFile(ready);
  assert.deepEqual(await firstDone, [null, 'SIGKILL']);
  const next = contender(
    dir,
    lock,
    'next',
    'test -f finish && echo next >> timeline',
  );
  const nextDone = once(next, 'exit');
  await expectWait(next, nextDone);
  const earlyExit = await Promise.race([nextDone, setTimeout(650, null)]);
  assert.equal(
    earlyExit,
    null,
    'peer exited while the first command was alive',
  );
  writeFileSync(finish, '');
  assert.deepEqual(await nextDone, [0, null]);
  assert.equal(
    (await run('cat', ['timeline'], { cwd: dir })).stdout,
    'cleanup\nnext\n',
  );
});

test('kernel ownership survives a killed supervisor until its integration child exits', async (t) => {
  const { dir, lock } = fixture(t);
  const ready = join(dir, 'ready');
  const first = contender(
    dir,
    lock,
    'first',
    'kill -KILL "$PPID"; touch ready; for i in {1..80}; do test -e finish && break; sleep .05; done; echo cleanup >> timeline',
  );
  const firstDone = once(first, 'exit');
  await waitForFile(ready);
  const next = contender(
    dir,
    lock,
    'next',
    'test -f finish && echo next >> timeline',
  );
  const nextDone = once(next, 'exit');
  await expectWait(next, nextDone);
  writeFileSync(join(dir, 'finish'), '');
  await firstDone;
  assert.deepEqual(await nextDone, [0, null]);
  assert.equal(
    (await run('cat', ['timeline'], { cwd: dir })).stdout,
    'cleanup\nnext\n',
  );
});
