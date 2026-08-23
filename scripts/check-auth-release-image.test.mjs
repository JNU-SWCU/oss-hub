import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
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
  new URL('./check-auth-release-image.sh', import.meta.url),
);
const root = mkdtempSync(join(tmpdir(), 'auth-release-image-'));
const bin = join(root, 'bin');
const downLog = join(root, 'down.log');
const tag = 'v0.8.0';
const sha = 'a'.repeat(40);

const PRINCIPALS = [
  'STUDENT',
  'STAFF',
  'STUDENT_ADMIN',
  'STAFF_ADMIN',
  'REVOKED_STAFF',
  'DEACTIVATED',
  'UNASSIGNED',
];

let outputSequence = 0;

mkdirSync(bin);

// docker stub 은 후보 이미지 조회·일회용 스택 기동·매트릭스 실행·정리를 모두 흉내낸다.
// `down` 호출은 파일에 기록해 정리가 실제로 일어났는지 테스트가 확인한다.
writeExecutable(
  'docker',
  `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == compose ]]; then
  shift
  project=""
  while [[ "\${1:-}" == -p || "\${1:-}" == -f ]]; do
    if [[ "$1" == -p ]]; then project="$2"; fi
    shift 2
  done
  case "\${1:-}" in
    up)
      [[ "\$UP_EXIT" == 0 ]] || exit "\$UP_EXIT"
      # 일회용 프로젝트 이름은 운영 프로젝트와 겹치면 안 된다.
      [[ "$project" == oss-hub-auth-release-* ]] || exit 1
      exit 0
      ;;
    exec)
      [[ "\$MATRIX_EXIT" == 0 ]] || exit "\$MATRIX_EXIT"
      printf '%s\\n' "\$MATRIX_JSON"
      exit 0
      ;;
    down)
      printf '%s\\n' "$project" >>"\$DOWN_LOG"
      exit "\$DOWN_EXIT"
      ;;
    *) exit 1 ;;
  esac
fi
if [[ "$1" == image && "$2" == inspect ]]; then
  image="\${*: -1}"
  case "$image" in
    oss-hub-frontend:*) printf '%s|%s|%s\\n' "\$FE_VERSION" "\$FE_REVISION" "\$FE_IMAGE_ID" ;;
    oss-hub-backend:*) printf '%s|%s|%s\\n' "\$BE_VERSION" "\$BE_REVISION" "\$BE_IMAGE_ID" ;;
    *) exit 1 ;;
  esac
  exit 0
fi
exit 1
`,
);

after(() => rmSync(root, { recursive: true, force: true }));

test('the exact candidate matrix passes and removes the disposable project', () => {
  const evidence = outputPath('evidence');
  const result = runChecker({ evidence });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(evidence, 'utf8'));
  assert.deepEqual(report.release, { tag, sha });
  assert.equal(report.images.frontend.imageId, 'sha256:frontend');
  assert.equal(report.images.backend.imageId, 'sha256:backend');
  assert.deepEqual(
    Object.keys(report.principals).sort(),
    [...PRINCIPALS].sort(),
  );
  // 일회용 프로젝트는 성공 경로에서도 반드시 정리된다.
  assert.match(readFileSync(downLog, 'utf8'), /oss-hub-auth-release-/);
});

test('digest or label mismatch fails before the stack starts', () => {
  const wrongVersion = runChecker({ feVersion: 'v0.7.9' });
  assert.equal(wrongVersion.status, 1);
  assert.match(wrongVersion.stderr, /frontend candidate digest mismatch/);

  const wrongRevision = runChecker({ beRevision: 'b'.repeat(40) });
  assert.equal(wrongRevision.status, 1);
  assert.match(wrongRevision.stderr, /backend candidate digest mismatch/);
});

