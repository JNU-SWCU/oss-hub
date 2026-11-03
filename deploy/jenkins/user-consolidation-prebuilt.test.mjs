import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  mkdtempSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { lifecycle } from './user-consolidation-watchdog-fixture.mjs';

const candidateImageId = `sha256:${'2'.repeat(64)}`;

for (const classification of ['required', 'ordinary']) {
  test(`post-success retention preserves backups and limits cache pruning to ordinary: ${classification}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'uc-retention-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'deploy/jenkins'), { recursive: true });
    writeFileSync(
      join(root, 'bin/docker'),
      '#!/bin/sh\ncase "$1" in images) printf "oss-hub-backend\\tv1.1.0\\timage\\n";; buildx) printf "%s\\n" "$*" >> "$CACHE_LOG";; *) exit 9;; esac\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(root, 'deploy/jenkins/prune-deploy-backups.sh'),
      'printf "%s\\n" "$*" >> "$BACKUP_LOG"\n',
    );
    const pipeline = readFileSync(
      new URL('../../Jenkinsfile', import.meta.url),
      'utf8',
    );
    const script = [...pipeline.matchAll(/sh\s*'''([\s\S]*?)'''/g)]
      .map((match) => match[1])
      .find((body) => body.includes('retention_keep_tags=()'));
    assert.ok(script);
    const result = spawnSync('/bin/bash', ['-c', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        USER_CONSOLIDATION: classification,
        IMAGE_TAG: 'v1.1.0',
        PREV_TAG: 'v1.0.0',
        CONTROLLER_DIR: root,
        BACKUP_DIR: join(root, 'backups'),
        BACKUP_RETENTION_N: '30',
        BUILD_CACHE_MAX_SPACE: '5GB',
        CACHE_LOG: join(root, 'cache.log'),
        BACKUP_LOG: join(root, 'backup.log'),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      existsSync(join(root, 'cache.log')),
      classification === 'ordinary',
    );
    assert.deepEqual(
      readFileSync(join(root, 'backup.log'), 'utf8').trim().split('\n'),
      [
        `${join(root, 'backups')} 30`,
        `${join(root, 'backups/objects')} 30 --objects`,
      ],
    );
  });
}

function prebuilt(t) {
  const f = lifecycle(t);
  const rehearsal = {
    releaseSha: 'b'.repeat(40),
    previousImageId: `sha256:${'1'.repeat(64)}`,
    candidateImageId,
    restoreValidated: true,
    exclusiveWriters: true,
    writerUnits: ['external-writer.service'],
    recoverySeconds: 300,
  };
  f.env.RELEASE_TAG = 'v1.1.0';
  f.env.RELEASE_SHA = rehearsal.releaseSha;
  f.env.PREVIOUS_STATE = join(f.run, 'previous-state.json');
  f.env.UC_REHEARSAL_RECEIPT = join(f.run, 'rehearsal.json');
  // Only emulate GNU stat on Darwin; the production validator still requires uid 0.
  writeFileSync(
    join(f.root, 'bin/stat'),
    '#!/bin/sh\ncase "$2" in %u) echo "${FIXTURE_RECEIPT_UID:-0}";; %a) echo "${FIXTURE_RECEIPT_MODE:-600}";; *) exit 2;; esac\n',
    { mode: 0o755 },
  );
  writeFileSync(f.env.UC_REHEARSAL_RECEIPT, JSON.stringify(rehearsal));
  return { ...f, rehearsal };
}

for (const fault of [
  'none',
  'missing-receipt',
  'untrusted-receipt',
  'writable-receipt',
  'missing-id',
  'wrong-id',
  'previous',
  'sha',
  'missing-image',
  'revision',
  'version',
]) {
  test(`prebuilt verification binds the actual image before writes: ${fault}`, (t) => {
    const f = prebuilt(t);
    const receipt = { ...f.rehearsal };
    const world = f.read();
    switch (fault) {
      case 'none':
        break;
      case 'missing-receipt':
        break;
      case 'untrusted-receipt':
        f.env.FIXTURE_RECEIPT_UID = '501';
        break;
      case 'writable-receipt':
        f.env.FIXTURE_RECEIPT_MODE = '620';
        break;
      case 'missing-id':
        delete receipt.candidateImageId;
        break;
      case 'wrong-id':
        receipt.candidateImageId = `sha256:${'9'.repeat(64)}`;
        break;
      case 'previous':
        receipt.previousImageId = `sha256:${'9'.repeat(64)}`;
        break;
      case 'sha':
        receipt.releaseSha = 'c'.repeat(40);
        break;
      case 'missing-image':
        world.missingCandidate = true;
        break;
      case 'revision':
        world.candidateRevision = 'c'.repeat(40);
        break;
      case 'version':
        world.candidateVersion = 'v9.0.0';
        break;
      default:
        assert.fail('unknown fault');
    }
    writeFileSync(f.env.UC_REHEARSAL_RECEIPT, JSON.stringify(receipt));
    if (fault === 'missing-receipt') rmSync(f.env.UC_REHEARSAL_RECEIPT);
    writeFileSync(join(f.root, 'world.json'), JSON.stringify(world));
    const result = f.command(
      'user-consolidation-migrate.sh',
      '--verify-prebuilt',
    );
    assert.equal(result.status, fault === 'none' ? 0 : 1, result.stderr);
    if (fault === 'none') assert.equal(result.stdout.trim(), candidateImageId);
    else
      assert.match(
        result.stderr,
        /FAIL_CLOSED (?:missing-rehearsal|untrusted-rehearsal|writable-rehearsal|rehearsal-required|candidate-image-required|candidate-image-mismatch|candidate-revision-mismatch|candidate-version-mismatch)/,
      );
    assert.equal(f.read().ingress, 'open');
    assert.deepEqual(f.read().writes, []);
    assert.equal(f.receipt().phase, 'PREPARED');
  });
}

for (const timing of ['unchanged', 'before', 'after-artifacts']) {
  test(`preparation binds the rehearsed image with the tag ${timing}`, (t) => {
    const f = prebuilt(t);
    const change =
      timing === 'before'
        ? { candidateImageId: `sha256:${'9'.repeat(64)}` }
        : { moveAfterArtifacts: timing === 'after-artifacts' };
    writeFileSync(
      join(f.root, 'world.json'),
      JSON.stringify({ ...f.read(), ...change }),
    );
    const result = f.command(
      'user-consolidation-watchdog-host.sh',
      'prepare',
      f.run,
    );
    assert.equal(result.status, timing === 'unchanged' ? 0 : 1, result.stderr);
    if (timing === 'unchanged') {
      assert.equal(
        JSON.parse(readFileSync(join(f.run, 'candidate-image.json'), 'utf8'))
          .services.backend.image,
        candidateImageId,
      );
    }
    assert.equal(f.read().ingress, 'open');
    assert.deepEqual(f.read().writes, []);
  });
}

for (const classification of ['required', 'ordinary', 'noop']) {
  test(`pipeline classifies before selecting the ${classification} image build`, (t) => {
    const f = prebuilt(t);
    const pipeline = readFileSync(
      new URL('../../Jenkinsfile', import.meta.url),
      'utf8',
    );
    const env = {
      ...f.env,
      DEPLOY_NOOP: classification === 'noop' ? 'true' : 'false',
      IMAGE_TAG: 'v1.1.0',
      CONTROLLER_DIR: f.root,
      RELEASE_SOURCE: f.root,
    };
    mkdirSync(join(f.root, 'deploy'));
    symlinkSync(join(f.run, 'helpers'), join(f.root, 'deploy/jenkins'));
    // Execute the shipped stage conditions and shell bodies, not a copy of the routing.
    writeFileSync(
      join(f.root, 'bin/bash'),
      `#!/bin/sh\ncase "$*" in *--detect*) echo ${classification};; *--verify-prebuilt*) exec /bin/bash "$@";; *) exit 2;; esac\n`,
      { mode: 0o755 },
    );
    const eventsBefore = f.events().length;
    const stages = pipeline.split(/(?=    stage\()/);
    for (const stage of stages) {
      const shells = [...stage.matchAll(/sh(?:\(script:)?\s*'''([\s\S]*?)'''/g)]
        .map((match) => match[1])
        .filter((shell) => /--detect|docker build --file/.test(shell));
      if (shells.length === 0) continue;
      const condition = stage.match(/when \{ expression \{ (.*?) \} \}/)?.[1];
      if (condition && !runInNewContext(condition, { env })) continue;
      for (const shell of shells) {
        const result = spawnSync('/bin/bash', ['-c', shell], {
          env,
          cwd: f.root,
          encoding: 'utf8',
          timeout: 5000,
        });
        assert.equal(result.status, 0, result.stderr);
        if (shell.includes('--detect'))
          env.USER_CONSOLIDATION = result.stdout.trim();
        else
          assert.equal(
            env.USER_CONSOLIDATION,
            classification,
            'classification must precede build',
          );
      }
      if (env.USER_CONSOLIDATION === 'required') {
        for (const [, shell] of stage.matchAll(
          /sh '([^'\n]*--verify-prebuilt)'/g,
        )) {
          const result = spawnSync('/bin/bash', ['-c', shell], {
            env,
            cwd: f.root,
            encoding: 'utf8',
            timeout: 5000,
          });
          assert.equal(result.status, 0, result.stderr);
        }
      }
    }
    assert.equal(
      f.read().candidateImageId ?? candidateImageId,
      classification === 'ordinary'
        ? `sha256:${'9'.repeat(64)}`
        : candidateImageId,
    );
    if (classification === 'required') {
      assert.ok(
        f
          .events()
          .slice(eventsBefore)
          .some((event) => event.name === 'image-checked'),
      );
    }
  });
}

