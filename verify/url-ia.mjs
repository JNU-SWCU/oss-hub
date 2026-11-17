import { posix } from 'node:path';
import { PLACEHOLDER, navigationTargets } from './url-ia-links.mjs';
import {
  VerifyError,
  finding,
  git,
  isEntry,
  showAtRevision,
} from './tools.mjs';

const APP_DIR = 'apps/frontend/src/app/';
const SOURCE_ROOTS = ['apps/frontend/src', 'apps/backend/src'];
const SOURCE_FILE = /\.(tsx?|mjs|js)$/;
const PAGE_FILE = /(^|\/)page\.(tsx|ts|jsx|js)$/;
const ALLOWLIST_PATH = 'verify/url-ia-allowlist.json';
const RULES = {
  'unreachable-page':
    'every page.tsx is the target of an href, router navigation, redirect or menu entry',
  'duplicate-screen': 'one canonical URL per screen component or page module',
};
export function routeOfPage(path) {
  const relative = path.slice(APP_DIR.length).replace(PAGE_FILE, '');
  const raw = relative.split('/').filter(Boolean);
  if (raw.some((segment) => segment.startsWith('_'))) return null;
  const segments = raw
    .filter(
      (segment) =>
        !segment.startsWith('@') && !/^\((?!\.)[^)]*\)$/.test(segment),
    )
    .map((segment) => segment.replace(/^(\(\.{1,3}\))+/, ''));
  return {
    file: path,
    url: `/${segments.join('/')}`,
    modal: raw.some((segment) => segment.startsWith('@')),
    segments,
  };
}