test('an incomplete or failing matrix fails closed', () => {
  const failed = runChecker({ matrixExit: '1' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /synthetic authority matrix failed/);

  // 주체가 하나라도 빠지면 "무엇을 증명했는지 모르는" 초록을 만들지 않는다.
  const partial = matrix();
  delete partial.principals.STAFF_ADMIN;
  const missingPrincipal = runChecker({ matrixJson: JSON.stringify(partial) });
  assert.equal(missingPrincipal.status, 1);

  // 거부가 하나도 없으면 매트릭스가 권한 경계를 확인하지 않은 것이다.
  const noDenial = matrix();
  noDenial.principals.STUDENT.denied = [];
  assert.equal(runChecker({ matrixJson: JSON.stringify(noDenial) }).status, 1);

  // 거부돼야 할 경로가 통과하면 실패한다.
  const leaked = matrix();
  leaked.principals.STUDENT.denied = [200];
  assert.equal(runChecker({ matrixJson: JSON.stringify(leaked) }).status, 1);

  // 허용돼야 할 경로가 막히면 실패한다.
  const blocked = matrix();
  blocked.principals.STAFF.allowed = [403];
  assert.equal(runChecker({ matrixJson: JSON.stringify(blocked) }).status, 1);

  const mismatchedRelease = matrix();
  mismatchedRelease.release.sha = 'c'.repeat(40);
  assert.equal(
    runChecker({ matrixJson: JSON.stringify(mismatchedRelease) }).status,
    1,
  );

  assert.equal(runChecker({ matrixJson: '{' }).status, 1);
});

test('a stack that never becomes healthy fails and still cleans up', () => {
  writeFileSync(downLog, '');
  const result = runChecker({ upExit: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /disposable stack failed to become healthy/);
  assert.match(readFileSync(downLog, 'utf8'), /oss-hub-auth-release-/);
});

test('cleanup failure is a gate failure, never a pass', () => {
  const evidence = outputPath('cleanup');
  const result = runChecker({ downExit: '1', evidence });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /disposable project cleanup failed/);
});

test('strict arguments reject malformed tag and sha', () => {
  assert.equal(spawnSync(checkerPath, [], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(checkerPath, [tag], { encoding: 'utf8' }).status, 2);
  assert.equal(
    spawnSync(checkerPath, ['0.8.0', sha], { encoding: 'utf8' }).status,
    2,
  );
  assert.equal(
    spawnSync(checkerPath, [tag, 'not-a-sha'], { encoding: 'utf8' }).status,
    2,
  );
  assert.equal(
    spawnSync(checkerPath, [tag, sha, 'extra'], { encoding: 'utf8' }).status,
    2,
  );
});

test('existing evidence is rejected before the stack is started', () => {
  const evidence = outputPath('existing');
  writeFileSync(evidence, 'prior evidence\n');
  writeFileSync(downLog, '');
  const result = runChecker({ evidence });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence already exists/);
  assert.equal(readFileSync(evidence, 'utf8'), 'prior evidence\n');
  // 인자 오류는 일회용 스택을 아예 띄우지 않는다.
  assert.equal(readFileSync(downLog, 'utf8'), '');
});

function outputPath(name) {
  outputSequence += 1;
  const path = join(root, `${name}-${outputSequence}.json`);
  if (existsSync(path)) rmSync(path);
  return path;
}

function runChecker({
  evidence = '-',
  matrixJson = JSON.stringify(matrix()),
  matrixExit = '0',
  upExit = '0',
  downExit = '0',
  feVersion = tag,
  beVersion = tag,
  feRevision = sha,
  beRevision = sha,
} = {}) {
  return spawnSync(checkerPath, [tag, sha], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      AUTH_RELEASE_IMAGE_EVIDENCE: evidence,
      AUTH_RELEASE_IMAGE_RUN_ID: `test-${(outputSequence += 1)}`,
      MATRIX_JSON: matrixJson,
      MATRIX_EXIT: matrixExit,
      UP_EXIT: upExit,
      DOWN_EXIT: downExit,
      DOWN_LOG: downLog,
      FE_VERSION: feVersion,
      BE_VERSION: beVersion,
      FE_REVISION: feRevision,
      BE_REVISION: beRevision,
      FE_IMAGE_ID: 'sha256:frontend',
      BE_IMAGE_ID: 'sha256:backend',
    },
  });
}

function matrix() {
  const principals = {};
  for (const principal of PRINCIPALS) {
    principals[principal] = { allowed: [200], denied: [403] };
  }
  // 익명 보호 경로와 비활성 계정은 인증 자체가 거부된다.
  principals.DEACTIVATED = { allowed: [], denied: [401, 403] };
  principals.UNASSIGNED = { allowed: [200], denied: [403, 403] };
  return { release: { tag, sha }, principals };
}

function writeExecutable(name, contents) {
  const path = join(bin, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}
