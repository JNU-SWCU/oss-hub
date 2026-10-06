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

export function selectReleaseDeployScope(changedPaths) {
  const paths = changedPaths
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    frontend: selects(paths, FRONTEND_RELEASE_PATHS),
    backend: selects(paths, BACKEND_RELEASE_PATHS),
  };
}