function routeMatcher(segments) {
  const parts = segments.map((segment) => {
    if (/^\[\[?\.\.\./.test(segment)) return '/.+';
    if (/^\[.+\]$/.test(segment)) return '/[^/?#]+';
    return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  });
  return new RegExp(`^${parts.join('') || '/'}${PLACEHOLDER}?$`);
}

function resolveImport(fromFile, specifier, fileSet) {
  let base;
  if (specifier.startsWith('@/')) {
    base = `apps/frontend/src/${specifier.slice(2)}`;
  } else if (specifier.startsWith('.')) {
    base = posix.join(posix.dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map(
    (suffix) => base + suffix,
  );
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function importsOf(source) {
  const imports = new Map();
  const statement =
    /import\s+(?:type\s+)?([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const [, clause, specifier] of source.matchAll(statement)) {
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1].split(',')) {
        const [original, local] = part
          .replace(/^\s*type\s+/, '')
          .split(/\s+as\s+/)
          .map((name) => name.trim());
        if (original) imports.set(local ?? original, { original, specifier });
      }
    }
    const defaultName = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (defaultName) {
      imports.set(defaultName[1], { original: 'default', specifier });
    }
  }
  return imports;
}

function renderedImports(source, imports) {
  const rendered = [];
  for (const [, tag] of source.matchAll(/<([A-Z][\w$]*)[\s/>]/g)) {
    if (imports.has(tag)) rendered.push(imports.get(tag));
  }
  const reExport = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const [, clause, specifier] of source.matchAll(reExport)) {
    for (const part of clause.split(',')) {
      const [original, exported] = part
        .split(/\s+as\s+/)
        .map((name) => name.trim());
      if ((exported ?? original) === 'default') {
        rendered.push({ original, specifier });
      }
    }
  }
  const defaultAlias = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/g;
  for (const [, name] of source.matchAll(defaultAlias)) {
    if (imports.has(name)) rendered.push(imports.get(name));
  }
  return rendered;
}

function screenComponents(file, byPath, depth = 0, seen = new Set()) {
  const source = byPath.get(file);
  if (source === undefined || depth > 3 || seen.has(file)) return new Set();
  seen.add(file);
  const imports = importsOf(source);
  const screens = new Set();
  for (const imported of renderedImports(source, imports)) {
    const resolved = resolveImport(file, imported.specifier, byPath);
    if (resolved?.startsWith(APP_DIR) && PAGE_FILE.test(resolved)) {
      screens.add(`page:${resolved}`);
    }
    if (
      imported.specifier.startsWith('@/features/') ||
      resolved?.startsWith('apps/frontend/src/features/')
    ) {
      screens.add(
        imported.original === 'default'
          ? `${resolved ?? imported.specifier}#default`
          : imported.original,
      );
    } else if (
      resolved?.startsWith(APP_DIR) &&
      !resolved.includes('/_shell/')
    ) {
      for (const screen of screenComponents(
        resolved,
        byPath,
        depth + 1,
        seen,
      )) {
        screens.add(screen);
      }
    }
  }
  return screens;
}

export function analyzeTree(files) {
  const byPath = new Map(files.map((file) => [file.path, file.source]));
  const pages = files
    .filter(
      (file) => file.path.startsWith(APP_DIR) && PAGE_FILE.test(file.path),
    )
    .map((file) => routeOfPage(file.path))
    .filter(Boolean);
  const candidates = navigationTargets(files);
  const violations = new Map();

  for (const page of pages) {
    const matcher = routeMatcher(page.segments);
    const reachable = candidates.some(
      (candidate) =>
        candidate.path !== page.file && matcher.test(candidate.value),
    );
    if (!reachable) {
      violations.set(`unreachable-page ${page.url}`, {
        rule: 'unreachable-page',
        urls: [page.url],
        detail: `${page.file} (${page.url}) has no in-app link, redirect or menu entry`,
      });
    }
  }

  const screens = pages
    .filter((page) => !page.modal)
    .map((page) => ({ page, screens: screenComponents(page.file, byPath) }));
  for (const [index, left] of screens.entries()) {
    for (const right of screens.slice(index + 1)) {
      if (left.page.url === right.page.url) continue;
      const aliased =
        left.screens.has(`page:${right.page.file}`) ||
        right.screens.has(`page:${left.page.file}`);
      const [smaller, larger] =
        left.screens.size <= right.screens.size
          ? [left.screens, right.screens]
          : [right.screens, left.screens];
      const shared = [...smaller].filter(
        (screen) => !screen.startsWith('page:'),
      );
      if (
        !aliased &&
        (shared.length === 0 || !shared.every((screen) => larger.has(screen)))
      ) {
        continue;
      }
      const urls = [left.page.url, right.page.url].sort();
      violations.set(`duplicate-screen ${urls.join(' ')}`, {
        rule: 'duplicate-screen',
        urls,
        detail: `${urls.join(' and ')} render the same screen (${aliased ? 'one page module re-exports the other' : shared.join(', ')})`,
      });
    }
  }
  return { pages, violations };
}

export async function readTree(cwd, revision) {
  const listing = await git(cwd, [
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    revision,
    '--',
    ...SOURCE_ROOTS,
  ]);
  const paths = listing
    .split('\0')
    .filter((path) => path && SOURCE_FILE.test(path));
  if (paths.length === 0) return [];
  const output = await git(cwd, ['cat-file', '--batch'], {
    input: paths.map((path) => `${revision}:${path}`).join('\n') + '\n',
    raw: true,
    timeoutMs: 120_000,
  });
  const files = [];
  let offset = 0;
  for (const path of paths) {
    const headerEnd = output.indexOf(10, offset);
    const header = output.subarray(offset, headerEnd).toString('utf8');
    const size = Number(header.split(' ')[2]);
    if (!/ blob \d+$/.test(header)) {
      throw new VerifyError(`cannot read ${revision}:${path} (${header})`);
    }
    const start = headerEnd + 1;
    files.push({
      path,
      source: output.subarray(start, start + size).toString('utf8'),
    });
    offset = start + size + 1;
  }
  return files;
}

export function parseAllowlist(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new VerifyError(
      `${ALLOWLIST_PATH} is not valid JSON: ${error.message}`,
    );
  }
  if (!Array.isArray(data?.entries)) {
    throw new VerifyError(`${ALLOWLIST_PATH} must have an "entries" array`);
  }
  for (const [index, entry] of data.entries.entries()) {
    if (!RULES[entry?.rule]) {
      throw new VerifyError(
        `${ALLOWLIST_PATH} entry ${index}: unknown rule "${entry?.rule}" (expected ${Object.keys(RULES).join(' or ')})`,
      );
    }
    if (typeof entry.url !== 'string' || !entry.url.startsWith('/')) {
      throw new VerifyError(
        `${ALLOWLIST_PATH} entry ${index}: "url" must start with /`,
      );
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new VerifyError(
        `${ALLOWLIST_PATH} entry ${index}: "reason" is required`,
      );
    }
  }
  return data.entries;
}

export function newViolations(baseViolations, headViolations, allowlist) {
  const used = new Set();
  const blocking = [];
  for (const [key, violation] of headViolations) {
    if (baseViolations.has(key)) continue;
    const allowed = allowlist.findIndex(
      (entry) =>
        entry.rule === violation.rule && violation.urls.includes(entry.url),
    );
    if (allowed >= 0) {
      used.add(allowed);
      continue;
    }
    blocking.push(violation);
  }
  const stale = allowlist.filter(
    (entry, index) =>
      !used.has(index) &&
      ![...headViolations.values()].some(
        (violation) =>
          violation.rule === entry.rule && violation.urls.includes(entry.url),
      ),
  );
  return { blocking, stale };
}

export async function checkUrlIa({ cwd, ranges, log = console.log }) {
  const findings = [];
  for (const range of ranges) {
    const allowlistText = await showAtRevision(cwd, range.head, ALLOWLIST_PATH);
    if (allowlistText === null) {
      throw new VerifyError(
        `${ALLOWLIST_PATH} is missing at ${range.head.slice(0, 9)}`,
      );
    }
    const allowlist = parseAllowlist(allowlistText);
    const base = analyzeTree(await readTree(cwd, range.base));
    const head = analyzeTree(await readTree(cwd, range.head));
    if (head.pages.length === 0) {
      throw new VerifyError(
        `no page files found under ${APP_DIR} at ${range.head.slice(0, 9)}; refusing to report a pass`,
      );
    }
    const existing = [...head.violations.values()].filter((violation) =>
      base.violations.has(`${violation.rule} ${violation.urls.join(' ')}`),
    );
    log(
      `url-ia: ${head.pages.length} pages at ${range.head.slice(0, 9)}, ${existing.length} existing violation(s) reported only:`,
    );
    for (const violation of existing) {
      log(`  existing [${violation.rule}] ${violation.detail}`);
    }
    const { blocking, stale } = newViolations(
      base.violations,
      head.violations,
      allowlist,
    );
    for (const violation of blocking) {
      findings.push(
        finding(
          `url-ia-${violation.rule}`,
          `new violation since ${range.base.slice(0, 9)}: ${violation.detail}; link it from navigation, remove it, or add an entry with a reason to ${ALLOWLIST_PATH}`,
          violation.rule === 'unreachable-page'
            ? '0 inbound links'
            : `${violation.urls.length} URLs for one screen`,
          RULES[violation.rule],
        ),
      );
    }
    for (const entry of stale) {
      findings.push(
        finding(
          'url-ia-allowlist-stale',
          `${ALLOWLIST_PATH} entry ${entry.rule} ${entry.url} matches no current violation; remove it`,
          'unused allowlist entry',
          'every allowlist entry matches a violation',
        ),
      );
    }
  }
  return findings;
}

if (isEntry(import.meta.url)) {
  import('./index.mjs')
    .then(({ main }) => main(['url-ia', ...process.argv.slice(2)]))
    .then(
      (code) => {
        process.exitCode = code;
      },
      (error) => {
        console.log(
          `NOTICE url-ia: could not run (${error.message}); report only, the exit code is unaffected`,
        );
        process.exitCode = 0;
      },
    );
}
