import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const checkerPath = fileURLToPath(
  new URL('./check-auth-production-readonly.sh', import.meta.url),
);
const root = mkdtempSync(join(tmpdir(), 'auth-production-readonly-'));
const bin = join(root, 'bin');
const envFile = join(root, 'synthetic-production.env');
const tag = 'v0.8.0';
const sha = 'a'.repeat(40);
const url = 'https://public.test';
const DAY_SECONDS = 86400;

let outputSequence = 0;

mkdirSync(bin);
writeFileSync(envFile, 'SYNTHETIC_ONLY=true\n');

// curl 은 상태 코드만 돌려준다. 본문을 흉내내지 않아 행 값이 fixture 에 들어오지 않는다.
writeExecutable(
  'curl',
  `#!/usr/bin/env bash
set -euo pipefail
target="\${*: -1}"
case "$target" in
  */api/v1/health) printf '%s' "\$HEALTH_STATUS" ;;
  */api/v1/auth/session) printf '%s' "\$SESSION_STATUS" ;;
  */api/v1/users/me/profile) printf '%s' "\$PROTECTED_STATUS" ;;
  *) printf 'unexpected curl target\\n' >&2; exit 1 ;;
esac
`,
);

writeExecutable(
  'docker',
  `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == compose ]]; then
  [[ "$2" == --env-file && -n "$3" ]]
  shift 3
  case "$*" in
    "ps -q frontend") printf 'frontend-container\\n' ;;
    "ps -q backend") printf 'backend-container\\n' ;;
    exec*postgres*psql*) printf '%s\\n' "\$AGGREGATE_JSON" ;;
    *) printf 'unexpected compose command\\n' >&2; exit 1 ;;
  esac
  exit 0
fi
case "$*" in
  inspect*frontend-container) printf 'oss-hub-frontend:%s|%s|%s|%s|running|healthy\\n' "\$FIXTURE_TAG" "\$FIXTURE_TAG" "\$FIXTURE_SHA" "\$FRONTEND_IMAGE_ID" ;;
  inspect*backend-container) printf 'oss-hub-backend:%s|%s|%s|%s|running|healthy\\n' "\$FIXTURE_TAG" "\$FIXTURE_TAG" "\$FIXTURE_SHA" "\$BACKEND_IMAGE_ID" ;;
  "image inspect --format {{.Id}} oss-hub-frontend:\$FIXTURE_TAG") printf '%s\\n' "\$FRONTEND_IMAGE_ID" ;;
  "image inspect --format {{.Id}} oss-hub-backend:\$FIXTURE_TAG") printf '%s\\n' "\$BACKEND_IMAGE_ID" ;;
  *) printf 'unexpected docker command\\n' >&2; exit 1 ;;
esac
`,
);

after(() => rmSync(root, { recursive: true, force: true }));

test('start captures an aggregate-only observation baseline', () => {
  const output = outputPath('start');
  const result = runChecker(['start', tag, sha, url, output]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.mode, 'start');
  assert.deepEqual(report.release, { tag, sha });
  assert.equal(report.images.frontend.imageId, 'sha256:frontend');
  assert.deepEqual(report.routes, {
    public: 200,
    optionalSession: 200,
    anonymousProtected: 401,
  });
  assert.equal(report.aggregate.totalUsers, 62);
  assert.equal(report.aggregate.totalProfiles, 62);
  assert.equal(report.aggregate.memberKinds.NULL, 0);
  assert.equal(report.aggregate.blankNames, 0);
  assert.equal(report.aggregate.staffAccessRequests.PENDING, 0);
  assert.equal(report.observation.elapsedSeconds, 0);
  // 행 값이 담기는 필드는 애초에 report 로 넘어오지 않는다.
  assert.equal('rows' in report, false);
  assert.equal('legacyRoles' in report.aggregate, false);
});

test('finish requires the same image and a full 24-hour window', () => {
  const baseline = startBaseline();

  const short = runChecker([
    'finish',
    tag,
    sha,
    url,
    baseline(DAY_SECONDS - 60),
    outputPath('short'),
  ]);
  assert.equal(short.status, 1);

  const changedImage = runChecker(
    ['finish', tag, sha, url, baseline(DAY_SECONDS), outputPath('changed')],
    { frontendImageId: 'sha256:rebuilt' },
  );
  assert.equal(changedImage.status, 1);

  const output = outputPath('finish');
  const ok = runChecker([
    'finish',
    tag,
    sha,
    url,
    baseline(DAY_SECONDS),
    output,
  ]);
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.mode, 'finish');
  assert.ok(report.observation.elapsedSeconds >= DAY_SECONDS);
});

test('postdeploy validates one release and never accepts a start file', () => {
  const output = outputPath('postdeploy');
  const ok = runChecker(['postdeploy', tag, sha, url, output]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).mode, 'postdeploy');

  // Todo 12 의 start 파일을 Todo 14 가 재사용하려는 시도는 arity 에서 거부된다.
  const reused = runChecker([
    'postdeploy',
    tag,
    sha,
    url,
    startBaseline()(DAY_SECONDS),
    outputPath('reused'),
  ]);
  assert.equal(reused.status, 2);

  const wrongTag = runChecker([
    'postdeploy',
    'v0.9.0',
    sha,
    url,
    outputPath('wrong-tag'),
  ]);
  assert.equal(wrongTag.status, 1);

  const wrongSha = runChecker([
    'postdeploy',
    tag,
    'b'.repeat(40),
    url,
    outputPath('wrong-sha'),
  ]);
  assert.equal(wrongSha.status, 1);
});

