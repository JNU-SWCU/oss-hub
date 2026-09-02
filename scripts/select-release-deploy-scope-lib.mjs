// 릴리스 하나가 어느 배포 대상을 실제로 바꾸는지 판정한다.
//
// 배포 인가는 GitHub Release 발행이고(ADR-002), 그 릴리스가 무엇을 바꿨는지는
// 직전 full SemVer 릴리스 태그와의 diff 가 원본이다. 두 태그 모두 불변 참조이므로
// 판정은 저장소만으로 재현된다 — 배포 플랫폼 상태를 읽지 않는다.
//
// 경계는 「그 대상의 실행 산출물을 바꾸는 경로」다. 문서·CI 계약·다른 앱만 바뀐
// 릴리스는 해당 대상을 다시 배포하지 않는다.

// 두 앱이 같은 workspace lockfile 로 설치되므로 root manifest 변경은 양쪽 모두를 바꾼다.
const WORKSPACE_MANIFESTS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
];

export const FRONTEND_RELEASE_PATHS = [
  'apps/frontend/',
  ...WORKSPACE_MANIFESTS,
];

// production Compose 에는 frontend runtime 이 없다. backend 실행 산출물은
// backend 소스, 그 이미지 정의, Compose 와 API ingress, 그리고 배포 절차 자체다.
export const BACKEND_RELEASE_PATHS = [
  'apps/backend/',
  'compose.yml',
  'deploy/nginx/',
  'Jenkinsfile',
  ...WORKSPACE_MANIFESTS,
];

function matches(changedPath, scopePath) {
  return scopePath.endsWith('/')
    ? changedPath.startsWith(scopePath)
    : changedPath === scopePath;
}

function selects(changedPaths, scopePaths) {
  return changedPaths.some((changedPath) =>
    scopePaths.some((scopePath) => matches(changedPath, scopePath)),
  );
}

/**
 * @param {string[]} changedPaths 두 릴리스 태그 사이에 바뀐 저장소 상대 경로
 * @returns {{ frontend: boolean, backend: boolean }}
 */
export function selectReleaseDeployScope(changedPaths) {
  const paths = changedPaths
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    frontend: selects(paths, FRONTEND_RELEASE_PATHS),
    backend: selects(paths, BACKEND_RELEASE_PATHS),
  };
}
