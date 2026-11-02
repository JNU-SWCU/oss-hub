import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { connect } from 'node:net';
import test from 'node:test';
import { lifecycle } from './user-consolidation-watchdog-fixture.mjs';

const helpers = dirname(fileURLToPath(import.meta.url));

for (const mode of ['expired', 'receipt-error']) {
  for (const context of [
    'if step fence; then :; fi',
    'step fence && :',
    'step fence || :',
  ]) {
    test(`H2 refuses ${mode} budget in conditional context ${context}`, (t) => {
      const f = lifecycle(t);
      writeFileSync(
        join(f.run, 'receipt.json'),
        mode === 'expired'
          ? JSON.stringify({ ...f.receipt(), endWall: 1 })
          : '{invalid-json',
      );
      const probe = spawnSync(
        'bash',
        [
          '-c',
          `
        source "$1" --guard
        timeout() { printf 'HOST_ACTION\\n'; }
        run="$2"; boot=boot-one; budget=recovery
        ${context}
        printf 'PROBE_FINISHED\\n'
      `,
          'probe',
          join(helpers, 'user-consolidation-migrate.sh'),
          f.run,
        ],
        {
          env: { ...f.env, UC_STATE_ROOT: join(f.root, 'empty-state') },
          encoding: 'utf8',
          timeout: 5000,
        },
      );
      assert.equal(probe.status, 0, probe.stderr);
      assert.doesNotMatch(probe.stdout, /HOST_ACTION/);
      assert.match(probe.stdout, /PROBE_FINISHED/);
    });
  }
}

test('H2 expired recovery only holds the fence and never starts old writers', (t) => {
  const f = lifecycle(t);
  writeFileSync(
    join(f.run, 'receipt.json'),
    JSON.stringify({ ...f.receipt(), endWall: 1 }),
  );
  const result = f.command('user-consolidation-migrate.sh', '--recover', f.run);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(f.receipt().phase, 'RECOVERY_FAILED');
  assert.equal(f.read().ingress, 'closed');
  assert.deepEqual(f.read().writes, []);
  assert.equal(f.read().schema, 'old');
});

test('H2 timeout zero disables its deadline like GNU timeout', (t) => {
  const f = lifecycle(t);
  const result = spawnSync(
    'timeout',
    ['0', process.execPath, '-e', 'process.stdout.write("COMPLETED")'],
    { env: f.env, encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'COMPLETED');
});

test('H4 recovery accepts the canonical path inside the same trusted root', (t) => {
  const f = lifecycle(t);
  const result = f.command(
    'user-consolidation-migrate.sh',
    '--recover',
    realpathSync(f.run),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.receipt().phase, 'ROLLED_BACK');
});

for (const entry of ['--guard', '--detect', '--start']) {
  test(`H4 ${entry} refuses inaccessible state instead of treating it as absent`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'uc-permission-'));
    const privateRoot = join(root, 'private'),
      state = join(privateRoot, 'state');
    mkdirSync(state, { recursive: true, mode: 0o700 });
    t.after(() => {
      chmodSync(privateRoot, 0o700);
      rmSync(root, { recursive: true });
    });
    chmodSync(privateRoot, 0);
    const result = spawnSync(
      'bash',
      [join(helpers, 'user-consolidation-migrate.sh'), entry],
      {
        env: {
          ...process.env,
          UC_STATE_ROOT: state,
          UC_ISOLATED_HOST: '1',
          RELEASE_SOURCE: root,
        },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /state-access/);
  });
}

test('H1 rejects an unknown backend one-off without deleting it or opening ingress', (t) => {
  const f = lifecycle(t);
  writeFileSync(
    join(f.root, 'world.json'),
    JSON.stringify({ ...f.read(), containers: ['unknown-run'] }),
  );
  const result = f.command('user-consolidation-migrate.sh', '--recover', f.run);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(f.read().ingress, 'closed');
  assert.deepEqual(f.read().containers, ['unknown-run']);
  assert.deepEqual(f.read().writes, []);
});

for (const mismatch of ['run', 'image']) {
  test(`H1 fence rejects a reserved one-off with a different ${mismatch} identity`, (t) => {
    const f = lifecycle(t),
      name = 'oss-hub-uc-candidate';
    writeFileSync(
      join(f.root, 'world.json'),
      JSON.stringify({
        ...f.read(),
        containers: [name],
        owners: { [name]: mismatch === 'run' ? 'another-run' : f.run },
        containerImages: {
          [name]: `sha256:${(mismatch === 'image' ? '9' : '2').repeat(64)}`,
        },
      }),
    );
    const result = f.command(
      'user-consolidation-watchdog-host.sh',
      'fence',
      f.run,
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(f.read().ingress, 'closed');
    assert.equal(f.read().backend, null);
    assert.equal(f.read().blocked, true);
    assert.deepEqual(f.read().containers, [name]);
    assert.equal(
      f.events().some((event) => event.name === `container-stopped:${name}`),
      false,
    );
  });
}

test(
  'H3 waits for exact candidate readiness before probing its maintenance state',
  { timeout: 45000 },
  async (t) => {
    const f = lifecycle(t, 'delayed-start');
    const child = f.start();
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(40000) });
    const waiting = new Promise((resolve, reject) => {
      let output = '';
      const receive = (bytes) => {
        output += bytes;
        if (output.includes('READINESS_WAIT')) resolve();
      };
      child.stdout.on('data', receive);
      child.stderr.on('data', receive);
      child.once('exit', () =>
        reject(new Error('driver exited before readiness barrier')),
      );
      child.once('error', reject);
    });
    await waiting;
    assert.equal(
      f.events().some((event) => event.name === 'candidate-verified'),
      false,
    );
    const socket = connect(join(f.root, 'readiness.sock'));
    const connected = once(socket, 'connect', {
      signal: AbortSignal.timeout(5000),
    });
    t.after(() => socket.destroy());
    await connected;
    socket.end('healthy');
    const [code] = await exited;
    assert.equal(code, 0);
    assert.equal(f.receipt().phase, 'OPEN');
    assert.deepEqual(
      f
        .events()
        .filter((event) =>
          ['candidate-ready', 'candidate-verified'].includes(event.name),
        )
        .map((event) => event.name),
      ['candidate-ready', 'candidate-verified'],
    );
  },
);

test('H3 failed startup recovers without invoking a maintenance probe on the stopped candidate', (t) => {
  const f = lifecycle(t, 'failed-start');
  const result = f.command('user-consolidation-migrate.sh', '--execute', f.run);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(f.receipt().phase, 'ROLLED_BACK', result.stderr);
  assert.equal(f.read().backend, 'old');
  assert.equal(f.read().containers.length, 0);
  assert.equal(
    f.events().some((event) => event.name === 'candidate-start-failed'),
    true,
  );
  assert.equal(
    f.events().some((event) => event.name === 'candidate-verified'),
    false,
  );
});
