import assert from 'node:assert/strict';
import { writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { lifecycle } from './user-consolidation-watchdog-fixture.mjs';

test('a failed transaction resolves its ledger and a fresh deployment succeeds', (t) => {
  const f = lifecycle(t, 'transaction');
  const failed = f.command('user-consolidation-migrate.sh', '--execute', f.run);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(f.receipt().phase, 'ROLLED_BACK', failed.stderr);
  assert.equal(f.read().ledger[0].rolled_back_at, 'resolved');
  const world = f.read();
  world.failure = '';
  // A fresh durable bundle retains the database ledger from the failed deployment.
  const retry = join(f.root, 'retry');
  world.activeRun = retry;
  writeFileSync(join(f.root, 'world.json'), JSON.stringify(world));
  cpSync(f.run, retry, { recursive: true });
  for (const name of ['receipt.json', 'OPEN_COMMITTED', 'watchdog-armed.json'])
    rmSync(join(retry, name));
  assert.equal(f.state('init', retry, 'boot-one', '300', '{}').status, 0);
  assert.equal(f.state('armed', retry, 'boot-one').status, 0);
  const retried = f.command(
    'user-consolidation-migrate.sh',
    '--execute',
    retry,
  );
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(f.state('terminal', retry).status, 0);
  assert.match(retried.stdout, /PHASE=OPEN\n/);
  assert.equal(f.read().schema, 'new');
  assert.equal(f.read().ingress, 'open');
  assert.deepEqual(f.read().writes, [
    'old-scheduled-write',
    'new-scheduled-write',
  ]);
  assert.equal(
    f.events().filter((event) => event.name === 'attempt-resolved').length,
    1,
  );
});

test('a lost resolve response stays fenced and recovery resumes without resolving twice', (t) => {
  const f = lifecycle(t, 'resolve-response-lost');
  const failed = f.command('user-consolidation-migrate.sh', '--execute', f.run);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(f.receipt().phase, 'RECOVERY_FAILED', failed.stderr);
  assert.equal(f.read().ingress, 'closed');
  assert.deepEqual(f.read().writes, []);
  const recovered = f.command(
    'user-consolidation-migrate.sh',
    '--recover',
    f.run,
  );
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(f.receipt().phase, 'ROLLED_BACK');
  assert.equal(f.read().ingress, 'open');
  assert.equal(f.read().containers.length, 0);
  assert.equal(
    f.events().filter((event) => event.name === 'attempt-resolved').length,
    1,
  );
});

function outputSignal(child, sentinel) {
  return new Promise((resolve, reject) => {
    let output = '';
    const receive = (bytes) => {
      output += bytes;
      if (output.includes(sentinel)) {
        child.stdout.off('data', receive);
        child.off('exit', ended);
        resolve();
      }
    };
    const ended = () => reject(new Error(`process exited before ${sentinel}`));
    child.stdout.on('data', receive);
    child.once('error', reject);
    child.once('exit', ended);
  });
}

test('fence completes after a transient curl 55 followed by maintenance 503', (t) => {
  const f = lifecycle(t, 'fence-curl-transient');
  const result = f.command(
    'user-consolidation-watchdog-host.sh',
    'fence',
    f.run,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    f
      .events()
      .filter((event) => event.name.startsWith('fence-probe'))
      .map((event) => event.name),
    ['fence-probe-error:55', 'fence-probe:503'],
  );
  const world = f.read();
  assert.equal(world.ingress, 'closed');
  assert.equal(world.blocked, true);
  assert.equal(world.hbaSaved, true);
  assert.equal(world.backend, null);
  assert.equal(world.restart, false);
  assert.equal(world.externalWriters, false);
  assert.deepEqual(world.writes, []);
  assert.equal(world.schema, 'old');
});

test('fenced migration verifies the restored backup and isolated candidate before allowing writers', (t) => {
  const f = lifecycle(t);
  const result = f.command('user-consolidation-migrate.sh', '--execute', f.run);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.receipt().phase, 'OPEN');
  assert.deepEqual(f.read().writes, ['new-scheduled-write']);
  assert.equal(f.read().schema, 'new');
  assert.equal(f.read().ingress, 'open');
  assert.ok(
    f
      .events()
      .filter((e) => e.name === 'writer-started')
      .every((e) => e.open),
  );
  assert.equal(f.read().containers.length, 0);
  assert.equal(f.read().clone, null);
});

