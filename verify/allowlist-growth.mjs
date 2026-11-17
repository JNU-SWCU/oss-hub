import {
  VerifyError,
  finding,
  issueTrailers,
  showAtRevision,
} from './tools.mjs';

const TRAILER = 'Allowlist-Approved';

function parseJson(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new VerifyError(`${label} is not valid JSON: ${error.message}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VerifyError(`${label} is not a JSON object`);
  }
  return value;
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
  let allowlist;
  try {
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
    );
    allowlist = module.awaitInLoopAllowlist;
  } catch (error) {
    throw new VerifyError(`${label} could not be loaded: ${error.message}`);
  }
  if (allowlist === null || typeof allowlist !== 'object') {
    throw new VerifyError(`${label} does not export awaitInLoopAllowlist`);
  }
  return allowlist;
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
    parse: async (text, label) => parseJson(text, label),
    growth: queryLintGrowth,
  },
  {
    path: 'apps/backend/eslint-rules/no-await-in-loop.allowlist.mjs',
    parse: async (text, label) =>
      methodKeys(await loadAllowlistModule(text, label)),
    growth: multisetGrowth,
  },
  {
    path: 'verify/url-ia-allowlist.json',
    parse: async (text, label) => urlIaKeys(parseJson(text, label)),
    growth: multisetGrowth,
  },
  {
    path: 'verify/thresholds.json',
    parse: async (text, label) => parseJson(text, label),
    growth: thresholdLoosening,
  },
];

async function headGrowth(cwd, range, { path, parse, growth }) {
  const baseText = await showAtRevision(cwd, range.base, path);
  const headText = await showAtRevision(cwd, range.head, path);
  if (baseText === null && headText === null) return [];
  if (baseText === null) {
    throw new VerifyError(
      `${path} does not exist at trusted base ${range.base.slice(0, 9)}; refusing to compare against the working copy`,
    );
  }
  const base = await parse(baseText, `${path} at ${range.base}`);
  if (headText === null) return ['file deleted or renamed'];
  if (headText.trim() === '') return ['file emptied'];
  let head;
  try {
    head = await parse(headText, `${path} at ${range.head.slice(0, 9)}`);
  } catch (error) {
    if (error instanceof VerifyError) return [`unparseable: ${error.message}`];
    throw error;
  }
  return growth(base, head);
}

export async function checkAllowlistGrowth({ cwd, ranges }) {
  const findings = [];
  for (const range of ranges) {
    const grown = [];
    for (const file of GUARDED_FILES) {
      const added = await headGrowth(cwd, range, file);
      if (added.length > 0) grown.push({ path: file.path, added });
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
