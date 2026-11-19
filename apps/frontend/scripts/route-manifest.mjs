import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep, resolve } from 'node:path';
import { analyzeComponents } from './route-components.mjs';

const require = createRequire(import.meta.url);
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
const { NextRequest } = require('next/server');
const {
  unstable_doesMiddlewareMatch,
} = require('next/experimental/testing/server');
const {
  transpileConfig,
} = require('next/dist/build/next-config-ts/transpile-config');
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
  const config = await loadConfig(PHASE_PRODUCTION_BUILD, dir);
  const { pageExtensions, redirects } = config;
  const middlewareFile = pageExtensions
    .map((ext) => join(dirname(appDir), `middleware.${ext}`))
    .find(existsSync);
  const middleware =
    middlewareFile &&
    (await transpileConfig({
      nextConfigPath: middlewareFile,
      configFileName: middlewareFile,
      cwd: dirname(middlewareFile),
    }));
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
  const screens = [];
  const entriesFromOutside = [];
  const links = new Map();
  const violations = new Set();
  for (const { route, filePath } of appRoutes) {
    const path = isInterceptionRouteAppPath(route)
      ? extractInterceptionRouteInformation(route).interceptedRoute
      : route;
    if (!pages.has(path)) pages.set(path, new Set());
    const contract = join(dirname(filePath), 'route-entry.ts');
    if (existsSync(contract)) {
      const { entry, source } = require(contract).default ?? {};
      const apps = resolve(dir, '..');
      const modulePath =
        typeof source === 'string' &&
        source.startsWith('apps/') &&
        resolve(apps, '..', source);
      if (
        ['api-link', 'email-link', 'external-link'].includes(entry) &&
        modulePath &&
        modulePath.startsWith(apps + sep) &&
        !modulePath.split(sep).includes('node_modules') &&
        /\.[cm]?[jt]sx?$/.test(modulePath) &&
        statSync(modulePath, { throwIfNoEntry: false })?.isFile()
      ) {
        entriesFromOutside.push(path);
      } else
        violations.add(
          `invalid entry ${path}: route-entry.ts needs an entry kind and an existing apps/ source module`,
        );
    }
    for (const file of [
      filePath,
      ...layouts.filter((layout) => filePath.startsWith(dirname(layout) + sep)),
    ]) {
      if (!links.has(file)) links.set(file, components.links(file));
      for (const url of links.get(file)) pages.get(path).add(url);
    }
    screens.push({
      path,
      params: JSON.stringify(getRouteRegex(path).groups),
      ...components.screens(filePath),
    });
  }
  for (const a of screens)
    for (const b of screens) {
      if (
        a.path !== b.path &&
        a.params === b.params &&
        a.direct.some((id) => b.direct.includes(id) || b.branch.includes(id))
      ) {
        violations.add(`duplicate ${[a.path, b.path].sort().join(' and ')}`);
      }
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
  const visited = new Set();
  async function visit(url, chain = new Set()) {
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
        await visit(
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
    if (visited.has(url)) return;
    visited.add(url);
    const requestUrl = new URL(url, 'https://route.invalid');
    if (
      middleware &&
      unstable_doesMiddlewareMatch({
        config: middleware.config ?? {},
        nextConfig: config,
        url: requestUrl.href,
      })
    ) {
      const response = await (middleware.middleware ?? middleware.default)(
        new NextRequest(requestUrl),
      );
      const location = response?.headers.get('location');
      if (location && response.status >= 300 && response.status < 400) {
        const target = new URL(location, requestUrl);
        if (target.origin === requestUrl.origin)
          await visit(target.pathname + target.search);
      }
    }
    const route = routes.find(([, re]) => re.test(path))?.[0];
    if (!route || reached.has(route)) return;
    reached.add(route);
    for (const target of pages.get(route)) await visit(target);
  }
  for (const seed of ['/', ...entriesFromOutside]) await visit(seed);
  for (const path of pages.keys())
    if (!reached.has(path)) violations.add(`unreachable ${path}`);
  return [...violations].sort();
}

console.log(JSON.stringify(await manifest(process.cwd())));
