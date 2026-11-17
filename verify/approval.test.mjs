import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { codeOwnersFor, createCiApproval } from './approval.mjs';
import { REPO_ROOT } from './tools.mjs';

const HEAD = 'c'.repeat(40);

function workspace(t, codeowners, event) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-approval-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.github'));
  writeFileSync(join(dir, '.github/CODEOWNERS'), codeowners);
  writeFileSync(join(dir, 'event.json'), JSON.stringify(event));
  return dir;
}

function github(routes) {
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push({ url, auth: init.headers.authorization });
    const path = new URL(url).pathname;
    if (!(path in routes)) return new Response('missing', { status: 404 });
    return Response.json(routes[path]);
  };
  return { fetchImpl, requested };
}

const review = (login, state) => ({ user: { login }, state });
const env = (dir, eventName) => ({
  GITHUB_TOKEN: 'token-for-test',
  GITHUB_REPOSITORY: 'org/repo',
  GITHUB_EVENT_NAME: eventName,
  GITHUB_EVENT_PATH: join(dir, 'event.json'),
});

test('the committed CODEOWNERS assigns the API baseline to an individual owner', () => {
  const text = readFileSync(join(REPO_ROOT, '.github/CODEOWNERS'), 'utf8');
  const owners = codeOwnersFor(text, 'verify/openapi.baseline.json');
  assert.ok(owners.length > 0);
  assert.ok(owners.every((owner) => /^@[\w-]+$/.test(owner)));
});

test('the last matching CODEOWNERS rule wins', () => {
  const text =
    '* @everyone\n/verify/ @alice\n/verify/*.json @bob @org/team\n/docs/ @carol\n';
  assert.deepEqual(codeOwnersFor(text, 'verify/openapi.baseline.json'), [
    '@bob',
    '@org/team',
  ]);
  assert.deepEqual(codeOwnersFor(text, 'verify/api.mjs'), ['@alice']);
  assert.deepEqual(codeOwnersFor(text, 'apps/x.ts'), ['@everyone']);
});

test('pull_request: only the latest non-comment review of a code owner counts', async (t) => {
  const dir = workspace(t, '/verify/ @Owner\n', {
    pull_request: { number: 7 },
  });
  const check = (reviews) => {
    const { fetchImpl } = github({
      '/repos/org/repo/pulls/7/reviews': reviews,
    });
    return createCiApproval({
      env: env(dir, 'pull_request'),
      cwd: dir,
      fetchImpl,
    })({ head: HEAD });
  };
  assert.equal((await check([review('owner', 'APPROVED')])).ok, true);
  assert.equal(
    (await check([review('owner', 'APPROVED'), review('owner', 'COMMENTED')]))
      .ok,
    true,
  );
  assert.equal(
    (
      await check([
        review('owner', 'APPROVED'),
        review('owner', 'CHANGES_REQUESTED'),
      ])
    ).ok,
    false,
  );
  assert.equal((await check([review('someone-else', 'APPROVED')])).ok, false);
});

test('push: the merged pull request of the pushed commit must carry the owner approval', async (t) => {
  const dir = workspace(t, '/verify/ @owner\n', {
    before: 'b'.repeat(40),
    after: HEAD,
  });
  const approved = github({
    [`/repos/org/repo/commits/${HEAD}/pulls`]: [
      { number: 3, merged_at: null },
      { number: 9, merged_at: '2026-11-17T00:00:00Z' },
    ],
    '/repos/org/repo/pulls/9/reviews': [review('owner', 'APPROVED')],
    '/repos/org/repo/pulls/3/reviews': [],
  });
  const result = await createCiApproval({
    env: env(dir, 'push'),
    cwd: dir,
    fetchImpl: approved.fetchImpl,
  })({ head: HEAD });
  assert.deepEqual(result, { ok: true, detail: '#9 approved by @owner' });
  assert.ok(
    approved.requested.every(({ auth }) => auth === 'Bearer token-for-test'),
  );
  assert.ok(!approved.requested.some(({ url }) => url.includes('/pulls/3/')));

  const unmerged = github({ [`/repos/org/repo/commits/${HEAD}/pulls`]: [] });
  const missing = await createCiApproval({
    env: env(dir, 'push'),
    cwd: dir,
    fetchImpl: unmerged.fetchImpl,
  })({ head: HEAD });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /no merged pull request/);
});

test('approval fails closed without a token, with team-only owners, or on API errors', async (t) => {
  const dir = workspace(t, '/verify/ @owner\n', {
    pull_request: { number: 7 },
  });
  const noToken = await createCiApproval({
    env: { ...env(dir, 'pull_request'), GITHUB_TOKEN: '' },
    cwd: dir,
    fetchImpl: github({}).fetchImpl,
  })({ head: HEAD });
  assert.equal(noToken.ok, false);

  const teamDir = workspace(t, '/verify/ @org/reviewers\n', {
    pull_request: { number: 7 },
  });
  const team = await createCiApproval({
    env: env(teamDir, 'pull_request'),
    cwd: teamDir,
    fetchImpl: github({}).fetchImpl,
  })({ head: HEAD });
  assert.equal(team.ok, false);
  assert.match(team.detail, /no individual CODEOWNERS/);

  await assert.rejects(
    createCiApproval({
      env: env(dir, 'pull_request'),
      cwd: dir,
      fetchImpl: github({}).fetchImpl,
    })({
      head: HEAD,
    }),
    /returned 404/,
  );
});
