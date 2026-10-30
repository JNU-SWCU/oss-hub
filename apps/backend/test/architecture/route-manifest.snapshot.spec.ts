import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverAppModuleControllers } from '../../src/app-controller-discovery';
import { createAuthRouteManifest } from '../../src/auth/auth-route-manifest.fixture';
import { compareStringsByCodeUnit } from '../../src/platform/platform.policy';

interface RouteSnapshotEntry {
  readonly method: string;
  readonly path: string;
  readonly access: string;
}

function currentRoutes(): RouteSnapshotEntry[] {
  return createAuthRouteManifest(discoverAppModuleControllers())
    .map(({ method, path, access }) => ({ method, path, access }))
    .sort(
      (left, right) =>
        compareStringsByCodeUnit(left.path, right.path) ||
        compareStringsByCodeUnit(left.method, right.method),
    );
}

describe('HTTP route manifest snapshot', () => {
  it('keeps every handler method, path, and access level unchanged', () => {
    const committed = JSON.parse(
      readFileSync(join(__dirname, 'route-manifest.snapshot.json'), 'utf8'),
    ) as RouteSnapshotEntry[];

    expect(currentRoutes()).toEqual(committed);
  });
});
