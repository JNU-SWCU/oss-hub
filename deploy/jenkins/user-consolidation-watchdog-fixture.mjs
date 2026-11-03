import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const helpers = dirname(fileURLToPath(import.meta.url));
import { fakeCommand } from './user-consolidation-watchdog-fake-host.mjs';

export function lifecycle(t, failure = '') {
  const root = mkdtempSync(join(tmpdir(), 'uc-lifecycle-')),
    run = join(root, 'run'),
    bin = join(root, 'bin');
  const owned = [];
  const closed = new Set();
  for (const directory of [
    bin,
    join(run, 'helpers'),
    join(run, 'sql'),
    join(run, 'candidate'),
    join(run, 'previous'),
    join(root, 'keys'),
  ])
    mkdirSync(directory, { recursive: true });
  t.after(async () => {
    for (const child of owned) {
      if (closed.has(child)) continue;
      const ended = once(child, 'close', { signal: AbortSignal.timeout(2000) });
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        // Darwin can return EPERM for a process group containing only reaped/zombie members.
        if (
          error.code !== 'ESRCH' &&
          !(error.code === 'EPERM' && child.signalCode !== null)
        )
          throw error;
      }
      await ended;
    }
    rmSync(root, { recursive: true, force: true });
  });
  for (const name of [
    'migrate.sh',
    'watchdog.sh',
    'watchdog-host.sh',
    'watchdog-recovery.sh',
    'watchdog-state.mjs',
    'watchdog-access.mjs',
  ])
    cpSync(
      join(helpers, `user-consolidation-${name}`),
      join(run, 'helpers', `user-consolidation-${name}`),
    );
  for (const command of [
    'docker',
    'systemctl',
    'systemd-id128',
    'systemd-notify',
    'nginx',
    'curl',
    'sync',
  ])
    writeFileSync(join(bin, command), fakeCommand, { mode: 0o755 });
  writeFileSync(
    join(bin, 'node'),
    `#!${process.execPath}
const{spawnSync}=require('node:child_process'),fs=require('node:fs'),net=require('node:net');
const a=process.argv.slice(2),result=spawnSync(${JSON.stringify(process.execPath)},a,{stdio:'inherit',env:process.env});
if(result.status!==0)process.exit(result.status??1);
if(a[0].endsWith('watchdog-state.mjs')&&['phase','commit-open'].includes(a[1])&&process.env.HOLD_PHASE){
  const r=JSON.parse(fs.readFileSync(a[2]+'/receipt.json'));
  if(r.phase===process.env.HOLD_PHASE)net.createServer().listen(process.env.FIXTURE+'/phase.sock',()=>console.log('PHASE_BARRIER'));
}
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'mv'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a[0]!=='-Tf')process.exit(2);fs.renameSync(a[1],a[2]);\n`,
    { mode: 0o755 },
  );
  // BSD and Linux flock both attach the lock to the inherited open-file description.
  writeFileSync(
    join(bin, 'flock'),
    '#!/usr/bin/perl\nuse strict; use Fcntl qw(:flock); my ($op,$fd)=@ARGV; open(my $f,"<&=$fd") or die $!; flock($f,$op eq "-u" ? LOCK_UN : LOCK_EX|LOCK_NB) or exit 1;\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'timeout'),
    `#!${process.execPath}
const{spawn}=require('node:child_process');const a=process.argv.slice(2);
while(a[0]?.startsWith('-')){const x=a.shift();if(x==='-k')a.shift();}
const seconds=Number(a.shift()),p=spawn(a.shift(),a,{stdio:'inherit',env:process.env});
let timedOut=false;
const timer=seconds===0?null:setTimeout(()=>{timedOut=true;p.kill('SIGKILL');},seconds*1000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>p.kill(signal));
p.on('exit',(code)=>{clearTimeout(timer);process.exit(timedOut?124:code??1);});
`,
    { mode: 0o755 },
  );
  const nginx = join(root, 'nginx.conf');
  writeFileSync(nginx, 'server {\n server_name origin.jnu-oss-hub.com;\n}\n');
  cpSync(nginx, join(run, 'expected-host-nginx.conf'));
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FIXTURE: root,
    UC_HOST_NGINX: nginx,
    UC_STATE_ROOT: root,
    UC_ISOLATED_HOST: '1',
  };
  const context = {
    UC_STATE_ROOT: root,
    UC_RUN: run,
    RELEASE_TAG: 'v1.1.0',
    RELEASE_SHA: 'b'.repeat(40),
    SECRETS_DIR: join(root, 'keys'),
    STAGED_KEY_GENERATION: join(root, 'keys'),
    PREV_POSTGRES_ID: 'postgres',
    UC_HOST_NGINX: nginx,
  };
  writeFileSync(
    join(run, 'context.sh'),
    Object.entries(context)
      .map(([key, value]) => `export ${key}='${value}'`)
      .join('\n'),
  );
  writeFileSync(
    join(run, 'previous-state.json'),
    JSON.stringify({
      tag: 'v1.0.0',
      sha: 'a'.repeat(40),
      imageId: `sha256:${'1'.repeat(64)}`,
      generation: join(root, 'keys'),
    }),
  );
  writeFileSync(
    join(run, 'previous-keys.json'),
    JSON.stringify({
      hashes: Object.fromEntries(
        ['collection', 'operations'].map((role) => {
          writeFileSync(join(root, 'keys', `${role}.pem`), role);
          return [role, createHash('sha256').update(role).digest('hex')];
        }),
      ),
    }),
  );
  writeFileSync(
    join(run, 'rehearsal.json'),
    JSON.stringify({
      releaseSha: context.RELEASE_SHA,
      previousImageId: `sha256:${'1'.repeat(64)}`,
      candidateImageId: `sha256:${'2'.repeat(64)}`,
      restoreValidated: true,
      exclusiveWriters: true,
      writerUnits: ['external-writer.service'],
      recoverySeconds: 300,
    }),
  );
  writeFileSync(
    join(run, 'candidate.env'),
    'DATABASE_URL=postgresql://u:p@postgres/app\n',
  );
  const imageSql = '-- MIGRATION_ARTIFACT\nSELECT 1;\n';
  const sha256 = {
    migration: createHash('sha256').update(imageSql).digest('hex'),
  };
  for (const name of ['preflight', 'reconcile', 'rollback', 'open']) {
    const sql = `-- ${name.toUpperCase()}_ARTIFACT\nSELECT 1;\n`;
    writeFileSync(join(run, 'sql', `${name}.sql`), sql);
    sha256[name] = createHash('sha256').update(sql).digest('hex');
  }
  writeFileSync(
    join(run, 'sql/manifest.json'),
    JSON.stringify({
      version: 1,
      migrationId: '20261102160000_consolidate_user_domain',
      previousMigrationId: '20261031000000_previous',
      sha256,
    }),
  );
  writeFileSync(
    join(root, 'world.json'),
    JSON.stringify({
      failure,
      imageSql,
      ledger: [],
      schema: 'old',
      ingress: 'open',
      backend: 'old',
      restart: true,
      blocked: false,
      hbaSaved: false,
      clone: null,
      containers: [],
      writes: [],
    }),
  );
  symlinkSync(run, join(root, 'active'));
  const command = (script, ...args) =>
    spawnSync('bash', [join(run, 'helpers', script), ...args], {
      env,
      encoding: 'utf8',
      timeout: 45000,
    });
  const prepared = command(
    'user-consolidation-watchdog-host.sh',
    'prepare',
    run,
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const state = (...args) =>
    spawnSync(
      process.execPath,
      [join(run, 'helpers/user-consolidation-watchdog-state.mjs'), ...args],
      { env, encoding: 'utf8', timeout: 5000 },
    );
  assert.equal(state('init', run, 'boot-one', '300', '{}').status, 0);
  assert.equal(state('armed', run, 'boot-one').status, 0);
  return {
    root,
    run,
    env,
    state,
    command,
    hostWithOpenStdin: (action) => {
      // Wait for the test's trigger so completion/error listeners precede the action.
      const child = spawn(
        'bash',
        [
          '-c',
          'IFS= read -r trigger; exec bash "$1" "$2" "$3"',
          'host-with-open-stdin',
          join(run, 'helpers/user-consolidation-watchdog-host.sh'),
          action,
          run,
        ],
        { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      owned.push(child);
      child.once('close', () => closed.add(child));
      return child;
    },
    read: () => JSON.parse(readFileSync(join(root, 'world.json'), 'utf8')),
    receipt: () => JSON.parse(readFileSync(join(run, 'receipt.json'), 'utf8')),
    events: () =>
      readFileSync(join(root, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse),
    killDriver: () =>
      spawnSync(
        'systemctl',
        [
          'kill',
          '--kill-whom=all',
          '--signal=KILL',
          'oss-hub-user-consolidation-driver.service',
        ],
        { env, encoding: 'utf8', timeout: 5000 },
      ),
    start: (phase = '') => {
      const child = spawn(
        'bash',
        [join(run, 'helpers/user-consolidation-migrate.sh'), '--execute', run],
        {
          env: { ...env, HOLD_PHASE: phase },
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      writeFileSync(join(root, 'driver.pid'), String(child.pid));
      owned.push(child);
      child.once('close', () => closed.add(child));
      return child;
    },
    watch: () => {
      const child = spawn(
        'bash',
        [join(run, 'helpers/user-consolidation-watchdog.sh'), '--watch', root],
        { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      owned.push(child);
      child.once('close', () => closed.add(child));
      return child;
    },
  };
}
