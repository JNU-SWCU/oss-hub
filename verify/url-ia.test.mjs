import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { main } from './index.mjs';
import { tempRepo } from './test-support.mjs';
import { GITLEAKS, REPO_ROOT, VerifyError, requireTool } from './tools.mjs';
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
      'import { MENU } from \'./_shell/menu\';\n\nexport default function Layout() {\n  return (\n    <nav>\n      <a href="/">home</a>\n      {MENU.map((item) => (\n        <a key={item.href} href={item.href}>\n          {item.label}\n        </a>\n      ))}\n    </nav>\n  );\n}\n',
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

test('dynamic links built by path helpers, constant prefixes, forwarded href params and intercepting modals count as reachable', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('dynamic routes', {
    [`${FEATURES}/reports/report-paths.ts`]: [
      "export function reportHref(id: string, suffix = ''): string {",
      '  return `/reports/${encodeURIComponent(id)}${suffix}`;',
      '}',
      "const DETAIL_BASES = { team: '/teams' } as const;",
      'export const teamHref = (id: string) => `${DETAIL_BASES.team}/${id}`;',
      'export const entry = (label: string, href: string) => ({ label, href });',
      '',
    ].join('\n'),
    [`${FEATURES}/reports/report-links.tsx`]: [
      "import { entry, reportHref, teamHref } from './report-paths';",
      '',
      'export function ReportLinks({ id, router }) {',
      "  const archive = entry('archive', '/archive');",
      '  return (',
      '    <div>',
      '      <a href={reportHref(id)}>detail</a>',
      "      <button onClick={() => router.push(reportHref(id, '/files'))}>files</button>",
      '      <a href={teamHref(id)}>team</a>',
      '      <a href={archive.href}>{archive.label}</a>',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n'),
    [`${APP}/layout.tsx`]:
      'import { MENU } from \'./_shell/menu\';\nimport { ReportLinks } from \'@/features/reports/report-links\';\n\nexport default function Layout({ router }) {\n  return (\n    <nav>\n      <a href="/">home</a>\n      {MENU.map((item) => (\n        <a key={item.href} href={item.href}>\n          {item.label}\n        </a>\n      ))}\n      <ReportLinks id="r1" router={router} />\n    </nav>\n  );\n}\n',
    [`${APP}/reports/[id]/page.tsx`]: page(
      'ReportDetail',
      'reports/report-detail',
    ),
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
    [`${APP}/archive/page.tsx`]: page(
      'ArchiveScreen',
      'archive/archive-screen',
    ),
  });
  assert.deepEqual(await verifyHead(repo, base, head), []);
});

