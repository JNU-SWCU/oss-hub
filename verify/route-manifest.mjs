import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeComponents } from './route-components.mjs';
import { finding, git, isEntry, REPO_ROOT, run } from './tools.mjs';

const require = createRequire(
  new URL('../apps/frontend/package.json', import.meta.url),
);
const {
  collectAppFiles,
  createPagesMapping,
  processAppRoutes,
} = require('next/dist/build/entries');
const { findPagesDir } = require('next/dist/lib/find-pages-dir');
const {
  createValidFileMatcher,
} = require('next/dist/server/lib/find-page-file');
const { default: loadConfig } = require('next/dist/server/config');
const { PHASE_PRODUCTION_BUILD } = require('next/constants');
const utils = 'next/dist/shared/lib/router/utils/';
const { getSortedRoutes } = require(`${utils}sorted-routes`);
const { getRouteRegex } = require(`${utils}route-regex`);
const { getPathMatch } = require(`${utils}path-match`);
const { prepareDestination } = require(`${utils}prepare-destination`);
const {
  isInterceptionRouteAppPath,
  extractInterceptionRouteInformation,
} = require(`${utils}interception-routes`);

async function manifest(dir) {
  const { appDir } = findPagesDir(dir);
  const { pageExtensions, redirects } = await loadConfig(
    PHASE_PRODUCTION_BUILD,
    dir,
  );
  const matcher = createValidFileMatcher(pageExtensions, appDir);
  const { appPaths, layoutPaths } = await collectAppFiles(appDir, matcher);
  const mapping = await createPagesMapping({
    pagePaths: appPaths,
    pagesType: 'app',
    isDev: false,
    pageExtensions,
    appDir,
  });
  const { appRoutes: entries } = processAppRoutes(
    mapping,
    matcher,
    dir,
    appDir === join(dir, 'src/app'),
  );
  const appRoutes = entries.filter(
    ({ filePath }) => !matcher.isMetadataFile(filePath),
  );
  const layouts = layoutPaths.map((path) => join(appDir, path));
  const components = analyzeComponents(dir, [
    ...appRoutes.map((page) => page.filePath),
    ...layouts,
  ]);
  const pages = new Map();
  const owners = new Map();
  const links = new Map();
  const violations = new Set();
  for (const { route, filePath } of appRoutes) {
    const path = isInterceptionRouteAppPath(route)
      ? extractInterceptionRouteInformation(route).interceptedRoute
      : route;
    if (!pages.has(path)) pages.set(path, new Set());
    for (const file of [
      filePath,
      ...layouts.filter((layout) => filePath.startsWith(dirname(layout) + sep)),
    ]) {
      if (!links.has(file)) links.set(file, components.links(file));
      for (const url of links.get(file)) pages.get(path).add(url);
    }
    for (const screen of components.screens(filePath)) {
      if (!owners.has(screen)) owners.set(screen, new Set());
      owners.get(screen).add(path);
    }
  }
  for (const urls of owners.values()) {
    const paths = [...urls].sort();
    paths.forEach((path, i) => {
      for (const other of paths.slice(i + 1))
        violations.add(`duplicate ${path} and ${other}`);
    });
  }
  const routes = getSortedRoutes([...pages.keys()]).map((route) => [
    route,
    getRouteRegex(route).re,
  ]);
  const aliases = ((await redirects?.()) ?? []).map((rule) => ({
    ...rule,
    match: getPathMatch(rule.source),
  }));
  const reached = new Set();
  function visit(url, chain = new Set()) {
    if (!url.startsWith('/') || url.startsWith('//')) return;
    const path = url.split(/[?#]/, 1)[0];
    for (const rule of aliases) {
      const params = rule.match(path);
      if (!params) continue;
      if (chain.has(rule)) throw new Error(`redirect cycle at ${path}`);
      if (
        rule.destination.startsWith('/') &&
        !rule.destination.startsWith('//')
      )
        visit(
          prepareDestination({
            destination: rule.destination,
            params,
            query: {},
            appendParamsToQuery: false,
          }).newUrl,
          new Set([...chain, rule]),
        );
      if (!rule.has && !rule.missing) return;
    }
    const route = routes.find(([, re]) => re.test(path))?.[0];
    if (!route || reached.has(route)) return;
    reached.add(route);
    for (const target of pages.get(route)) visit(target);
  }
  visit('/');
  for (const path of pages.keys())
    if (!reached.has(path)) violations.add(`unreachable ${path}`);
  return [...violations].sort();
}

async function atRevision(cwd, rev) {
  const temp = mkdtempSync(join(tmpdir(), 'route-manifest-'));
  try {
    const frontend = 'apps/frontend';
    const archive = await git(cwd, ['archive', rev, frontend], { raw: true });
    const extract = await run('tar', ['-xf', '-', '-C', temp], {
      input: archive,
    });
    if (extract.code !== 0) throw new Error(extract.stderr);
    symlinkSync(
      join(REPO_ROOT, frontend, 'node_modules'),
      join(temp, frontend, 'node_modules'),
      'dir',
    );
    // Next loads project-relative config imports from the application's cwd.
    const report = await run(
      process.execPath,
      [fileURLToPath(import.meta.url), '--snapshot'],
      { cwd: join(temp, frontend) },
    );
    if (report.code !== 0) throw new Error(report.stderr);
    return JSON.parse(report.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function checkRouteManifest({ cwd, ranges }) {
  const findings = [];
  for (const { base, head } of ranges) {
    const ancestor = await git(cwd, ['merge-base', base, head]);
    const existing = new Set(await atRevision(cwd, ancestor));
    for (const violation of await atRevision(cwd, head)) {
      if (!existing.has(violation))
        findings.push(
          finding(
            'route-manifest',
            violation,
            head.slice(0, 9),
            `absent at ${ancestor.slice(0, 9)}`,
            'https://github.com/JNU-SWCU/oss-hub/issues/1963',
          ),
        );
    }
  }
  return findings;
}

if (isEntry(import.meta.url)) {
  if (process.argv[2] === '--snapshot')
    console.log(JSON.stringify(await manifest(process.cwd())));
  else
    console.log(
      (await atRevision(REPO_ROOT, process.argv[2] ?? 'HEAD')).join('\n'),
    );
}
