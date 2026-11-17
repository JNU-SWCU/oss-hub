import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { codeOwnersFor, createCiApproval } from './approval.mjs';
import { eventFile, tempRepo } from './test-support.mjs';
import { REPO_ROOT } from './tools.mjs';

const HEAD = 'c'.repeat(40);

function workspace(t, codeowners, event) {
  const repo = tempRepo(t);
  const base = repo.commit('base', { '.github/CODEOWNERS': codeowners });
  return {
    dir: repo.dir,
    repo,
    range: { base, head: HEAD },
    eventPath: eventFile(t, event),
  };
}

function github(routes) {
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push({ url, auth: init.headers.authorization });
    const { pathname, searchParams } = new URL(url);
    const route = routes[pathname];
    if (!route) return new Response('missing', { status: 404 });
    if (!route.pages) return Response.json(route);
    const page = Number(searchParams.get('page') ?? '1');
    const headers =
      page < route.pages.length
        ? {
            link: `<https://api.github.com${pathname}?per_page=100&page=${page + 1}>; rel="next"`,
          }
        : {};
    return Response.json(route.pages[page - 1], { headers });
  };
  return { fetchImpl, requested };
}

let clock = Date.parse('2026-11-01T00:00:00Z');
const review = (login, state) => ({
  user: { login },
  state,
  submitted_at: new Date((clock += 1000)).toISOString(),
});
const env = (ws, eventName) => ({
  GITHUB_TOKEN: 'token-for-test',
  GITHUB_REPOSITORY: 'org/repo',
  GITHUB_EVENT_NAME: eventName,
  GITHUB_EVENT_PATH: ws.eventPath,
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
  const ws = workspace(t, '/verify/ @Owner\n', {
    pull_request: { number: 7 },
  });
  const check = (reviews) => {
    const { fetchImpl } = github({
      '/repos/org/repo/pulls/7/reviews': reviews,
    });
    return createCiApproval({
      env: env(ws, 'pull_request'),
      cwd: ws.dir,
      fetchImpl,
    })(ws.range);
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
  const ws = workspace(t, '/verify/ @owner\n', {
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
    env: env(ws, 'push'),
    cwd: ws.dir,
    fetchImpl: approved.fetchImpl,
  })(ws.range);
  assert.deepEqual(result, { ok: true, detail: '#9 approved by @owner' });
  assert.ok(
    approved.requested.every(({ auth }) => auth === 'Bearer token-for-test'),
  );
  assert.ok(!approved.requested.some(({ url }) => url.includes('/pulls/3/')));

  const unmerged = github({ [`/repos/org/repo/commits/${HEAD}/pulls`]: [] });
  const missing = await createCiApproval({
    env: env(ws, 'push'),
    cwd: ws.dir,
    fetchImpl: unmerged.fetchImpl,
  })(ws.range);
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /no merged pull request/);
});

test('approval fails closed without a token, with team-only owners, or on API errors', async (t) => {
  const ws = workspace(t, '/verify/ @owner\n', {
    pull_request: { number: 7 },
  });
  const noToken = await createCiApproval({
    env: { ...env(ws, 'pull_request'), GITHUB_TOKEN: '' },
    cwd: ws.dir,
    fetchImpl: github({}).fetchImpl,
  })(ws.range);
  assert.equal(noToken.ok, false);

  const teamWs = workspace(t, '/verify/ @org/reviewers\n', {
    pull_request: { number: 7 },
  });
  const team = await createCiApproval({
    env: env(teamWs, 'pull_request'),
    cwd: teamWs.dir,
    fetchImpl: github({}).fetchImpl,
  })(teamWs.range);
  assert.equal(team.ok, false);
  assert.match(team.detail, /no individual CODEOWNERS/);

  await assert.rejects(
    createCiApproval({
      env: env(ws, 'pull_request'),
      cwd: ws.dir,
      fetchImpl: github({}).fetchImpl,
    })(ws.range),
    /returned 404/,
  );
});

test('CODEOWNERS comes from the trusted base, so a PR cannot swap in its own owner', async (t) => {
  const ws = workspace(t, '/verify/ @owner\n', {
    pull_request: { number: 7 },
  });
  const head = ws.repo.commit('swap owner', {
    '.github/CODEOWNERS': '/verify/ @intruder\n',
  });
  const { fetchImpl } = github({
    '/repos/org/repo/pulls/7/reviews': [review('intruder', 'APPROVED')],
  });
  const result = await createCiApproval({
    env: env(ws, 'pull_request'),
    cwd: ws.dir,
    fetchImpl,
  })({ base: ws.range.base, head });
  assert.equal(result.ok, false);
  assert.match(result.detail, /@owner/);

  const missing = await createCiApproval({
    env: env(ws, 'pull_request'),
    cwd: ws.dir,
    fetchImpl,
  })({ base: 'd'.repeat(40), head });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /trusted base/);
});

test('every reviews page is read, so a later CHANGES_REQUESTED past page 10 wins', async (t) => {
  const ws = workspace(t, '/verify/ @owner\n', {
    pull_request: { number: 7 },
  });
  const pages = [[review('owner', 'APPROVED')]];
  while (pages.length < 11) {
    pages.push(
      Array.from({ length: 100 }, (_, i) =>
        review(`bot-${pages.length}-${i}`, 'COMMENTED'),
      ),
    );
  }
  pages[0].push(
    ...Array.from({ length: 99 }, (_, i) => review(`bot-0-${i}`, 'COMMENTED')),
  );
  pages.push([review('owner', 'CHANGES_REQUESTED')]);
  const { fetchImpl, requested } = github({
    '/repos/org/repo/pulls/7/reviews': { pages },
  });
  const result = await createCiApproval({
    env: env(ws, 'pull_request'),
    cwd: ws.dir,
    fetchImpl,
  })(ws.range);
  assert.equal(result.ok, false);
  assert.equal(requested.length, 12);

  const reordered = github({
    '/repos/org/repo/pulls/7/reviews': [
      {
        ...review('owner', 'CHANGES_REQUESTED'),
        submitted_at: '2026-10-01T00:00:00Z',
      },
      review('owner', 'APPROVED'),
    ].reverse(),
  });
  const latest = await createCiApproval({
    env: env(ws, 'pull_request'),
    cwd: ws.dir,
    fetchImpl: reordered.fetchImpl,
  })(ws.range);
  assert.equal(latest.ok, true);

  const broken = github({
    '/repos/org/repo/pulls/7/reviews': { pages: [pages[0], pages[1]] },
  });
  const failing = async (url, init) =>
    url.includes('page=2')
      ? new Response('boom', { status: 502 })
      : broken.fetchImpl(url, init);
  await assert.rejects(
    createCiApproval({
      env: env(ws, 'pull_request'),
      cwd: ws.dir,
      fetchImpl: failing,
    })(ws.range),
    /returned 502/,
  );
});