test('route status drift fails closed', () => {
  const anonymousAccess = runChecker(
    ['postdeploy', tag, sha, url, outputPath('anon-protected')],
    { protectedStatus: '200' },
  );
  assert.equal(anonymousAccess.status, 1);

  const unhealthy = runChecker(
    ['postdeploy', tag, sha, url, outputPath('unhealthy')],
    { healthStatus: '503' },
  );
  assert.equal(unhealthy.status, 1);

  const sessionDrift = runChecker(
    ['postdeploy', tag, sha, url, outputPath('session')],
    { sessionStatus: '401' },
  );
  assert.equal(sessionDrift.status, 1);
});

test('aggregate drift and unresolved authority fail closed', () => {
  const nullMemberKinds = runChecker(
    ['postdeploy', tag, sha, url, outputPath('null-member-kind')],
    { aggregateJson: JSON.stringify(aggregate({ nullMemberKinds: 1 })) },
  );
  assert.equal(nullMemberKinds.status, 1);

  const blankNames = runChecker(
    ['postdeploy', tag, sha, url, outputPath('blank-names')],
    { aggregateJson: JSON.stringify(aggregate({ blankNames: 2 })) },
  );
  assert.equal(blankNames.status, 1);

  const wrongVersion = runChecker(
    ['postdeploy', tag, sha, url, outputPath('version')],
    {
      aggregateJson: JSON.stringify({
        ...aggregate(),
        version: 'unexpected-version',
      }),
    },
  );
  assert.equal(wrongVersion.status, 1);

  const malformed = runChecker(
    ['postdeploy', tag, sha, url, outputPath('malformed')],
    { aggregateJson: '{' },
  );
  assert.equal(malformed.status, 1);
});

test('missing or unreadable production env fails without leaking the path', () => {
  const missing = join(root, 'synthetic-missing.env');
  const missingResult = runChecker(
    ['postdeploy', tag, sha, url, outputPath('missing-env')],
    { envPath: missing },
  );
  assert.equal(missingResult.status, 1);
  assert.doesNotMatch(missingResult.stderr, new RegExp(missing));

  const unreadable = join(root, 'synthetic-unreadable.env');
  writeFileSync(unreadable, 'SYNTHETIC_ONLY=true\n');
  chmodSync(unreadable, 0o000);
  const unreadableResult = runChecker(
    ['postdeploy', tag, sha, url, outputPath('unreadable-env')],
    { envPath: unreadable },
  );
  chmodSync(unreadable, 0o600);
  assert.equal(unreadableResult.status, 1);
  assert.doesNotMatch(unreadableResult.stderr, new RegExp(unreadable));
});

test('strict arguments reject mode misuse and insecure URLs', () => {
  assert.equal(runChecker([]).status, 2);
  assert.equal(
    runChecker(['unknown', tag, sha, url, outputPath('x')]).status,
    2,
  );
  // finish 는 baseline 이 반드시 있어야 하고, start 는 받으면 안 된다.
  assert.equal(
    runChecker(['finish', tag, sha, url, outputPath('y')]).status,
    2,
  );
  assert.equal(
    runChecker(['start', tag, sha, url, outputPath('z'), outputPath('w')])
      .status,
    2,
  );
  assert.equal(
    runChecker(['postdeploy', tag, sha, 'http://public.test', outputPath('i')])
      .status,
    2,
  );
  assert.equal(
    runChecker(['postdeploy', tag, 'not-a-sha', url, outputPath('s')]).status,
    2,
  );
});

test('an existing output file is never overwritten', () => {
  const output = outputPath('existing');
  writeFileSync(output, 'prior evidence\n');
  const result = runChecker(['postdeploy', tag, sha, url, output]);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(output, 'utf8'), 'prior evidence\n');
});

function startBaseline() {
  return (elapsedSeconds) => {
    const path = outputPath('baseline');
    const startedAt = new Date(Date.now() - elapsedSeconds * 1000);
    writeFileSync(
      path,
      `${JSON.stringify({
        version: '20260822-member-authority-v2',
        mode: 'start',
        release: { tag, sha },
        images: {
          frontend: { imageId: 'sha256:frontend' },
          backend: { imageId: 'sha256:backend' },
        },
        observation: {
          startedAt: startedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        },
      })}\n`,
    );
    return path;
  };
}

function outputPath(name) {
  outputSequence += 1;
  return join(root, `${name}-${outputSequence}.json`);
}

function runChecker(
  args,
  {
    envPath = envFile,
    aggregateJson = JSON.stringify(aggregate()),
    healthStatus = '200',
    sessionStatus = '200',
    protectedStatus = '401',
    frontendImageId = 'sha256:frontend',
    backendImageId = 'sha256:backend',
  } = {},
) {
  return spawnSync(checkerPath, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      OSS_HUB_ENV_FILE: envPath,
      FIXTURE_TAG: tag,
      FIXTURE_SHA: sha,
      FRONTEND_IMAGE_ID: frontendImageId,
      BACKEND_IMAGE_ID: backendImageId,
      AGGREGATE_JSON: aggregateJson,
      HEALTH_STATUS: healthStatus,
      SESSION_STATUS: sessionStatus,
      PROTECTED_STATUS: protectedStatus,
    },
  });
}

function aggregate({ nullMemberKinds = 0, blankNames = 0 } = {}) {
  return {
    version: '20260823-auth-production-readonly-v1',
    aggregate: {
      totalUsers: 62,
      totalProfiles: 62,
      memberKinds: { STUDENT: 54, STAFF: 8, NULL: nullMemberKinds },
      usersWithStaffAccess: 8,
      usersWithAdminAccess: 5,
      staffAccessRequests: { PENDING: 0, APPROVED: 8, REJECTED: 1, REVOKED: 0 },
      blankNames,
    },
  };
}

function writeExecutable(name, contents) {
  const path = join(bin, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}
