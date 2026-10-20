import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  isLatestFullRelease,
  readSuccessfulFrontendDeployments,
  selectFrontendReleaseDeployScope,
} from './select-release-deploy-scope.mjs';

const oldSha = '1'.repeat(40);
const failedSha = '2'.repeat(40);
const targetSha = '3'.repeat(40);
const newerSha = '4'.repeat(40);
const repository = 'synthetic/project';
const run = (id, sha) => ({ id, event: 'release', head_sha: sha });
const deployment = (
  sha,
  conclusion = 'success',
  completedAt = '2026-01-01T00:00:00Z',
) => ({
  name: 'frontend-release-deploy',
  head_sha: sha,
  steps: [
    { name: 'Vercel production 배포', conclusion, completed_at: completedAt },
  ],
});
const record = (sha, completedAt = '2026-01-01T00:00:00Z') => ({
  sha,
  completedAt,
});

function apiFor(runs, jobs) {
  return (endpoint) => {
    if (endpoint.includes('/workflows/')) return [{ workflow_runs: runs }];
    assert.match(endpoint, /filter=all/);
    const id = Number(endpoint.match(/\/runs\/(\d+)\/jobs/)[1]);
    return [{ jobs: jobs[id] }];
  };
}

const history = (deployments, complete = true) => ({ deployments, complete });
function linearGit(changedPaths) {
  const order = [oldSha, failedSha, targetSha, newerSha];
  return {
    isAncestor: (ancestor, descendant) =>
      order.indexOf(ancestor) <= order.indexOf(descendant),
    changedPaths: (from, to) => {
      assert.equal(from, oldSha);
      assert.equal(to, targetSha);
      return changedPaths;
    },
  };
}

test('failed deploy and successful no-op are not successful frontend deployment receipts', async () => {
  const result = await readSuccessfulFrontendDeployments(
    repository,
    apiFor([run(3, targetSha), run(2, failedSha), run(1, oldSha)], {
      3: [deployment(targetSha, 'skipped')],
      2: [deployment(failedSha, 'failure')],
      1: [deployment(oldSha)],
    }),
  );
  assert.deepEqual(result, history([record(oldSha)]));
});

test('all attempts and pages preserve earlier successful deployment even after a failed retry', async () => {
  const calls = [];
  const result = await readSuccessfulFrontendDeployments(
    repository,
    (endpoint) => {
      calls.push(endpoint);
      if (endpoint.includes('/workflows/'))
        return [{ workflow_runs: [] }, { workflow_runs: [run(1, oldSha)] }];
      return [
        { jobs: [deployment(oldSha, 'failure')] },
        { jobs: [deployment(oldSha)] },
      ];
    },
  );
  assert.deepEqual(result, history([record(oldSha)]));
  assert.match(calls[1], /filter=all/);
});

test('successful deployment step is retained even if a later job step fails', async () => {
  const job = { ...deployment(oldSha), conclusion: 'failure' };
  const result = await readSuccessfulFrontendDeployments(
    repository,
    apiFor([run(1, oldSha)], { 1: [job] }),
  );
  assert.deepEqual(result, history([record(oldSha)]));
});

test('a different job or push run cannot establish the frontend deployment baseline', async () => {
  const result = await readSuccessfulFrontendDeployments(
    repository,
    apiFor([{ ...run(2, newerSha), event: 'push' }, run(1, oldSha)], {
      1: [{ ...deployment(oldSha), name: 'ci' }],
    }),
  );
  assert.deepEqual(result, history([]));
});

test('malformed successful receipt is uncertain rather than a no-op baseline', async () => {
  for (const job of [
    deployment(newerSha),
    deployment(oldSha, 'success', null),
  ]) {
    const result = await readSuccessfulFrontendDeployments(
      repository,
      apiFor([run(1, oldSha)], { 1: [job] }),
    );
    assert.deepEqual(result, history([], false));
  }
});

test('API failure preserves known receipts while marking history uncertain', async () => {
  const result = await readSuccessfulFrontendDeployments(
    repository,
    (endpoint) => {
      if (endpoint.includes('/workflows/'))
        return [{ workflow_runs: [run(1, newerSha), run(2, oldSha)] }];
      if (endpoint.includes('/runs/1/'))
        return [{ jobs: [deployment(newerSha)] }];
      throw new Error('synthetic unavailable');
    },
  );
  assert.deepEqual(result, history([record(newerSha)], false));
});

test('a failed frontend release is recovered by the next backend-only release', () => {
  const result = selectFrontendReleaseDeployScope(
    targetSha,
    history([record(oldSha)]),
    linearGit([
      'apps/frontend/src/synthetic.ts',
      'apps/backend/src/synthetic.ts',
    ]),
  );
  assert.equal(result.frontend, true);
  assert.equal(result.baselineSha, oldSha);
});

