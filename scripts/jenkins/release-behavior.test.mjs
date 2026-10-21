import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
  realpathSync,
  symlinkSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'node:http';

const helpers = dirname(fileURLToPath(import.meta.url));
const oldId = `sha256:${'1'.repeat(64)}`;
const newId = `sha256:${'2'.repeat(64)}`;
const fakeDocker = String.raw`#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const a = process.argv.slice(2), root = process.env.FIXTURE;
const statePath = path.join(root, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath));
fs.appendFileSync(path.join(root,'ledger.jsonl'), JSON.stringify({command:'docker', args:a})+'\n');
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const output = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
if (a[0] === 'ps') { output(Object.keys(state.containers).join('\n')); }
else if (a[0] === 'inspect') {
  if (state.failure === 'inspect') process.exit(41);
  output([state.containers[a[1]]]);
} else if (a[0] === 'image' && a[1] === 'inspect') {
  const image = state.images[a.at(-1)];
  if (!image) process.exit(42);
  if (a.includes('--format')) {
    const format = a[a.indexOf('--format')+1];
    output(format.includes('.Id') ? image.Id : image.Config.Labels[format.includes('version') ? 'org.opencontainers.image.version' : 'org.opencontainers.image.revision']);
  } else output([image]);
} else if (a[0] === 'compose') {
  if (a[1] !== '-p' || a[2] !== 'oss-hub' || a[3] !== '-f' || a[5] !== '--env-file') process.exit(43);
  const compose = a[4], op = a[7], tag = process.env.IMAGE_TAG, candidate = tag === 'v1.1.0';
  if (op === 'up') {
    if (!a.includes('--force-recreate') || !a.includes('--no-deps')) process.exit(44);
    if (!candidate && state.failure === 'recovery') process.exit(45);
    if (!candidate && state.failure === 'recovery-key-drift') fs.writeFileSync(path.join(root,'secrets/old/collection.pem'), 'synthetic changed during recovery');
    const image = state.images['oss-hub-backend:'+tag];
    const be = state.containers.backend, ng = state.containers.nginx;
    be.Image = image.Id; be.Config.Image = 'oss-hub-backend:'+tag;
    Object.assign(be.Config.Labels, image.Config.Labels);
    for (const c of (candidate && state.failure === 'partial-up' ? [be] : [be,ng])) {
      c.Config.Labels['com.docker.compose.project.config_files'] = compose;
      c.Config.Labels['com.docker.compose.project.working_dir'] = path.dirname(compose);
    }
    for (const role of ['collection','operations']) {
      const source = process.env['GITHUB_'+role.toUpperCase()+'_APP_PRIVATE_KEY_SOURCE'];
      const m = be.Mounts.find(m => m.Destination.includes(role));
      m.Source = source;
      state.mountedKeys[role] = fs.readFileSync(source,'utf8');
    }
    if (!candidate && state.failure === 'recovery-mounted-key-drift') state.mountedKeys.collection = 'synthetic incorrect mounted bytes';
    if (!(candidate && state.failure === 'partial-up')) ng.Mounts[0].Source = path.join(path.dirname(compose),'deploy/nginx');
    state.active = candidate ? 'candidate' : 'previous';
    save();
    if (candidate && state.failure === 'old-key-drift') { fs.writeFileSync(path.join(root,'secrets/old/collection.pem'), 'synthetic replaced old key'); process.exit(46); }
    if (candidate && state.failure === 'diagnostic-hang') { console.error('CANDIDATE_UP_FAILED'); process.exit(46); }
    if (candidate && ['partial-up','recovery','recovery-key-drift','recovery-mounted-key-drift'].includes(state.failure)) process.exit(46);
  } else if (op === 'ps') {
    if (state.failure === 'diagnostic-hang') { console.error('SYNTHETIC_DIAGNOSTIC_HUNG'); setInterval(()=>{},10000); }
    if (state.failure === 'diagnostic') process.exit(47);
  } else if (op === 'exec') {
    if (a.includes('node')) {
      if (state.active === 'candidate' && state.failure === 'key-digest') output('mismatch');
      else { const role = a.at(-1).includes('collection') ? 'collection' : 'operations'; output(crypto.createHash('sha256').update(state.mountedKeys[role]).digest('hex')); }
    } else if (a.at(-1) === '-t' && candidate && ['nginx','diagnostic'].includes(state.failure)) process.exit(48);
  } else process.exit(49);
} else process.exit(50);
`;
const fakeCurl = String.raw`#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path');
const a=process.argv.slice(2), root=process.env.FIXTURE, s=JSON.parse(fs.readFileSync(path.join(root,'state.json')));
const url=a.at(-1), method=a[a.indexOf('--request')+1];
const file=a.find(v=>v.startsWith('file=@'));
const bytes=file ? fs.statSync(file.slice(6).split(';')[0]).size : null;
fs.appendFileSync(path.join(root,'ledger.jsonl'),JSON.stringify({command:'curl',url,method,bytes,args:a.filter(v=>!v.startsWith('file=@'))})+'\n');
if (process.env.CURL_TRANSPORT_FAILURE === '1') process.exit(7);
if (process.env.CURL_BAD_STATUS === '1' || (s.active === 'candidate' && s.failure === 'smoke')) {process.stdout.write('503');process.exit(0);}
process.stdout.write(url.endsWith('/health') ? '200' : url.endsWith('/') ? (url.startsWith('https') ? '200' : '404') : method === 'POST' || url.endsWith('/1') ? '401' : '404');
`;
const fakeMv = String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const a=process.argv.slice(2),root=process.env.FIXTURE,s=JSON.parse(fs.readFileSync(path.join(root,'state.json')));
if (a[0] !== '-Tf') process.exit(51);
fs.renameSync(a[1],a[2]);
fs.appendFileSync(path.join(root,'ledger.jsonl'), JSON.stringify({command:'key-swap',target:fs.readlinkSync(a[2])})+'\n');
if (s.failure === 'key-swap' && fs.readlinkSync(a[2]).endsWith('/new')) process.exit(52);
`;
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-behavior-')));
  const source = join(root, 'source');
  const previous = join(root, 'legacy-workspace');
  const candidate = join(root, 'runtime', 'release.unique');
  const secrets = join(root, 'secrets');
  const bin = join(root, 'bin');
  for (const path of [
    source,
    previous,
    candidate,
    bin,
    join(secrets, 'old'),
    join(secrets, 'new'),
  ])
    mkdirSync(path, { recursive: true });
  const git = (...args) => {
    const r = spawnSync('git', ['-C', source, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '--quiet');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.test');
  mkdirSync(join(source, 'deploy/nginx'), { recursive: true });
  writeFileSync(join(source, 'compose.yml'), 'services: synthetic\n');
  writeFileSync(
    join(source, 'deploy/nginx/default.conf'),
    'previous configuration\n',
  );
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'previous');
  const previousSha = git('rev-parse', 'HEAD');
  for (const path of ['compose.yml', 'deploy'])
    cpSync(join(source, path), join(previous, path), { recursive: true });
  writeFileSync(
    join(source, 'deploy/nginx/default.conf'),
    'candidate configuration\n',
  );
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'candidate');
  const candidateSha = git('rev-parse', 'HEAD');
  for (const path of ['compose.yml', 'deploy'])
    cpSync(join(source, path), join(candidate, path), { recursive: true });
  for (const role of ['collection', 'operations']) {
    writeFileSync(join(secrets, 'old', `${role}.pem`), `synthetic old ${role}`);
    writeFileSync(join(secrets, 'new', `${role}.pem`), `synthetic new ${role}`);
  }
  symlinkSync(join(secrets, 'old'), join(secrets, 'current'));
  const image = (tag, sha, id) => ({
    Id: id,
    Config: {
      Labels: {
        'org.opencontainers.image.version': tag,
        'org.opencontainers.image.revision': sha,
      },
    },
  });
  const images = {
    'oss-hub-backend:v1.0.0': image('v1.0.0', previousSha, oldId),
    'oss-hub-backend:v1.1.0': image('v1.1.0', candidateSha, newId),
  };
  const containers = Object.fromEntries(
    ['postgres', 'backend', 'nginx'].map((service) => [
      service,
      {
        Id: service,
        Image: oldId,
        Config: {
          Image: 'oss-hub-backend:v1.0.0',
          Healthcheck: { Test: ['CMD', 'synthetic'] },
          Labels: {
            'com.docker.compose.project': 'oss-hub',
            'com.docker.compose.service': service,
            'com.docker.compose.project.config_files': join(
              previous,
              'compose.yml',
            ),
            'com.docker.compose.project.working_dir': previous,
            ...images['oss-hub-backend:v1.0.0'].Config.Labels,
          },
          Env: [
            'SUBMISSION_FILE_STORAGE_MODE=managed',
            'SUBMISSION_FILE_S3_ENDPOINT=https://synthetic.example.test',
            'SUBMISSION_FILE_S3_REGION=auto',
            'SUBMISSION_FILE_S3_BUCKET=synthetic',
            'SUBMISSION_FILE_S3_FORCE_PATH_STYLE=true',
          ],
        },
        State: {
          Running: true,
          Status: 'running',
          Paused: false,
          Restarting: false,
          Dead: false,
          Health: { Status: 'healthy' },
        },
        Mounts: [],
      },
    ]),
  );
  containers.backend.Mounts = ['collection', 'operations'].map((role) => ({
    Type: 'bind',
    RW: false,
    Source: join(secrets, 'current', `${role}.pem`),
    Destination: `/run/secrets/github_${role}_app_private_key`,
  }));
  containers.nginx.Mounts = [
    {
      Type: 'bind',
      RW: false,
      Source: join(previous, 'deploy/nginx'),
      Destination: '/etc/nginx/conf.d',
    },
  ];
  const statePath = join(root, 'state.json');
  writeFileSync(
    statePath,
    JSON.stringify({
      containers,
      images,
      active: 'previous',
      mountedKeys: {
        collection: 'synthetic old collection',
        operations: 'synthetic old operations',
      },
    }),
  );
  writeFileSync(join(root, 'ledger.jsonl'), '');
  for (const [name, content] of [
    ['docker', fakeDocker],
    ['curl', fakeCurl],
    ['mv', fakeMv],
  ])
    writeFileSync(join(bin, name), content, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FIXTURE: root,
    CANDIDATE_COMPOSE: join(candidate, 'compose.yml'),
    PREVIOUS_STATE: join(root, 'previous.json'),
    PREVIOUS_KEY_IDENTITY: join(root, 'previous-keys.json'),
    STAGED_KEY_GENERATION: join(secrets, 'new'),
    SECRETS_DIR: secrets,
    OSS_HUB_ENV_FILE: join(root, 'env'),
    RELEASE_TAG: 'v1.1.0',
    RELEASE_SHA: candidateSha,
    RELEASE_SOURCE: source,
    R2_STORAGE_ACCESS_KEY_ID: 'synthetic-access',
    R2_STORAGE_SECRET_ACCESS_KEY: 'synthetic-secret',
  };
  writeFileSync(env.OSS_HUB_ENV_FILE, 'synthetic fixture\n');
  const invoke = (binary, args, extra = {}) => {
    const r = spawnSync(binary, args, {
      env: { ...env, ...extra },
      encoding: 'utf8',
    });
    writeFileSync(
      join(root, 'last-result.json'),
      JSON.stringify({ status: r.status, stdout: r.stdout, stderr: r.stderr }),
    );
    return r;
  };
  t.after(() => {
    if (process.env.RELEASE_BEHAVIOR_ARTIFACT_DIR) {
      const destination = join(
        process.env.RELEASE_BEHAVIOR_ARTIFACT_DIR,
        t.name.replace(/[^a-zA-Z0-9-]/g, '_'),
      );
      mkdirSync(destination, { recursive: true });
      writeFileSync(
        join(destination, 'ledger.json'),
        JSON.stringify(
          readFileSync(join(root, 'ledger.jsonl'), 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(JSON.parse),
          null,
          2,
        ),
      );
      writeFileSync(
        join(destination, 'filesystem.json'),
        JSON.stringify(
          {
            keyPointer: realpathSync(join(secrets, 'current')),
            previousNginx: readFileSync(
              join(previous, 'deploy/nginx/default.conf'),
              'utf8',
            ),
            candidateNginx: readFileSync(
              join(candidate, 'deploy/nginx/default.conf'),
              'utf8',
            ),
          },
          null,
          2,
        ),
      );
      for (const name of ['state.json', 'last-result.json'])
        cpSync(join(root, name), join(destination, name));
    }
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    source,
    previous,
    candidate,
    secrets,
    env,
    previousSha,
    candidateSha,
    invoke,
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    change: (fn) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      fn(state);
      writeFileSync(statePath, JSON.stringify(state));
    },
    ledger: () =>
      readFileSync(join(root, 'ledger.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse),
    probe: (tag = 'v1.1.0', sha = candidateSha, ...args) =>
      invoke(process.execPath, [
        join(helpers, 'probe-release-state.mjs'),
        tag,
        sha,
        ...args,
      ]),
    capture() {
      const r = this.probe(
        'v1.1.0',
        candidateSha,
        '--capture',
        source,
        secrets,
        env.PREVIOUS_KEY_IDENTITY,
      );
      assert.equal(r.status, 0, r.stderr);
      writeFileSync(env.PREVIOUS_STATE, r.stdout);
      assert.equal(statSync(env.PREVIOUS_KEY_IDENTITY).mode & 0o777, 0o600);
      const privateIdentity = JSON.parse(
        readFileSync(env.PREVIOUS_KEY_IDENTITY, 'utf8'),
      );
      for (const fingerprint of Object.values(privateIdentity.hashes))
        assert.equal((r.stdout + r.stderr).includes(fingerprint), false);
    },
    activate: () => invoke('bash', [join(helpers, 'activate-release.sh')]),
  };
}

for (const [name, tag] of [
  ['same release', 'v1.0.0'],
  ['lower stable', 'v0.9.9'],
])
  test(`${name} returns noop with Docker reads only`, (t) => {
    const f = fixture(t),
      before = readFileSync(join(f.root, 'state.json'));
    const r = f.probe(tag, f.previousSha);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).decision, 'noop');
    assert.deepEqual(readFileSync(join(f.root, 'state.json')), before);
    assert.equal(
      realpathSync(join(f.secrets, 'current')),
      join(f.secrets, 'old'),
    );
    assert.ok(
      f
        .ledger()
        .every(
          (call) =>
            call.command === 'docker' &&
            (['ps', 'inspect'].includes(call.args[0]) ||
              call.args.slice(0, 2).join(' ') === 'image inspect'),
        ),
    );
  });
const invalidStates = {
  stopped: (s) => {
    s.containers.backend.State.Running = false;
  },
  paused: (s) => {
    s.containers.backend.State.Paused = true;
  },
  restarting: (s) => {
    s.containers.backend.State.Restarting = true;
  },
  dead: (s) => {
    s.containers.backend.State.Dead = true;
  },
  unhealthy: (s) => {
    s.containers.postgres.State.Health.Status = 'unhealthy';
  },
  'missing health': (s) => {
    delete s.containers.backend.State.Health;
  },
  duplicate: (s) => {
    s.containers.second = s.containers.backend;
  },
  partial: (s) => {
    delete s.containers.nginx;
  },
  empty: (s) => {
    s.containers = {};
  },
  inspect: (s) => {
    s.failure = 'inspect';
  },
  'invalid label': (s) => {
    s.containers.backend.Config.Labels['org.opencontainers.image.version'] =
      'v01.0.0';
  },
  'image mismatch': (s) => {
    s.containers.backend.Config.Image = 'unexpected:tag';
  },
  'moved tag': (s) => {
    s.images['oss-hub-backend:v1.0.0'].Id = newId;
  },
  'invalid revision': (s) => {
    s.containers.backend.Config.Labels['org.opencontainers.image.revision'] =
      'main';
  },
  'image label mismatch': (s) => {
    s.images['oss-hub-backend:v1.0.0'].Config.Labels[
      'org.opencontainers.image.revision'
    ] = 'a'.repeat(40);
  },
};
for (const [name, mutate] of Object.entries(invalidStates))
  test(`${name} fails preflight without mutation`, (t) => {
    const f = fixture(t);
    f.change(mutate);
    const r = f.probe();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /FAIL_CLOSED/);
    assert.ok(
      f
        .ledger()
        .every(
          (call) => call.command === 'docker' && call.args[0] !== 'compose',
        ),
    );
  });
test('same tag different SHA fails', (t) => {
  const f = fixture(t);
  const r = f.probe('v1.0.0', f.candidateSha);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /same tag/);
});
test('missing or drifted previous configuration blocks capture', (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.previous, 'deploy/nginx/default.conf'),
    'unapproved bytes',
  );
  const r = f.probe('v1.1.0', f.candidateSha, '--capture', f.source, f.secrets);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /differs from revision/);
  rmSync(join(f.previous, 'compose.yml'));
  assert.notEqual(
    f.probe('v1.1.0', f.candidateSha, '--capture', f.source, f.secrets).status,
    0,
  );
});
test('quoted CRLF storage uses strict parser and compares active tuple', (t) => {
  const f = fixture(t);
  writeFileSync(
    f.env.OSS_HUB_ENV_FILE,
    'SUBMISSION_FILE_STORAGE_MODE="managed"\r\nSUBMISSION_FILE_S3_ENDPOINT=https://synthetic.example.test\r\nSUBMISSION_FILE_S3_REGION=auto\r\nSUBMISSION_FILE_S3_BUCKET=synthetic\r\nSUBMISSION_FILE_S3_FORCE_PATH_STYLE=true\r\n',
  );
  assert.equal(
    f.probe('v1.1.0', f.candidateSha, '--storage', f.env.OSS_HUB_ENV_FILE)
      .status,
    0,
  );
  f.change((s) => {
    s.containers.backend.Config.Env[0] = 'SUBMISSION_FILE_STORAGE_MODE=local';
  });
  assert.notEqual(
    f.probe('v1.1.0', f.candidateSha, '--storage', f.env.OSS_HUB_ENV_FILE)
      .status,
    0,
  );
});
test('legacy configuration survives activation into persistent snapshot', (t) => {
  const f = fixture(t);
  f.capture();
  const r = f.activate();
  assert.equal(r.status, 0, r.stderr);
  const s = f.state();
  assert.equal(s.containers.backend.Image, newId);
  assert.equal(
    s.containers.nginx.Mounts[0].Source,
    join(f.candidate, 'deploy/nginx'),
  );
  assert.equal(
    realpathSync(join(f.secrets, 'current')),
    join(f.secrets, 'new'),
  );
  assert.equal(
    readFileSync(join(f.previous, 'deploy/nginx/default.conf'), 'utf8'),
    'previous configuration\n',
  );
  assert.equal(s.mountedKeys.collection, 'synthetic new collection');
  assert.deepEqual(
    f
      .ledger()
      .filter((c) => c.bytes)
      .map((c) => c.bytes),
    [4194304, 4718592],
  );
});
for (const failure of [
  'key-swap',
  'partial-up',
  'key-digest',
  'nginx',
  'smoke',
  'diagnostic',
])
  test(`${failure} restores previous image config keys and still fails`, (t) => {
    const f = fixture(t);
    f.capture();
    f.change((s) => {
      s.failure = failure;
    });
    const r = f.activate();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RECOVERY=ok/);
    const s = f.state();
    assert.equal(s.containers.backend.Image, oldId);
    assert.equal(
      s.containers.nginx.Mounts[0].Source,
      join(f.previous, 'deploy/nginx'),
    );
    assert.equal(
      readFileSync(join(f.previous, 'deploy/nginx/default.conf'), 'utf8'),
      'previous configuration\n',
    );
    assert.equal(
      realpathSync(join(f.secrets, 'current')),
      join(f.secrets, 'old'),
    );
    assert.equal(s.mountedKeys.collection, 'synthetic old collection');
    assert.equal(s.mountedKeys.operations, 'synthetic old operations');
    assert.ok(
      f.ledger().some((c) => c.command === 'curl' && c.bytes === 4718592),
    );
    assert.ok(
      !f
        .ledger()
        .some((c) => c.command === 'docker' && c.args.includes('prune')),
    );
  });
test('double failure preserves both artifacts and reports recovery failure', (t) => {
  const f = fixture(t);
  f.capture();
  f.change((s) => {
    s.failure = 'recovery';
  });
  const r = f.activate();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ACTIVATION_FAILED/);
  assert.match(r.stderr, /RECOVERY_FAILED/);
  assert.doesNotMatch(r.stderr, /RECOVERY=ok/);
  assert.ok(readFileSync(f.env.PREVIOUS_STATE).length);
  assert.ok(readFileSync(f.env.CANDIDATE_COMPOSE).length);
  assert.equal(
    readFileSync(join(f.previous, 'deploy/nginx/default.conf'), 'utf8'),
    'previous configuration\n',
  );
  assert.ok(!f.ledger().some((c) => c.args?.includes('prune')));
});
for (const mode of ['ok', 'status', 'transport'])
  test(`shared HTTP smoke ${mode}`, (t) => {
    const f = fixture(t);
    const r = f.invoke('bash', [join(helpers, 'smoke-release.sh')], {
      CURL_BAD_STATUS: mode === 'status' ? '1' : '0',
      CURL_TRANSPORT_FAILURE: mode === 'transport' ? '1' : '0',
    });
    assert.equal(r.status === 0, mode === 'ok');
    if (mode === 'ok') {
      const calls = f.ledger();
      assert.equal(calls.filter((c) => c.command === 'curl').length, 16);
      assert.ok(
        calls.some(
          (c) => c.url.endsWith('/Submission-Files') && c.method === 'POST',
        ),
      );
      assert.deepEqual(
        calls.filter((c) => c.bytes).map((c) => c.bytes),
        [4194304, 4718592],
      );
    }
  });

for (const suffix of [
  'GITHUB_APP_ORG=secret-sentinel\n',
  'malformed secret-sentinel\n',
])
  test(`strict identity CLI rejects ${suffix.startsWith('GITHUB') ? 'duplicate' : 'malformed'} dotenv`, (t) => {
    const f = fixture(t);
    writeFileSync(
      f.env.OSS_HUB_ENV_FILE,
      'GITHUB_APP_ORG=synthetic-org\nGITHUB_COLLECTION_APP_ID=12345\nGITHUB_OPERATIONS_APP_ID=67890\n' +
        suffix,
    );
    const r = f.invoke(process.execPath, [
      join(helpers, 'validate-github-app-credentials.mjs'),
      f.env.OSS_HUB_ENV_FILE,
      join(f.secrets, 'new/collection.pem'),
      join(f.secrets, 'new/operations.pem'),
    ]);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stderr, /secret-sentinel/);
    assert.deepEqual(f.ledger(), []);
    const storage = f.probe(
      'v1.1.0',
      f.candidateSha,
      '--storage',
      f.env.OSS_HUB_ENV_FILE,
    );
    assert.notEqual(storage.status, 0);
    assert.doesNotMatch(storage.stderr, /secret-sentinel/);
  });

function invokeBounded(f, binary, args, extra = {}, deadlineMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: { ...f.env, ...extra },
      detached: true,
    });
    let stdout = '',
      stderr = '',
      timedOut = false;
    const guard = setTimeout(() => {
      timedOut = true;
      process.kill(-child.pid, 'SIGKILL');
    }, deadlineMs);
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', (error) => {
      clearTimeout(guard);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(guard);
      const result = { status, signal, stdout, stderr, timedOut };
      writeFileSync(join(f.root, 'last-result.json'), JSON.stringify(result));
      resolve(result);
    });
  });
}

test('unresponsive diagnostic cannot delay single recovery', async (t) => {
  const f = fixture(t);
  f.capture();
  f.change((s) => {
    s.failure = 'diagnostic-hang';
  });
  const r = await invokeBounded(f, 'bash', [
    join(helpers, 'activate-release.sh'),
  ]);
  assert.match(r.stderr, /CANDIDATE_UP_FAILED/);
  assert.equal(
    r.timedOut,
    false,
    'recovery must complete without waiting for diagnostics',
  );
  assert.equal(r.status, 46);
  assert.match(r.stderr, /RECOVERY=ok/);
  assert.equal(f.ledger().filter((c) => c.args?.includes('up')).length, 2);
  assert.equal(
    f
      .ledger()
      .filter((c) => c.args?.[0] === 'compose' && c.args?.includes('ps'))
      .length,
    0,
  );
  assert.equal(
    realpathSync(join(f.secrets, 'current')),
    join(f.secrets, 'old'),
  );
});

test('original previous key drift never certifies recovery', (t) => {
  const f = fixture(t);
  f.capture();
  f.change((s) => {
    s.failure = 'old-key-drift';
  });
  const r = f.activate();
  assert.equal(r.status, 46);
  assert.match(r.stderr, /RECOVERY_FAILED/);
  assert.doesNotMatch(r.stderr, /RECOVERY=ok/);
  assert.equal(f.ledger().filter((c) => c.args?.includes('up')).length, 1);
  assert.equal(
    realpathSync(join(f.secrets, 'current')),
    join(f.secrets, 'new'),
  );
});

test('every smoke request including uploads has finite curl deadlines', (t) => {
  const f = fixture(t);
  const r = f.invoke('bash', [join(helpers, 'smoke-release.sh')]);
  assert.equal(r.status, 0, r.stderr);
  const calls = f.ledger().filter((c) => c.command === 'curl');
  assert.equal(calls.length, 16);
  for (const call of calls) {
    for (const option of [
      '--connect-timeout',
      '--max-time',
      '--retry-max-time',
    ]) {
      const index = call.args.indexOf(option);
      assert.ok(index >= 0, `missing ${option}`);
      const bound = Number(call.args[index + 1]);
      assert.ok(Number.isFinite(bound) && bound > 0 && bound <= 60);
    }
  }
});

for (const failure of ['recovery-key-drift', 'recovery-mounted-key-drift'])
  test(`${failure} fails against captured original identity`, (t) => {
    const f = fixture(t);
    f.capture();
    f.change((s) => {
      s.failure = failure;
    });
    const r = f.activate();
    assert.equal(r.status, 46);
    assert.match(r.stderr, /RECOVERY_FAILED/);
    assert.doesNotMatch(r.stderr, /RECOVERY=ok/);
    assert.equal(f.ledger().filter((c) => c.args?.includes('up')).length, 2);
    const identity = JSON.parse(
      readFileSync(f.env.PREVIOUS_KEY_IDENTITY, 'utf8'),
    );
    for (const fingerprint of Object.values(identity.hashes))
      assert.equal((r.stdout + r.stderr).includes(fingerprint), false);
  });

test('real curl terminates an accepted stalled loopback request', async (t) => {
  const realCurl = spawnSync('which', ['curl'], { encoding: 'utf8' });
  assert.equal(realCurl.status, 0);
  const f = fixture(t);
  let accepted = 0;
  const server = createServer(() => {
    accepted += 1;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  writeFileSync(
    join(f.root, 'bin/curl'),
    `#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
args[args.length-1]=process.env.LOOPBACK_URL;
const result=spawnSync(process.env.REAL_CURL,args,{stdio:'inherit'});
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  const r = await invokeBounded(
    f,
    'bash',
    [join(helpers, 'smoke-release.sh')],
    {
      REAL_CURL: realCurl.stdout.trim(),
      LOOPBACK_URL: `http://127.0.0.1:${server.address().port}/`,
      NO_PROXY: '127.0.0.1',
      no_proxy: '127.0.0.1',
    },
    60000,
  );
  assert.ok(
    accepted > 0,
    'the local server must accept the actual curl request',
  );
  assert.equal(r.timedOut, false, 'curl must expire before the harness guard');
  assert.equal(r.status, 28);
  assert.doesNotMatch(r.stdout, /RELEASE_SMOKE=ok/);
});
