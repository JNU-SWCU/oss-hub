import { globSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import {
  collectAppFiles,
  createPagesMapping,
  processAppRoutes,
} from 'next/dist/build/entries.js';
import { findPagesDir } from 'next/dist/lib/find-pages-dir.js';
import { createValidFileMatcher } from 'next/dist/server/lib/find-page-file.js';
import { getRouteRegex } from 'next/dist/shared/lib/router/utils/route-regex.js';
import {
  isInterceptionRouteAppPath,
  extractInterceptionRouteInformation,
} from 'next/dist/shared/lib/router/utils/interception-routes.js';
import configModule from 'next/dist/server/config.js';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';

const dir = process.cwd();
const { appDir } = findPagesDir(dir);
const { pageExtensions, redirects } = await configModule.default(
  PHASE_PRODUCTION_BUILD,
  dir,
);
const matcher = createValidFileMatcher(pageExtensions, appDir);
const { appPaths } = await collectAppFiles(appDir, matcher);
const mapping = await createPagesMapping({
  pagePaths: appPaths,
  pagesType: 'app',
  isDev: false,
  pageExtensions,
  appDir,
});
const pages = processAppRoutes(
  mapping,
  matcher,
  dir,
  relative(dir, appDir) === 'src/app',
)
  .appRoutes.filter(({ filePath }) => !matcher.isMetadataFile(filePath))
  .map(({ route, filePath }) => ({
    route: isInterceptionRouteAppPath(route)
      ? extractInterceptionRouteInformation(route).interceptedRoute
      : route,
    filePath,
  }));

const sources = globSync(
  [
    'src/**/*',
    'app/**/*',
    'middleware.*',
    'next.config.*',
    '../backend/src/**/*',
    '../backend/prisma/**/*',
  ],
  { cwd: dir },
)
  .filter(
    (p) =>
      /\.[cm]?[jt]sx?$/.test(p) &&
      !/(?:\.(?:test|spec|d)\.[^.]+$|(?:^|\/)(?:__tests__|test-support|tests?)\/)/.test(
        p,
      ),
  )
  .map((p) => join(dir, p));
const config = ts.readConfigFile(join(dir, 'tsconfig.json'), ts.sys.readFile);
const { options } = ts.convertCompilerOptionsFromJson(
  config.config?.compilerOptions ?? {},
  dir,
);
const program = ts.createProgram(sources, {
  ...options,
  allowJs: true,
  jsx: ts.JsxEmit.Preserve,
});
const checker = program.getTypeChecker();
function declaration(node) {
  let s = checker.getSymbolAtLocation(node);
  if (s?.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
  return s?.valueDeclaration;
}
function walk(node, visit) {
  if (visit(node) !== false)
    ts.forEachChild(node, (child) => {
      walk(child, visit);
    });
}
function returns(fn) {
  if (!fn?.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const result = [];
  walk(fn.body, (n) => {
    if (ts.isFunctionLike(n)) return false;
    if (ts.isReturnStatement(n) && n.expression)
      result.push(ts.skipParentheses(n.expression));
  });
  return result;
}

const paths = new Set(['/']);
function record(value) {
  const path = value
    ?.replace(/^(?:https?:\/\/[^/]+|~)(?=\/)/, '')
    .split(/[?#]/, 1)[0];
  if (path?.startsWith('/') && !path.startsWith('//') && !/^[/~]+$/.test(path))
    paths.add(path);
}
function text(n, args = new Map(), seen = new Set()) {
  if (!n || seen.has(n)) return '~';
  seen = new Set([...seen, n]);
  const part = (x) => text(x, args, seen);
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isTemplateExpression(n))
    return (
      n.head.text +
      n.templateSpans.map((s) => part(s.expression) + s.literal.text).join('')
    );
  if (
    ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return part(n.left) + part(n.right);
  if (ts.isIdentifier(n)) {
    const d = declaration(n);
    return args.get(d) ?? part(d?.initializer);
  }
  if (ts.isCallExpression(n)) {
    const d = declaration(n.expression);
    const fn = d?.initializer ?? d;
    if (
      !fn ||
      seen.has(fn) ||
      !fn.parameters ||
      fn.getSourceFile().isDeclarationFile
    )
      return '~';
    const body = fn.body;
    const out =
      body &&
      (ts.isBlock(body)
        ? body.statements.find(ts.isReturnStatement)?.expression
        : body);
    if (
      !out ||
      !(
        ts.isTemplateExpression(out) ||
        ts.isStringLiteralLike(out) ||
        ts.isBinaryExpression(out)
      )
    )
      return '~';
    seen.add(fn);
    const bindings = new Map(args);
    fn.parameters.forEach((p, i) =>
      bindings.set(p, part(n.arguments[i] ?? p.initializer)),
    );
    return text(out, bindings, seen);
  }
  return '~';
}
for (const file of sources) {
  walk(program.getSourceFile(file), (n) => {
    if (
      ts.isImportDeclaration(n) ||
      ts.isExportDeclaration(n) ||
      ts.isTypeNode(n)
    )
      return false;
    if (
      ts.isStringLiteralLike(n) ||
      ts.isTemplateExpression(n) ||
      ts.isCallExpression(n) ||
      (ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.PlusToken)
    )
      record(text(n));
  });
}
for (const rule of (await redirects?.()) ?? []) {
  record(rule.source);
  record(rule.destination);
}

function screens(file) {
  const symbol = checker
    .getExportsOfModule(
      checker.getSymbolAtLocation(program.getSourceFile(file)),
    )
    .find((s) => s.name === 'default');
  const root = (
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol
  ).valueDeclaration;
  const direct = [root],
    branch = [];
  const whole = returns(root.initializer ?? root);
  const childrenOf = (node) =>
    node.children.filter((child) => !ts.isJsxText(child) || child.text.trim());
  const component = (node) => {
    if (ts.isJsxFragment(node)) {
      const children = childrenOf(node);
      return children.length === 1 && component(children[0]);
    }
    const element = ts.isJsxElement(node)
      ? childrenOf(node).length === 0 && node.openingElement
      : ts.isJsxSelfClosingElement(node) && node;
    return (
      element &&
      !ts.isIntrinsicJsxName(element.tagName.getText()) &&
      !element.attributes.properties.length &&
      declaration(element.tagName)
    );
  };
  if (whole.length === 1) {
    const node = whole[0];
    if (component(node)) direct.push(component(node));
    if (ts.isJsxElement(node)) {
      const outer = declaration(node.openingElement.tagName);
      const attrs = node.openingElement.attributes.properties;
      const children = node.children.filter(
        (c) => !ts.isJsxText(c) || c.text.trim(),
      );
      const child = children.length === 1 && component(children[0]);
      if (
        outer &&
        child &&
        attrs.length === 1 &&
        attrs[0].name?.getText() === 'allow'
      ) {
        const key = (d, role) =>
          `${outer.getSourceFile().fileName}:${outer.pos}/${d.getSourceFile().fileName}:${d.pos}/${role.toLowerCase()}:${d.name?.getText() ?? 'default'}`;
        const allow = attrs[0].initializer?.expression;
        if (allow && ts.isArrayLiteralExpression(allow))
          for (const role of allow.elements.filter(ts.isStringLiteral))
            direct.push(key(child, role.text));
        for (const out of returns(child.initializer ?? child)) {
          const guard = out.parent.parent;
          if (
            component(out) &&
            ts.isIfStatement(guard) &&
            guard.thenStatement === out.parent &&
            ts.isBinaryExpression(guard.expression) &&
            guard.expression.operatorToken.kind ===
              ts.SyntaxKind.EqualsEqualsEqualsToken &&
            ts.isStringLiteral(guard.expression.right)
          )
            branch.push(key(component(out), guard.expression.right.text));
        }
      }
    }
  }
  return { direct, branch };
}
const findings = new Set();
const owners = pages.map(({ route, filePath }) => {
  const { re, groups } = getRouteRegex(route);
  const prefix = route.replace(/(?:\/\[[^/]+\])+$/, '');
  if (!paths.has(prefix) && ![...paths].some((path) => re.test(path)))
    findings.add(`unreferenced ${route}`);
  return { route, params: JSON.stringify(groups), ...screens(filePath) };
});
for (const a of owners)
  for (const b of owners) {
    const shared = a.direct.find(
      (d) => b.direct.includes(d) || b.branch.includes(d),
    );
    if (a.route !== b.route && a.params === b.params && shared)
      findings.add(
        `duplicate ${[a.route, b.route].sort().join(' and ')} (component ${typeof shared === 'string' ? shared.split(':').at(-1) : (shared.name?.getText() ?? 'default')})`,
      );
  }
console.log(JSON.stringify([...findings].sort()));
