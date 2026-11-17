import {
  VerifyError,
  finding,
  issueTrailers,
  showAtRevision,
} from './tools.mjs';

const TRAILER = 'Allowlist-Approved';

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new VerifyError(`${label} is not valid JSON: ${error.message}`);
  }
}

function queryLintGrowth(base, head) {
  return Object.entries(head)
    .filter(
      ([key, entry]) =>
        !base[key] || (entry?.count ?? 1) > (base[key]?.count ?? 1),
    )
    .map(([key, entry]) =>
      base[key]
        ? `${key} count ${base[key]?.count ?? 1} -> ${entry?.count ?? 1}`
        : key,
    );
}

async function loadAllowlistModule(text, label) {
  try {
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
    );
    return module.awaitInLoopAllowlist ?? {};
  } catch (error) {
    throw new VerifyError(`${label} could not be loaded: ${error.message}`);
  }
}

function methodKeys(allowlist) {
  return Object.entries(allowlist).flatMap(([file, methods]) =>
    Object.keys(methods ?? {}).map((method) => `${file}#${method}`),
  );
}

function urlIaKeys(allowlist) {
  return (allowlist.entries ?? []).map((entry) => `${entry.rule} ${entry.url}`);
}

function multisetGrowth(baseKeys, headKeys) {
  const remaining = new Map();
  for (const key of baseKeys) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  const added = [];
  for (const key of headKeys) {
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else added.push(key);
  }
  return added;
}

function limits(thresholds) {
  const entries = [];
  for (const goal of thresholds.lighthouse?.goals ?? []) {
    if (typeof goal.max === 'number') {
      entries.push([`lighthouse.${goal.id}.max`, goal.max, 'max']);
    }
    if (typeof goal.min === 'number') {
      entries.push([`lighthouse.${goal.id}.min`, goal.min, 'min']);
    }
  }
  for (const key of ['maxHopMs', 'maxHops']) {
    if (typeof thresholds.loginStart?.[key] === 'number') {
      entries.push([`loginStart.${key}`, thresholds.loginStart[key], 'max']);
    }
  }
  return entries;
}

function thresholdLoosening(base, head) {
  const headLimits = new Map(limits(head).map(([key, value]) => [key, value]));
  return limits(base).flatMap(([key, value, kind]) => {
    const next = headLimits.get(key);
    if (next === undefined) return [`${key} removed`];
    const looser = kind === 'max' ? next > value : next < value;
    return looser ? [`${key} ${value} -> ${next}`] : [];
  });
}

const GUARDED_FILES = [
  {
    path: 'verify/query-lint-allowlist.json',
    growth: async (base, head, path) =>
      queryLintGrowth(parseJson(base, path), parseJson(head, path)),
  },
  {
    path: 'apps/backend/eslint-rules/no-await-in-loop.allowlist.mjs',
    growth: async (base, head, path) =>
      multisetGrowth(
        methodKeys(await loadAllowlistModule(base, path)),
        methodKeys(await loadAllowlistModule(head, path)),
      ),
  },
  {
    path: 'verify/url-ia-allowlist.json',
    growth: async (base, head, path) =>
      multisetGrowth(
        urlIaKeys(parseJson(base, path)),
        urlIaKeys(parseJson(head, path)),
      ),
  },
  {
    path: 'verify/thresholds.json',
    growth: async (base, head, path) =>
      thresholdLoosening(parseJson(base, path), parseJson(head, path)),
  },
];

export async function checkAllowlistGrowth({ cwd, ranges }) {
  const findings = [];
  for (const range of ranges) {
    const grown = [];
    for (const { path, growth } of GUARDED_FILES) {
      const headText = await showAtRevision(cwd, range.head, path);
      if (headText === null) continue;
      const baseText = await showAtRevision(cwd, range.base, path);
      if (baseText === null) {
        throw new VerifyError(
          `${path} does not exist at trusted base ${range.base.slice(0, 9)}; refusing to compare against the working copy`,
        );
      }
      const added = await growth(
        baseText,
        headText,
        `${path} at ${range.head}`,
      );
      if (added.length > 0) grown.push({ path, added });
    }
    if (grown.length === 0) continue;
    const approvals = await issueTrailers(cwd, range, TRAILER);
    if (approvals.length > 0) {
      console.log(
        `NOTICE [allowlist-growth] approved by ${TRAILER}: ${approvals.join(', ')} (${grown.map(({ path }) => path).join(', ')})`,
      );
      continue;
    }
    for (const { path, added } of grown) {
      findings.push(
        finding(
          'allowlist-growth',
          `${path} grew vs trusted base ${range.base.slice(0, 9)}:\n  ${added.join('\n  ')}\n  intentional? add a commit trailer "${TRAILER}: #<issue>"`,
          `${added.length} new or loosened entr${added.length === 1 ? 'y' : 'ies'}`,
          `no growth without a ${TRAILER} trailer`,
        ),
      );
    }
  }
  return findings;
}
