import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(
  new URL('../apps/backend/package.json', import.meta.url),
);
const ts = require('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const verbs = new Set(['Get', 'Post', 'Patch', 'Put', 'Delete']);
const clients = new Set([
  'apiClient',
  'apiFileClient',
  'apiPath',
  'serverApiClient',
  'landingJson',
  'fetch',
  'fetchPublicJson',
]);

function parse(text, file, warn) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length > 0) {
    warn(`Skipping unparsable TypeScript: ${file}`);
    return undefined;
  }
  return source;
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function decorators(node) {
  return (ts.getDecorators(node) ?? [])
    .map((decorator) => decorator.expression)
    .filter(ts.isCallExpression);
}

function requestMethod(options) {
  return options && ts.isObjectLiteralExpression(options)
    ? options.properties.find((property) => property.name?.text === 'method')
        ?.initializer
    : undefined;
}

export function backendRoutes(
  text,
  file = 'controller.ts',
  warn = console.warn,
) {
  const source = parse(text, file, warn);
  const routes = [];
  if (!source) return routes;
  walk(source, (node) => {
    if (!ts.isClassDeclaration(node)) return;
    const controller = decorators(node).find(
      (call) => call.expression.getText(source) === 'Controller',
    );
    if (!controller) return;
    const prefix = controller.arguments[0]?.text ?? '';
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      for (const call of decorators(member)) {
        const verb = call.expression.getText(source);
        if (!verbs.has(verb)) continue;
        routes.push({
          method: verb.toUpperCase(),
          path: normalizePath(`${prefix}/${call.arguments[0]?.text ?? ''}`),
          file,
          line:
            source.getLineAndCharacterOfPosition(member.getStart(source)).line +
            1,
        });
      }
    }
  });
  return routes;
}

export function normalizePath(path) {
  return path
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^:?param\/api\/v1\//, '')
    .replace(/^\/?api\/v1\//, '')
    .split(/[?#]/)[0]
    .replace(/^\/+|\/+$/g, '');
}

export function frontendCalls(text, file = 'client.ts', warn = console.warn) {
  const source = parse(text, file, warn);
  if (!source) return [];
  const bindings = new Map();
  const names = new Set(clients);
  const wrapperMethods = new Map();
  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      bindings.set(node.name.getText(source), node.initializer);
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const returned = node.body.statements.find(ts.isReturnStatement);
      if (returned?.expression)
        bindings.set(node.name.text, returned.expression);
    }
    if (ts.isParameter(node) && node.type && ts.isUnionTypeNode(node.type)) {
      const options = node.type.types
        .filter(ts.isLiteralTypeNode)
        .map((type) => type.literal);
      if (options.length === node.type.types.length)
        bindings.set(node.name.getText(source), options);
    }
    if (ts.isImportSpecifier(node) && clients.has(node.propertyName?.text)) {
      names.add(node.name.text);
    }
  });
  walk(source, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !names.has(node.expression.getText(source)) ||
      !node.arguments[0] ||
      !ts.isIdentifier(node.arguments[0])
    )
      return;
    let owner = node.parent;
    while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
    if (
      !owner?.name ||
      owner.parameters[0]?.name.getText(source) !== node.arguments[0].text
    )
      return;
    names.add(owner.name.text);
    const method = requestMethod(node.arguments[1]);
    if (method && ts.isStringLiteral(method))
      wrapperMethods.set(owner.name.text, method.text);
  });
  function literals(node, seen = new Set()) {
    if (!node || seen.has(node)) return [];
    if (Array.isArray(node))
      return node.flatMap((part) => literals(part, seen));
    const visited = new Set([...seen, node]);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isConditionalExpression(node)) {
      return [
        ...literals(node.whenTrue, visited),
        ...literals(node.whenFalse, visited),
      ];
    }
    if (ts.isArrowFunction(node)) return literals(node.body, visited);
    if (ts.isParenthesizedExpression(node))
      return literals(node.expression, visited);
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.reduce(
        (heads, span) => {
          const parts = literals(span.expression, visited);
          return heads.flatMap((head) =>
            (parts.length ? parts : [':param']).map(
              (part) => `${head}${part}${span.literal.text}`,
            ),
          );
        },
        [node.head.text],
      );
    }
    if (ts.isIdentifier(node))
      return literals(bindings.get(node.text), visited);
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      return callee === 'withQuery'
        ? literals(node.arguments[0], visited)
        : literals(bindings.get(callee), visited);
    }
    return [];
  }
  const calls = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = node.expression.getText(source);
    if (!names.has(name) && !/^serverApi\w*$/.test(name)) return;
    const paths = [...new Set(literals(node.arguments[0]).map(normalizePath))];
    calls.push(
      ...paths.map((path) => ({
        method: (
          wrapperMethods.get(name) ??
          literals(requestMethod(node.arguments[1]))[0] ??
          'GET'
        ).toUpperCase(),
        path,
        file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      })),
    );
  });
  return calls;
}

export function routeMatches(route, call) {
  if (route.method !== call.method) return false;
  const expected = normalizePath(route.path).split('/');
  const actual = normalizePath(call.path).split('/');
  return (
    expected.length === actual.length &&
    expected.every((segment, index) =>
      segment.startsWith(':')
        ? actual[index].length > 0
        : segment === actual[index],
    )
  );
}

function files(path) {
  if (statSync(path).isFile()) return [path];
  return ts.sys.readDirectory(
    path,
    ['.ts', '.tsx'],
    ['**/*.test.*', '**/*.spec.*', '**/*fixture*', '**/*support*'],
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean' },
      placement: { type: 'boolean' },
      frontend: { type: 'string', default: resolve(root, 'apps/frontend/src') },
    },
  });
  const routes = files(resolve(root, 'apps/backend/src'))
    .flatMap((file) =>
      backendRoutes(readFileSync(file, 'utf8'), relative(root, file)),
    )
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    );
  const calls = files(resolve(values.frontend)).flatMap((file) =>
    frontendCalls(readFileSync(file, 'utf8'), relative(root, file)),
  );
  const placed = routes.map((route) => ({ ...route, callers: [] }));
  const specificity = (route) =>
    route.path.split('/').filter((part) => !part.startsWith(':')).length;
  for (const call of calls) {
    placed
      .filter((route) => routeMatches(route, call))
      .sort((a, b) => specificity(b) - specificity(a))[0]
      ?.callers.push(call);
  }
  const output = values.placement
    ? placed
    : {
        used: placed.filter((route) => route.callers.length > 0),
        unusedCandidates: placed.filter((route) => route.callers.length === 0),
      };
  console.log(JSON.stringify(output, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
