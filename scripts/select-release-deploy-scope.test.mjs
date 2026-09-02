import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKEND_RELEASE_PATHS,
  FRONTEND_RELEASE_PATHS,
  selectReleaseDeployScope,
} from './select-release-deploy-scope-lib.mjs';

test('frontend 소스만 바뀐 릴리스는 frontend 만 배포한다', () => {
  const scope = selectReleaseDeployScope([
    'apps/frontend/src/app/page.tsx',
    'apps/frontend/vercel.json',
  ]);

  assert.deepEqual(scope, { frontend: true, backend: false });
});

test('backend 소스만 바뀐 릴리스는 backend 만 배포한다', () => {
  const scope = selectReleaseDeployScope([
    'apps/backend/src/programs/programs.service.ts',
    'apps/backend/prisma/schema.prisma',
  ]);

  assert.deepEqual(scope, { frontend: false, backend: true });
});

test('배포 산출물을 바꾸지 않는 릴리스는 어느 쪽도 배포하지 않는다', () => {
  const scope = selectReleaseDeployScope([
    'docs/decisions/ADR-002-CI-CD-파이프라인.md',
    'docs/handoff/team-state/GoBeromsu.md',
    '.github/pull_request_template.md',
    'skills/run-release-qa/SKILL.md',
  ]);

  assert.deepEqual(scope, { frontend: false, backend: false });
});

test('workspace manifest 변경은 두 앱의 설치 결과를 모두 바꾸므로 둘 다 배포한다', () => {
  for (const manifest of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ]) {
    assert.deepEqual(
      selectReleaseDeployScope([manifest]),
      { frontend: true, backend: true },
      `${manifest} 는 양쪽 스코프를 골라야 한다`,
    );
  }
});

test('Compose·API ingress·배포 절차 변경은 backend 를 다시 배포한다', () => {
  for (const path of [
    'compose.yml',
    'deploy/nginx/nginx.conf',
    'Jenkinsfile',
  ]) {
    assert.deepEqual(
      selectReleaseDeployScope([path]),
      { frontend: false, backend: true },
      `${path} 는 backend 스코프를 골라야 한다`,
    );
  }
});

test('local substitute 와 host nginx 는 운영 산출물이 아니므로 배포를 부르지 않는다', () => {
  const scope = selectReleaseDeployScope([
    'compose.local.yml',
    'deploy/nginx-local/nginx.conf',
    'deploy/host-nginx/oss-hub.conf',
  ]);

  assert.deepEqual(scope, { frontend: false, backend: false });
});

test('경로 접두사는 디렉터리 경계에서만 일치한다', () => {
  const scope = selectReleaseDeployScope([
    'apps/frontend-legacy/src/page.tsx',
    'apps/backend-notes.md',
  ]);

  assert.deepEqual(scope, { frontend: false, backend: false });
});

test('빈 diff 와 공백 줄은 배포를 부르지 않는다', () => {
  assert.deepEqual(selectReleaseDeployScope([]), {
    frontend: false,
    backend: false,
  });
  assert.deepEqual(selectReleaseDeployScope(['', '   ', '\t']), {
    frontend: false,
    backend: false,
  });
});

test('스코프 경로가 사라지면 판정이 무너지는 것을 고정한다', () => {
  // 경로 목록이 조용히 비면 모든 릴리스가 no-op 이 되어 배포가 영원히 멈춘다.
  assert.ok(FRONTEND_RELEASE_PATHS.includes('apps/frontend/'));
  assert.ok(BACKEND_RELEASE_PATHS.includes('apps/backend/'));

  for (const manifest of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ]) {
    assert.ok(FRONTEND_RELEASE_PATHS.includes(manifest));
    assert.ok(BACKEND_RELEASE_PATHS.includes(manifest));
  }
});
