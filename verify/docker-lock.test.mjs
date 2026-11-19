import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
  assert.equal((await second).stdout, 'cleanup\nnext\n');
  await observer;
  assert.equal((await run('cat', [timeline])).stdout, 'cleanup\nnext\n');
});

test('a legacy mkdir holder is respected and a dead recorded holder is reclaimed', async (t) => {
  const { dir, lock } = fixture(t);
  const { promise: waiting, resolve: wait } = Promise.withResolvers();
  mkdirSync(lock);
  const next = runWithDockerLock('pwd', [], { cwd: dir }, { lock, log: wait });
  await waiting;
  // A shell lane must still be able to remove its empty lock normally.
  await run('rmdir', [lock]);
  assert.equal((await next).code, 0);

  const owner = await run('bash', ['-c', 'echo $$']);
  mkdirSync(join(lock, `owner-${owner.stdout.trim()}-0-dead`), {
    recursive: true,
  });
  const results = await Promise.all(
    [1, 2].map((index) =>
      runWithDockerLock('echo', [String(index)], { cwd: dir }, { lock }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.stdout.trim()),
    ['1', '2'],
  );
});
