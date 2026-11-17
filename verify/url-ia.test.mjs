import assert from 'node:assert/strict';
import test from 'node:test';
import { tempRepo } from './test-support.mjs';
import { VerifyError } from './tools.mjs';
import { checkUrlIa } from './url-ia.mjs';

const APP = 'apps/frontend/src/app';
const FEATURES = 'apps/frontend/src/features';
const ALLOWLIST = 'verify/url-ia-allowlist.json';

const screen = (name) => `export function ${name}() {\n  return <div />;\n}\n`;
const page = (name, module) =>
  `import { ${name} } from '@/features/${module}';\n\nexport default function Page() {\n  return <${name} />;\n}\n`;
const menu = (hrefs) =>
  `export const MENU = [\n${hrefs.map((href) => `  { label: 'x', href: '${href}' },`).join('\n')}\n];\n\nconst ICONS = {\n  '/hidden': 'home',\n};\n\nexport const iconFor = (href: string) => ICONS[href];\n`;
const allowlist = (entries) => `${JSON.stringify({ entries }, null, 2)}\n`;

function fixture(t) {
  const repo = tempRepo(t);
  const base = repo.commit('base', {
    [`${APP}/layout.tsx`]:
      'import { MENU } from \'./_shell/menu\';\n\nexport default function Layout() {\n  return <a href="/">{MENU.length}</a>;\n}\n',
    [`${APP}/_shell/menu.ts`]: menu(['/reports']),
    [`${APP}/page.tsx`]: page('LandingScreen', 'landing/landing-screen'),
    [`${APP}/reports/page.tsx`]: page(
      'ReportsScreen',
      'reports/reports-screen',
    ),
    [`${APP}/legacy/page.tsx`]: page('LegacyScreen', 'legacy/legacy-screen'),
    [`${FEATURES}/landing/landing-screen.tsx`]: screen('LandingScreen'),
    [`${FEATURES}/reports/reports-screen.tsx`]: screen('ReportsScreen'),
    [`${FEATURES}/legacy/legacy-screen.tsx`]: screen('LegacyScreen'),
    [`${FEATURES}/stats/stats-screen.tsx`]: screen('StatsScreen'),
    [ALLOWLIST]: allowlist([]),
  });
  return { repo, base };
}

async function verifyHead(repo, base, head) {
  return checkUrlIa({
    cwd: repo.dir,
    ranges: [{ base, head, ref: 'main' }],
    log: () => {},
  });
}

test('existing violations are reported but do not block', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('docs', { 'docs/x.md': 'x\n' });
  const logs = [];
  const findings = await checkUrlIa({
    cwd: repo.dir,
    ranges: [{ base, head, ref: 'main' }],
    log: (line) => logs.push(line),
  });
  assert.deepEqual(findings, []);
  assert.ok(
    logs.some((line) => /existing \[unreachable-page\].*\/legacy/.test(line)),
  );
});

test('a new page reachable only through an icon-map key is a new unreachable page', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('add hidden page', {
    [`${APP}/hidden/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
  });
  const findings = await verifyHead(repo, base, head);
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['url-ia-unreachable-page'],
  );
  assert.match(findings[0].message, /\/hidden/);
  assert.equal(findings[0].measured, '0 inbound links');
});

test('a new page linked from the menu passes', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('add stats page', {
    [`${APP}/_shell/menu.ts`]: menu(['/reports', '/stats']),
    [`${APP}/stats/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
  });
  assert.deepEqual(await verifyHead(repo, base, head), []);
});

test('a new route rendering an existing screen is a duplicate even when linked', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('duplicate reports', {
    [`${APP}/_shell/menu.ts`]: menu(['/reports', '/reports/all']),
    [`${APP}/reports/all/page.tsx`]: page(
      'ReportsScreen',
      'reports/reports-screen',
    ),
  });
  const findings = await verifyHead(repo, base, head);
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['url-ia-duplicate-screen'],
  );
  assert.match(
    findings[0].message,
    /\/reports and \/reports\/all.*ReportsScreen/,
  );
});

test('an existing page whose last link is removed becomes a new violation', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('drop reports link', {
    [`${APP}/_shell/menu.ts`]: menu([]),
  });
  const findings = await verifyHead(repo, base, head);
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['url-ia-unreachable-page'],
  );
});

test('dynamic links built by path helpers, constant prefixes and intercepting modals count as reachable', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('dynamic routes', {
    [`${FEATURES}/reports/report-paths.ts`]: [
      "export function reportHref(id: string, suffix = ''): string {",
      '  return `/reports/${encodeURIComponent(id)}${suffix}`;',
      '}',
      "const DETAIL_BASES = { team: '/teams' } as const;",
      'export const teamHref = (id: string) => `${DETAIL_BASES.team}/${id}`;',
      "export const links = (id: string) => [reportHref(id), reportHref(id, '/files'), teamHref(id)];",
      '',
    ].join('\n'),
    [`${APP}/reports/[id]/page.tsx`]: page(
      'ReportsScreen',
      'reports/reports-screen',
    ).replace(/ReportsScreen/g, 'ReportDetail'),
    [`${APP}/reports/@modal/(.)[id]/page.tsx`]: page(
      'ReportOverlay',
      'reports/report-overlay',
    ),
    [`${APP}/reports/[id]/files/page.tsx`]: page(
      'ReportFiles',
      'reports/report-files',
    ),
    [`${APP}/(group)/teams/[teamId]/page.tsx`]: page(
      'TeamDetail',
      'teams/team-detail',
    ),
  });
  assert.deepEqual(await verifyHead(repo, base, head), []);
});

test('an allowlist entry with a reason accepts a new violation; stale or reasonless entries fail', async (t) => {
  const { repo, base } = fixture(t);
  const hidden = {
    [`${APP}/hidden/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
  };
  const allowed = repo.commit('allowlisted hidden page', {
    ...hidden,
    [ALLOWLIST]: allowlist([
      {
        rule: 'unreachable-page',
        url: '/hidden',
        reason: 'email deep link only',
      },
    ]),
  });
  assert.deepEqual(await verifyHead(repo, base, allowed), []);

  const stale = repo.commit('stale entry', {
    [`${APP}/hidden/page.tsx`]: null,
  });
  const findings = await verifyHead(repo, base, stale);
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['url-ia-allowlist-stale'],
  );

  const reasonless = repo.commit('reasonless entry', {
    ...hidden,
    [ALLOWLIST]: allowlist([
      { rule: 'unreachable-page', url: '/hidden', reason: ' ' },
    ]),
  });
  await assert.rejects(
    verifyHead(repo, base, reasonless),
    (error) =>
      error instanceof VerifyError &&
      /"reason" is required/.test(error.message),
  );
  const unknownRule = repo.commit('unknown rule', {
    [ALLOWLIST]: allowlist([{ rule: 'whatever', url: '/hidden', reason: 'x' }]),
  });
  await assert.rejects(verifyHead(repo, base, unknownRule), /unknown rule/);
  const garbage = repo.commit('garbage allowlist', {
    [ALLOWLIST]: '{not json',
  });
  await assert.rejects(verifyHead(repo, base, garbage), /not valid JSON/);
});

test('a tree without pages fails instead of passing', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('remove app', {
    [`${APP}/page.tsx`]: null,
    [`${APP}/reports/page.tsx`]: null,
    [`${APP}/legacy/page.tsx`]: null,
  });
  await assert.rejects(verifyHead(repo, base, head), /no page files/);
});
