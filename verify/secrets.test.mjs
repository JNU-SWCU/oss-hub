import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkSecrets } from './secrets.mjs';
import { tempRepo } from './test-support.mjs';
import { GITLEAKS, REPO_ROOT, requireTool } from './tools.mjs';

const PUBLIC_SAFE = '.github/check-public-safe.sh';

function secretsRepo(t) {
  const repo = tempRepo(t);
  const base = repo.commit('base', {
    [PUBLIC_SAFE]: readFileSync(join(REPO_ROOT, PUBLIC_SAFE), 'utf8'),
  });
  return { repo, base };
}

async function gitleaksOrSkip(t) {
  try {
    await requireTool(GITLEAKS);
    return true;
  } catch {
    t.skip(`gitleaks ${GITLEAKS.version} not installed (${GITLEAKS.install})`);
    return false;
  }
}

test('a missing gitleaks binary fails with install guidance', async (t) => {
  const { repo, base } = secretsRepo(t);
  await assert.rejects(
    checkSecrets({
      cwd: repo.dir,
      ranges: [{ base, head: base, ref: 'main' }],
      tool: { ...GITLEAKS, bin: '/nonexistent/gitleaks' },
    }),
    /gitleaks 8\.30\.1 is required.*Install it/,
  );
});

test('a clean range passes both gitleaks and public-safe', async (t) => {
  if (!(await gitleaksOrSkip(t))) return;
  const { repo, base } = secretsRepo(t);
  const head = repo.commit('docs: clean', { 'docs/a.md': 'hello\n' });
  assert.deepEqual(
    await checkSecrets({
      cwd: repo.dir,
      ranges: [{ base, head, ref: 'main' }],
    }),
    [],
  );
});

test('a token committed in the pushed range is blocked', async (t) => {
  if (!(await gitleaksOrSkip(t))) return;
  const { repo, base } = secretsRepo(t);
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const body = [...randomBytes(36)]
    .map((byte) => alphabet[byte % alphabet.length])
    .join('');
  const token = ['g', 'h', 'p', '_'].join('') + body;
  const head = repo.commit('feat: config', {
    'apps/backend/src/config.ts': `export const token = '${token}';\n`,
  });
  const findings = await checkSecrets({
    cwd: repo.dir,
    ranges: [{ base, head, ref: 'main' }],
  });
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['secrets-gitleaks'],
  );
  assert.doesNotMatch(findings[0].message, new RegExp(body));
});

test('a personal email in the pushed range is blocked by public-safe', async (t) => {
  if (!(await gitleaksOrSkip(t))) return;
  const { repo, base } = secretsRepo(t);
  const email = ['student', 'jnu-mail.kr'].join('@');
  const head = repo.commit('docs: contact', {
    'docs/contact.md': `${email}\n`,
  });
  const findings = await checkSecrets({
    cwd: repo.dir,
    ranges: [{ base, head, ref: 'main' }],
  });
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['public-safe'],
  );
});