test('a route named only in a comment or an unused string is still unreachable', async (t) => {
  const { repo, base } = fixture(t);
  const orphan = {
    [`${APP}/orphan/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
  };
  for (const unrelated of [
    '// Reserved route: "/orphan"\nexport const value = 1;\n',
    '/* see /orphan */\nexport const value = 1;\n',
    'export const unused = "/orphan";\n',
    "export const label = `/orphan`;\nexport const title = '/orphan page';\n",
  ]) {
    const head = repo.commit('mention orphan', {
      ...orphan,
      'apps/frontend/src/unrelated.ts': unrelated,
    });
    const findings = await verifyHead(repo, base, head);
    assert.deepEqual(
      findings.map((item) => item.rule),
      ['url-ia-unreachable-page'],
      unrelated,
    );
  }
});

function orphanCase(t, extra) {
  const { repo, base } = fixture(t);
  const head = repo.commit('orphan with decoy', {
    [`${APP}/orphan/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
    ...extra,
  });
  return verifyHead(repo, base, head);
}

const renderFrom = (specifier, name) =>
  `import { ${name} } from '${specifier}';\n\nexport default function Layout() {\n  return <${name} />;\n}\n`;

test('navigation-looking text inside strings does not make a page reachable', async (t) => {
  for (const source of [
    'export const example = `<a href="/orphan">Example only</a>`;\n',
    'export const example = "navigate(\'/orphan\')";\n',
    'export const example = \'router.push("/orphan")\';\n',
    'export const example = { text: \'href: "/orphan"\' };\n',
  ]) {
    const findings = await orphanCase(t, {
      [`${FEATURES}/stats/example.ts`]: source,
    });
    assert.deepEqual(
      findings.map((item) => item.rule),
      ['url-ia-unreachable-page'],
      source,
    );
  }
});

test('links only in stories, tests, mocks, fixtures or e2e files do not count', async (t) => {
  const link =
    'export const Example = () => <a href="/orphan">only here</a>;\n';
  for (const path of [
    `${FEATURES}/stats/stats.stories.tsx`,
    `${FEATURES}/stats/stats.story.tsx`,
    `${FEATURES}/stats/stats.test.tsx`,
    `${FEATURES}/stats/stats.spec.tsx`,
    `${FEATURES}/stats/__tests__/stats.tsx`,
    `${FEATURES}/stats/__mocks__/stats.tsx`,
    `${FEATURES}/stats/fixtures/stats.tsx`,
    `${FEATURES}/stats/stats.fixture.tsx`,
    'apps/frontend/src/e2e/stats.tsx',
  ]) {
    const specifier = path
      .replace('apps/frontend/src/', '@/')
      .replace(/\.tsx$/, '');
    const findings = await orphanCase(t, {
      [path]: link,
      [`${APP}/layout.tsx`]: renderFrom(specifier, 'Example'),
    });
    assert.ok(
      findings.some(
        (item) =>
          item.rule === 'url-ia-unreachable-page' &&
          /\(\/orphan\)/.test(item.message),
      ),
      path,
    );
  }
});

test('bindings resolve through imports, not through same-name declarations elsewhere', async (t) => {
  const nav = `${FEATURES}/nav/home-link.tsx`;
  const layout = renderFrom('@/features/nav/home-link', 'HomeLink');
  const unrelated = await orphanCase(t, {
    [nav]:
      "const target = '/';\n\nexport const HomeLink = () => <a href={target}>Home</a>;\n",
    [`${FEATURES}/nav/unrelated.ts`]: "export const target = '/orphan';\n",
    [`${APP}/layout.tsx`]: layout,
  });
  assert.ok(
    unrelated.some(
      (item) =>
        item.rule === 'url-ia-unreachable-page' &&
        /\(\/orphan\)/.test(item.message),
    ),
  );

  const imported = await orphanCase(t, {
    [nav]:
      "import { target } from './routes';\n\nexport const HomeLink = () => <a href={target}>Orphan</a>;\n",
    [`${FEATURES}/nav/routes.ts`]: "export const target = '/orphan';\n",
    [`${FEATURES}/nav/unrelated.ts`]: "export const target = '/';\n",
    [`${APP}/layout.tsx`]: layout,
  });
  assert.ok(!imported.some((item) => /\(\/orphan\)/.test(item.message)));
});

test('links in components or menus that nothing renders do not count', async (t) => {
  for (const source of [
    'export const OrphanLink = () => <a href="/orphan">orphan</a>;\n',
    "export const UNUSED_MENU = [{ label: 'orphan', href: '/orphan' }];\n",
    "function hidden(router) {\n  router.push('/orphan');\n}\n\nexport const value = 1;\n",
  ]) {
    const findings = await orphanCase(t, {
      [`${FEATURES}/stats/dead.tsx`]: source,
    });
    assert.deepEqual(
      findings.map((item) => item.rule),
      ['url-ia-unreachable-page'],
      source,
    );
  }
});

test('a linked page that re-exports or aliases an existing page is a duplicate', async (t) => {
  for (const source of [
    "export { default } from '../reports/page';\n",
    "import Reports from '../reports/page';\n\nexport default Reports;\n",
    "export { default as default } from '@/app/reports/page';\n",
  ]) {
    const { repo, base } = fixture(t);
    const head = repo.commit('alias reports', {
      [`${APP}/_shell/menu.ts`]: menu(['/reports', '/duplicate']),
      [`${APP}/duplicate/page.tsx`]: source,
    });
    const findings = await verifyHead(repo, base, head);
    assert.deepEqual(
      findings.map((item) => item.rule),
      ['url-ia-duplicate-screen'],
      source,
    );
    assert.match(findings[0].message, /\/duplicate and \/reports/);
  }
});

test('a page aliasing another page without feature screens is still a duplicate', async (t) => {
  const { repo, base } = fixture(t);
  const head = repo.commit('plain alias', {
    [`${APP}/_shell/menu.ts`]: menu(['/reports', '/plain', '/plain-copy']),
    [`${APP}/plain/page.tsx`]:
      'export default function Plain() {\n  return <div>plain</div>;\n}\n',
    [`${APP}/plain-copy/page.tsx`]:
      "export { default } from '../plain/page';\n",
  });
  const findings = await verifyHead(repo, base, head);
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['url-ia-duplicate-screen'],
  );
  assert.match(findings[0].message, /re-exports/);
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

function reportDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-url-ia-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function runEntry(t, repo, base, head, command, options = {}) {
  const dir = reportDir(t);
  const logs = [];
  const original = [console.log, console.error];
  console.log = (line) => logs.push(String(line));
  console.error = (line) => logs.push(String(line));
  try {
    const exit = await main([command, '--pre-push'], {
      cwd: repo.dir,
      env: {},
      stdin: `refs/heads/main ${head} refs/heads/main ${base}\n`,
      reportDir: dir,
      ...options,
    });
    const report = JSON.parse(readFileSync(join(dir, 'url-ia.json'), 'utf8'));
    return { exit, report, logs };
  } finally {
    [console.log, console.error] = original;
  }
}

test('URL IA negative controls are reported but the url-ia entry still exits 0', async (t) => {
  const cases = [
    [
      { [`${APP}/orphan/page.tsx`]: page('StatsScreen', 'stats/stats-screen') },
      'url-ia-unreachable-page',
    ],
    [
      {
        [`${APP}/orphan/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
        [`${FEATURES}/stats/example.ts`]:
          'export const example = `<a href="/orphan">x</a>`;\n',
      },
      'url-ia-unreachable-page',
    ],
    [
      {
        [`${APP}/_shell/menu.ts`]: menu(['/reports', '/duplicate']),
        [`${APP}/duplicate/page.tsx`]:
          "export { default } from '../reports/page';\n",
      },
      'url-ia-duplicate-screen',
    ],
    [
      {
        [ALLOWLIST]: `${JSON.stringify({ entries: [{ rule: 'unreachable-page', url: '/gone', reason: 'old' }] })}\n`,
      },
      'url-ia-allowlist-stale',
    ],
  ];
  for (const [files, rule] of cases) {
    const { repo, base } = fixture(t);
    const head = repo.commit('change', files);
    const { exit, report, logs } = await runEntry(
      t,
      repo,
      base,
      head,
      'url-ia',
    );
    assert.equal(exit, 0, rule);
    assert.ok(
      report.findings.some((item) => item.rule === rule),
      rule,
    );
    assert.ok(report.findings.every((item) => /^https:\/\//.test(item.source)));
    assert.ok(
      logs.some((line) => line.startsWith(`REPORT [${rule}]`)),
      rule,
    );
  }
});

test('url-ia can never fail a push: findings, analyzer errors and crashes leave the exit code at 0', async (t) => {
  const crash = async () => {
    throw new TypeError('analyzer exploded');
  };
  const { repo, base } = fixture(t);
  const orphan = repo.commit('orphan', {
    [`${APP}/orphan/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
  });
  const crashed = await runEntry(t, repo, base, orphan, 'url-ia', {
    checks: { 'url-ia': crash },
  });
  assert.equal(crashed.exit, 0);
  assert.equal(crashed.report.error, 'analyzer exploded');
  assert.ok(
    crashed.logs.some((line) => /^NOTICE url-ia: analysis failed/.test(line)),
  );

  const broken = repo.commit('broken allowlist', { [ALLOWLIST]: '{not json' });
  const invalid = await runEntry(t, repo, base, broken, 'url-ia');
  assert.equal(invalid.exit, 0);
  assert.match(invalid.report.error, /not valid JSON/);

  const garbage = reportDir(t);
  const silenced = [console.log, console.error];
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(
      await main(['url-ia', '--pre-push'], {
        cwd: repo.dir,
        env: {},
        stdin: 'not a pre-push line\n',
        reportDir: garbage,
      }),
      0,
    );
  } finally {
    [console.log, console.error] = silenced;
  }

  try {
    await requireTool(GITLEAKS);
  } catch {
    t.skip(
      `gitleaks ${GITLEAKS.version} not installed; scoped push run not exercised`,
    );
    return;
  }
  const scopedRepo = fixture(t);
  const withSafe = scopedRepo.repo.commit('add public-safe', {
    '.github/check-public-safe.sh': readFileSync(
      join(REPO_ROOT, '.github/check-public-safe.sh'),
      'utf8',
    ),
  });
  const pushed = scopedRepo.repo.commit('orphan page', {
    [`${APP}/orphan/page.tsx`]: page('StatsScreen', 'stats/stats-screen'),
  });
  for (const checks of [undefined, { 'url-ia': crash }]) {
    const scoped = await runEntry(
      t,
      scopedRepo.repo,
      withSafe,
      pushed,
      'scoped',
      checks ? { checks } : {},
    );
    assert.equal(scoped.exit, 0, scoped.logs.join('\n'));
  }
});