test('successful deployment followed only by backend changes remains a no-op', () => {
  const result = selectFrontendReleaseDeployScope(
    targetSha,
    history([record(oldSha)]),
    linearGit(['apps/backend/src/synthetic.ts']),
  );
  assert.equal(result.frontend, false);
  assert.equal(result.reason, 'frontend-unchanged');
});

test('missing or unavailable deployment history never silently skips deployment', () => {
  for (const input of [
    history([]),
    history([], false),
    history([record(oldSha)], false),
  ]) {
    assert.equal(
      selectFrontendReleaseDeployScope(targetSha, input, linearGit([]), true)
        .frontend,
      true,
    );
  }
});

test('an older retry cannot overwrite a newer deployment from complete history', () => {
  const result = selectFrontendReleaseDeployScope(
    targetSha,
    history([record(newerSha)]),
    linearGit([]),
  );
  assert.equal(result.frontend, false);
  assert.equal(result.reason, 'newer-deployment');
});

test('incomplete history uses latest-release proof even when a newer receipt remains', () => {
  const input = history([record(newerSha)], false);
  assert.equal(
    selectFrontendReleaseDeployScope(targetSha, input, linearGit([]), true)
      .frontend,
    true,
  );
  for (const latest of [false, null]) {
    assert.throws(
      () =>
        selectFrontendReleaseDeployScope(
          targetSha,
          input,
          linearGit([]),
          latest,
        ),
      /최신 정식 릴리스/,
    );
  }
});

test('a duplicate successful release is a no-op', () => {
  const result = selectFrontendReleaseDeployScope(
    targetSha,
    history([record(targetSha)]),
    linearGit([]),
  );
  assert.equal(result.frontend, false);
  assert.equal(result.reason, 'already-deployed');
});

test('latest completed deployment is the diff baseline rather than release creation order', () => {
  const result = selectFrontendReleaseDeployScope(
    targetSha,
    history([
      record(failedSha, '2026-01-01T00:00:00Z'),
      record(oldSha, '2026-01-02T00:00:00Z'),
    ]),
    linearGit(['apps/frontend/src/synthetic.ts']),
  );
  assert.equal(result.baselineSha, oldSha);
});

test('missing git objects or diff failure require deployment instead of no-op', () => {
  for (const git of [
    {
      isAncestor: () => {
        throw new Error('missing object');
      },
    },
    {
      ...linearGit([]),
      changedPaths: () => {
        throw new Error('diff failed');
      },
    },
  ]) {
    assert.equal(
      selectFrontendReleaseDeployScope(
        targetSha,
        history([record(oldSha)]),
        git,
        true,
      ).frontend,
      true,
    );
  }
});

test('CLI uses real git ancestry and recovers missed frontend changes with synthetic Actions responses', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontend-release-recovery-'));
  const script = new URL('./select-release-deploy-scope.mjs', import.meta.url);
  const git = (...args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Synthetic');
    git('config', 'user.email', 'synthetic@example.test');
    mkdirSync(join(directory, 'apps/frontend'), { recursive: true });
    mkdirSync(join(directory, 'apps/backend'), { recursive: true });
    writeFileSync(join(directory, 'apps/frontend/example.txt'), 'old');
    git('add', '.');
    git('commit', '-qm', 'initial');
    const baseline = git('rev-parse', 'HEAD');
    writeFileSync(join(directory, 'apps/frontend/example.txt'), 'new');
    git('add', '.');
    git('commit', '-qm', 'frontend update whose deployment fails');
    writeFileSync(join(directory, 'apps/backend/example.txt'), 'backend');
    git('add', '.');
    git('commit', '-qm', 'backend only release');
    const target = git('rev-parse', 'HEAD');
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      '#!/usr/bin/env node\nconst endpoint = process.argv.at(-1);\nif (endpoint.endsWith("/releases/latest")) process.stdout.write(process.env.SYNTHETIC_LATEST);\nelse if (process.env.SYNTHETIC_API_FAILURE === "1") process.exit(1);\nelse process.stdout.write(endpoint.includes("/workflows/") ? process.env.SYNTHETIC_RUNS : process.env.SYNTHETIC_JOBS);\n',
      { mode: 0o755 },
    );
    const invoke = (overrides = {}) =>
      execFileSync(process.execPath, [script.pathname], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_REPOSITORY: repository,
          RELEASE_SHA: target,
          RELEASE_TAG: 'v1.0.2',
          SYNTHETIC_RUNS: JSON.stringify([
            { workflow_runs: [run(1, baseline)] },
          ]),
          SYNTHETIC_JOBS: JSON.stringify([{ jobs: [deployment(baseline)] }]),
          SYNTHETIC_LATEST: JSON.stringify([
            { draft: false, prerelease: false, tag_name: 'v1.0.2' },
          ]),
          ...overrides,
        },
      });
    assert.match(invoke(), /^frontend=true$/m);
    assert.match(
      invoke({
        RELEASE_SHA: baseline,
        RELEASE_TAG: 'v1.0.0',
        SYNTHETIC_RUNS: JSON.stringify([{ workflow_runs: [run(1, target)] }]),
        SYNTHETIC_JOBS: JSON.stringify([{ jobs: [deployment(target)] }]),
      }),
      /^frontend=false$/m,
    );
    assert.match(invoke({ SYNTHETIC_API_FAILURE: '1' }), /^frontend=true$/m);
    assert.throws(
      () =>
        invoke({
          RELEASE_SHA: baseline,
          RELEASE_TAG: 'v1.0.0',
          SYNTHETIC_API_FAILURE: '1',
        }),
      /최신 정식 릴리스/,
    );
    assert.throws(
      () =>
        invoke({
          SYNTHETIC_API_FAILURE: '1',
          SYNTHETIC_LATEST: 'invalid-json',
        }),
      /최신 정식 릴리스/,
    );
    git('mv', 'apps/frontend/example.txt', 'apps/backend/moved.txt');
    git('commit', '-qm', 'move file out of frontend');
    const moved = git('rev-parse', 'HEAD');
    assert.match(
      invoke({
        RELEASE_SHA: moved,
        SYNTHETIC_RUNS: JSON.stringify([{ workflow_runs: [run(1, target)] }]),
        SYNTHETIC_JOBS: JSON.stringify([{ jobs: [deployment(target)] }]),
      }),
      /^frontend=true$/m,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uncertain history cannot deploy an older release or an unverified latest release', () => {
  for (const latest of [false, null]) {
    for (const input of [
      history([]),
      history([], false),
      history([record(oldSha)], false),
    ]) {
      assert.throws(
        () =>
          selectFrontendReleaseDeployScope(
            targetSha,
            input,
            linearGit([]),
            latest,
          ),
        /최신 정식 릴리스/,
      );
    }
  }
});