test('immutable Compose image keeps the migration client bound after tag drift', (t) => {
  const f = prebuilt(t);
  writeFileSync(
    join(f.root, 'world.json'),
    JSON.stringify({
      ...f.read(),
      candidateImageId: `sha256:${'9'.repeat(64)}`,
      ingress: 'closed',
      backend: null,
      blocked: true,
      hbaSaved: true,
      backupRestored: true,
    }),
  );
  const result = f.command(
    'user-consolidation-watchdog-host.sh',
    'migrate',
    f.run,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read().migrationImageId, candidateImageId);
  assert.equal(f.read().schema, 'new');
  assert.deepEqual(f.read().writes, []);
});

test('immutable Compose image keeps the verification container bound after tag drift', (t) => {
  const f = prebuilt(t);
  writeFileSync(
    join(f.root, 'world.json'),
    JSON.stringify({
      ...f.read(),
      candidateImageId: `sha256:${'9'.repeat(64)}`,
      schema: 'new',
      ingress: 'closed',
      backend: null,
      blocked: true,
      hbaSaved: true,
    }),
  );
  const result = f.command(
    'user-consolidation-watchdog-host.sh',
    'verify-candidate',
    f.run,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    f.read().containerImages['oss-hub-uc-candidate'],
    candidateImageId,
  );
  assert.equal(f.read().candidateReady, true);
  assert.deepEqual(f.read().writes, []);
});

for (const target of ['candidate', 'previous']) {
  test(`immutable Compose image keeps ${target} writers bound when the tag moves after inspection`, (t) => {
    const f = prebuilt(t);
    writeFileSync(
      join(f.root, 'world.json'),
      JSON.stringify({
        ...f.read(),
        moveTagAfterOpenCheck: true,
        backend: null,
        schema: target === 'candidate' ? 'new' : 'old',
        ingress: 'closed',
        blocked: true,
        hbaSaved: true,
      }),
    );
    assert.equal(
      f.state(
        'phase',
        f.run,
        target === 'candidate' ? 'VERIFIED' : 'RECOVERING',
      ).status,
      0,
    );
    assert.equal(f.state('commit-open', f.run, target).status, 0);
    const result = f.command(
      'user-consolidation-watchdog-host.sh',
      `open-${target}`,
      f.run,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      f.read().backendImageId,
      target === 'candidate' ? candidateImageId : `sha256:${'1'.repeat(64)}`,
    );
    assert.equal(f.read().ingress, 'open');
  });
}