for (const failure of ['migrate', 'verify', 'unknown-writer']) {
  test(`pre-open ${failure} failure restores the old schema and image before reopening`, (t) => {
    const f = lifecycle(t, failure);
    const result = f.command(
      'user-consolidation-migrate.sh',
      '--execute',
      f.run,
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(f.receipt().phase, 'ROLLED_BACK', result.stderr);
    assert.equal(f.read().schema, 'old');
    assert.equal(f.read().backend, 'old');
    assert.equal(f.read().ingress, 'open');
    assert.deepEqual(f.read().writes, ['old-scheduled-write']);
  });
}

for (const failure of ['open-health', 'database-open']) {
  test(`${failure} after OPEN_COMMITTED fences writes without restoring an old snapshot`, (t) => {
    const f = lifecycle(t, failure);
    const result = f.command(
      'user-consolidation-migrate.sh',
      '--execute',
      f.run,
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(f.receipt().phase, 'NEEDS_FORWARD_RECOVERY');
    assert.equal(f.read().schema, 'new');
    assert.equal(f.read().ingress, 'closed');
    assert.equal(f.read().backend, null);
    assert.equal(
      f.read().dbPhase,
      failure === 'database-open' ? 'FENCED' : 'OPEN_COMMITTED',
    );
    assert.deepEqual(
      f.read().writes,
      failure === 'database-open' ? [] : ['new-scheduled-write'],
    );
  });
}

test(
  'an independent watchdog kills a hung owner and restores only once under the shared lock',
  { timeout: 30000 },
  async (t) => {
    const f = lifecycle(t, 'hang');
    const watcher = f.watch();
    await outputSignal(watcher, 'WATCHDOG_READY');
    const recovered = outputSignal(watcher, 'PHASE=ROLLED_BACK');
    const child = f.start();
    const exited = once(child, 'exit');
    await outputSignal(child, 'MIGRATION_HUNG');
    const receipt = f.receipt();
    writeFileSync(
      join(f.run, 'receipt.json'),
      JSON.stringify({ ...receipt, abortWall: 1 }),
    );
    await recovered;
    await exited;
    assert.equal(f.receipt().phase, 'ROLLED_BACK');
    const again = f.command('user-consolidation-watchdog.sh', '--once', f.root);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(
      f.events().filter((e) => e.name === 'schema-rolled-back').length,
      1,
    );
    assert.deepEqual(f.read().writes, ['old-scheduled-write']);
  },
);

for (const phase of [
  'FENCING',
  'FENCED',
  'BACKED_UP',
  'MIGRATING',
  'MIGRATED',
  'VERIFIED',
  'OPEN_COMMITTED',
  'OPEN',
]) {
  test(
    `a killed driver at ${phase} resumes without replaying destructive DDL`,
    { timeout: 30000 },
    async (t) => {
      const f = lifecycle(t);
      const child = f.start(phase);
      const exited = once(child, 'exit');
      await outputSignal(child, 'PHASE_BARRIER');
      assert.equal(f.killDriver().status, 0);
      await exited;
      // The real systemd unit is now inactive, and its entire cgroup has exited.
      const result = f.command(
        'user-consolidation-watchdog.sh',
        '--once',
        f.root,
      );
      const expected =
        phase === 'OPEN'
          ? 'OPEN'
          : phase === 'OPEN_COMMITTED'
            ? 'NEEDS_FORWARD_RECOVERY'
            : 'ROLLED_BACK';
      assert.equal(f.receipt().phase, expected, result.stderr);
      const replay = f.command(
        'user-consolidation-migrate.sh',
        '--execute',
        f.run,
      );
      assert.equal(replay.status, phase === 'OPEN' ? 0 : 1, replay.stderr);
      assert.equal(f.receipt().phase, expected);
      const migrated = [
        'MIGRATED',
        'VERIFIED',
        'OPEN_COMMITTED',
        'OPEN',
      ].includes(phase);
      assert.equal(
        f.events().filter((event) => event.name === 'schema-migrated').length,
        migrated ? 1 : 0,
      );
      assert.ok(
        f
          .events()
          .filter((event) => event.name === 'writer-started')
          .every((event) => event.open),
      );
      assert.equal(f.read().schema, phase.startsWith('OPEN') ? 'new' : 'old');
    },
  );
}

test('an unresolved receipt denies the ordinary deployment and no-op path', (t) => {
  const f = lifecycle(t);
  const result = f.command('user-consolidation-migrate.sh', '--guard');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unresolved-migration:PREPARED/);
  assert.equal(f.read().ingress, 'open');
  assert.equal(f.read().schema, 'old');
});

for (const action of ['prepare', 'open-previous']) {
  test(`${action} completes while its parent keeps stdin open`, async (t) => {
    const f = lifecycle(t);
    if (action === 'open-previous') {
      const fenced = f.command(
        'user-consolidation-watchdog-host.sh',
        'fence',
        f.run,
      );
      assert.equal(fenced.status, 0, fenced.stderr);
      assert.equal(f.state('phase', f.run, 'RECOVERING').status, 0);
      const verified = f.command(
        'user-consolidation-watchdog-host.sh',
        'verify-previous',
        f.run,
      );
      assert.equal(verified.status, 0, verified.stderr);
      assert.equal(f.state('commit-open', f.run, 'previous').status, 0);
      assert.equal(f.state('write-allowed', f.run, 'previous').status, 0);
    }
    const previousEvents = f.events().length;
    const child = f.hostWithOpenStdin(action);
    let stderr = '';
    child.stderr.on('data', (bytes) => {
      stderr += bytes;
    });
    child.stdout.resume();
    const completed = once(child, 'close', {
      signal: AbortSignal.timeout(10000),
    });
    t.after(() => child.stdin.destroy());
    // Do not end this pipe: the real helper must finish without waiting for EOF.
    child.stdin.write(`${action}\n`);
    const [code, signal] = await completed;
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    const world = f.read();
    assert.equal(world.ingress, 'open');
    assert.deepEqual(
      world.writes,
      action === 'prepare' ? [] : ['old-scheduled-write'],
    );
    if (action === 'open-previous') {
      assert.equal(world.schema, 'old');
      assert.equal(world.backend, 'old');
      assert.equal(world.blocked, false);
      assert.equal(world.hbaSaved, false);
      assert.equal(world.externalWriters, true);
      assert.equal(f.receipt().phase, 'OPEN_COMMITTED');
      assert.equal(f.receipt().target, 'previous');
    } else {
      assert.deepEqual(
        f
          .events()
          .slice(previousEvents)
          .filter((event) => event.name.startsWith('oneoff-completed:'))
          .map((event) => event.name),
        [
          'oneoff-completed:oss-hub-uc-artifact',
          'oneoff-completed:oss-hub-uc-capability',
          'oneoff-completed:oss-hub-uc-nginx-check',
        ],
      );
    }
  });
}

for (const failure of ['capability', 'image-artifact']) {
  test(`preparation refuses ${failure} without closing ingress or altering schema`, (t) => {
    const f = lifecycle(t);
    const world = f.read();
    if (failure === 'capability') world.failure = 'capability';
    else world.imageSql = 'changed migration';
    writeFileSync(join(f.root, 'world.json'), JSON.stringify(world));
    const result = f.command(
      'user-consolidation-watchdog-host.sh',
      'prepare',
      f.run,
    );
    assert.notEqual(result.status, 0);
    assert.equal(f.read().ingress, 'open');
    assert.equal(f.read().schema, 'old');
    assert.deepEqual(f.read().writes, []);
  });
}

test(
  'a second driver cannot acquire the live migration owner lock',
  { timeout: 30000 },
  async (t) => {
    const f = lifecycle(t);
    const child = f.start('FENCED');
    const exited = once(child, 'exit');
    await outputSignal(child, 'PHASE_BARRIER');
    const contender = f.command(
      'user-consolidation-migrate.sh',
      '--execute',
      f.run,
    );
    assert.equal(contender.status, 1);
    assert.match(contender.stderr, /migration-lock-held/);
    child.kill('SIGKILL');
    await exited;
    const recovered = f.command(
      'user-consolidation-watchdog.sh',
      '--once',
      f.root,
    );
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(f.receipt().phase, 'ROLLED_BACK');
  },
);

test('failed reverse SQL preserves the new schema behind the fence without starting the old image', (t) => {
  const f = lifecycle(t, 'rollback');
  const result = f.command('user-consolidation-migrate.sh', '--execute', f.run);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(f.receipt().phase, 'RECOVERY_FAILED');
  assert.equal(f.read().schema, 'new');
  assert.equal(f.read().ingress, 'closed');
  assert.equal(f.read().backend, null);
  assert.deepEqual(f.read().writes, []);
});