test('latest release proof requires an exact full published release tag', async () => {
  const release = { draft: false, prerelease: false, tag_name: 'v1.0.2' };
  assert.equal(
    await isLatestFullRelease(repository, 'v1.0.2', () => [release]),
    true,
  );
  assert.equal(
    await isLatestFullRelease(repository, 'v1.0.1', () => [release]),
    false,
  );
  for (const value of [
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: 'v1.0' },
    {},
    null,
  ]) {
    assert.equal(
      await isLatestFullRelease(repository, 'v1.0.2', () => [value]),
      null,
    );
  }
  assert.equal(
    await isLatestFullRelease(repository, 'v1.0.2', () => {
      throw new Error('offline');
    }),
    null,
  );
});

test('actual release job uses successful-deployment scope and serializes production', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const job = workflow.slice(workflow.indexOf('  frontend-release-deploy:'));
  assert.match(
    job,
    /concurrency:\s+group: frontend-production\s+cancel-in-progress: false/,
  );
  assert.match(job, /queue: max/);
  assert.match(job, /actions: read/);
  assert.match(job, /RELEASE_TAG: \$\{\{ github.event.release.tag_name \}\}/);
  assert.match(job, /RELEASE_SHA: \$\{\{ steps.release.outputs.sha \}\}/);
  assert.match(
    job,
    /node scripts\/select-release-deploy-scope.mjs >> "\$GITHUB_OUTPUT"/,
  );
  assert.doesNotMatch(job, /gh release list|grep -vFx/);
  const testStep = workflow
    .split('      - name: 릴리스 배포 스코프 판정 단위테스트')[1]
    .split('      - name:')[0];
  assert.match(testStep, /scripts\/select-frontend-release-baseline.test.mjs/);
  assert.doesNotMatch(testStep, /if:/);
});

for (const historicalSha of [targetSha, newerSha]) {
  test(`latest rollback receipt allows recovery despite historical success ${historicalSha[0]}`, () => {
    const result = selectFrontendReleaseDeployScope(
      targetSha,
      history([
        record(oldSha, '2026-01-01T00:00:00Z'),
        record(historicalSha, '2026-01-02T00:00:00Z'),
        record(oldSha, '2026-01-03T00:00:00Z'),
      ]),
      linearGit(['apps/frontend/src/synthetic.ts']),
      true,
    );
    assert.equal(result.frontend, true);
    assert.equal(result.baselineSha, oldSha);
    assert.equal(result.reason, 'frontend-changed');
  });
}

test('incomplete history cannot treat an old same-SHA receipt as current deployment', () => {
  const input = history([record(targetSha)], false);
  const result = selectFrontendReleaseDeployScope(
    targetSha,
    input,
    linearGit([]),
    true,
  );
  assert.equal(result.frontend, true);
  assert.equal(result.reason, 'deployment-history-unavailable');
  for (const latest of [false, null]) {
    assert.throws(
      () =>
        selectFrontendReleaseDeployScope(
          targetSha,
          input,
          linearGit([]),
          latest,
        ),
      /최신 정식 릴리스/,
    );
  }
});
