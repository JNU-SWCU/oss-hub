import { createRequire } from 'node:module';
import { join, posix } from 'node:path';
import { REPO_ROOT } from './tools.mjs';

let ts;

export const PLACEHOLDER = '\0';

const NON_PRODUCTION = [
  /\.(test|spec|stories|story)\.[cm]?[jt]sx?$/,
  /[.-](fixture|fixtures|mock|mocks)\.[cm]?[jt]sx?$/,
  /(^|\/)(__tests__|__mocks__|__fixtures__|fixtures?|mocks?|e2e|test|tests|test-support|stories)\//,
];
const NAVIGATION_PROPERTY = /^(href|url|destination|\w+Url|\w+Href)$/;
const ROUTER_METHODS = new Set(['push', 'replace', 'prefetch']);
const REDIRECT_FUNCTIONS = new Set(['redirect', 'permanentRedirect']);
const LOCATION_METHODS = new Set(['assign', 'replace']);
const ENTRY_FILE =
  /^apps\/frontend\/src\/(middleware\.[jt]s|app\/(.*\/)?(page|layout|template|default|not-found|error|global-error|loading|route)\.[jt]sx?)$/;
const SINK_TEXT =
  /href|url|Url|Href|destination|push|replace|prefetch|redirect|assign|location/;
const MAX_DEPTH = 14;
const MAX_COMBINATIONS = 64;

function isProductionSource(path) {
  return !NON_PRODUCTION.some((pattern) => pattern.test(path));
}

function scriptKind(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function resolveSpecifier(fromPath, specifier, paths) {
  let base;
  if (specifier.startsWith('@/')) {
    base = `apps/frontend/src/${specifier.slice(2)}`;
  } else if (specifier.startsWith('.')) {
    base = posix.join(posix.dirname(fromPath), specifier);
  } else {
    return null;
  }
  return (
    ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']
      .map((suffix) => base + suffix)
      .find((candidate) => paths.has(candidate)) ?? null
  );
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function statementsOf(node) {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    return node.statements;
  }
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return node.statements;
  return null;
}

function bindingIn(nameNode, name) {
  if (ts.isIdentifier(nameNode)) return nameNode.text === name ? [] : null;
  for (const element of nameNode.elements ?? []) {
    if (ts.isOmittedExpression(element)) continue;
    const inner = bindingIn(element.name, name);
    if (inner === null) continue;
    const key = element.propertyName ?? element.name;
    return [
      ts.isArrayBindingPattern(nameNode)
        ? nameNode.elements.indexOf(element)
        : key.text,
      ...inner,
    ];
  }
  return null;
}

function returnExpressions(fn) {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const returns = [];
  const visit = (node) => {
    if (isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      returns.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return returns;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return null;
}

class ModuleGraph {
  constructor(files) {
    this.paths = new Set(files.map((file) => file.path));
    this.modules = new Map();
    for (const { path, source } of files) {
      const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(path),
      );
      this.modules.set(path, { path, sourceFile });
    }
    this.callSites = new Map();
    this.evaluating = new Set();
    for (const module of this.modules.values()) this.indexCallSites(module);
  }

  importBinding(module, declaration, name) {
    const from = resolveSpecifier(
      module.path,
      declaration.moduleSpecifier.text,
      this.paths,
    );
    const clause = declaration.importClause;
    if (!clause) return null;
    const external = { kind: 'external' };
    if (clause.name?.text === name) {
      return from ? this.exported(from, 'default') : external;
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (bindings.name.text === name) {
        return from ? { kind: 'namespace', from } : external;
      }
    } else if (bindings) {
      for (const element of bindings.elements) {
        if (element.name.text === name) {
          return from
            ? this.exported(from, (element.propertyName ?? element.name).text)
            : external;
        }
      }
    }
    return null;
  }

  exported(path, name, seen = new Set()) {
    const module = this.modules.get(path);
    if (!module || seen.has(`${path}#${name}`)) return { kind: 'external' };
    seen.add(`${path}#${name}`);
    for (const statement of module.sourceFile.statements) {
      const exportedHere = ts
        .getModifiers?.(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = ts
        .getModifiers?.(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      if (exportedHere && ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (bindingIn(declaration.name, name)) {
            return { kind: 'variable', declaration, module };
          }
        }
      }
      if (exportedHere && ts.isFunctionDeclaration(statement)) {
        if ((isDefault ? 'default' : statement.name?.text) === name) {
          return { kind: 'function', node: statement, module };
        }
      }
      if (ts.isExportAssignment(statement) && name === 'default') {
        return { kind: 'expression', node: statement.expression, module };
      }
      if (ts.isExportDeclaration(statement)) {
        const from = statement.moduleSpecifier
          ? resolveSpecifier(path, statement.moduleSpecifier.text, this.paths)
          : null;
        if (!statement.exportClause && from) {
          const found = this.exported(from, name, seen);
          if (found.kind !== 'external') return found;
          continue;
        }
        for (const element of statement.exportClause?.elements ?? []) {
          if (element.name.text !== name) continue;
          const local = (element.propertyName ?? element.name).text;
          if (from) return this.exported(from, local, seen);
          return this.lookupInScope(module, module.sourceFile, local);
        }
      }
    }
    return { kind: 'external' };
  }

  lookupInScope(module, scope, name) {
    for (const statement of statementsOf(scope) ?? []) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (bindingIn(declaration.name, name)) {
            return { kind: 'variable', declaration, module, name };
          }
        }
      } else if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === name
      ) {
        return { kind: 'function', node: statement, module };
      } else if (ts.isImportDeclaration(statement)) {
        const binding = this.importBinding(module, statement, name);
        if (binding) return binding;
      }
    }
    return null;
  }

  lookup(identifier) {
    const module = this.modules.get(identifier.getSourceFile().fileName);
    const name = identifier.text;
    for (let node = identifier.parent; node; node = node.parent) {
      if (isFunctionLike(node)) {
        for (const [index, parameter] of node.parameters.entries()) {
          const path = bindingIn(parameter.name, name);
          if (path) return { kind: 'parameter', fn: node, index, path };
        }
        if (ts.isFunctionExpression(node) && node.name?.text === name) {
          return { kind: 'function', node, module };
        }
      }
      if (statementsOf(node)) {
        const found = this.lookupInScope(module, node, name);
        if (found) return found;
      }
    }
    return { kind: 'external' };
  }

  calleeFunction(identifier) {
    const binding = this.lookup(identifier);
    if (binding.kind === 'function') return binding.node;
    let initializer =
      binding.kind === 'variable' ? binding.declaration.initializer : null;
    while (
      initializer &&
      (ts.isParenthesizedExpression(initializer) ||
        ts.isAsExpression(initializer) ||
        ts.isSatisfiesExpression?.(initializer))
    ) {
      initializer = initializer.expression;
    }
    return initializer && isFunctionLike(initializer) ? initializer : null;
  }

  indexCallSites(module) {
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        this.addSites(node.expression, { kind: 'call', args: node.arguments });
      } else if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        ts.isIdentifier(node.tagName)
      ) {
        this.addSites(node.tagName, {
          kind: 'jsx',
          attributes: node.attributes,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }

  addSites(identifier, site) {
    const target = this.calleeFunction(identifier);
    if (!target) return;
    const list = this.callSites.get(target) ?? [];
    list.push(site);
    this.callSites.set(target, list);
  }

  sitesFor(fn) {
    return this.callSites.get(fn) ?? [];
  }

  bindingValues(binding, env, depth) {
    switch (binding.kind) {
      case 'variable': {
        const initializer = binding.declaration.initializer;
        if (!initializer) return [];
        const path = bindingIn(binding.declaration.name, binding.name ?? '');
        const values = this.evaluate(initializer, env, depth + 1);
        return path && path.length > 0
          ? this.project(values, path, depth)
          : values;
      }
      case 'function':
        return [{ t: 'fn', node: binding.node }];
      case 'expression':
        return this.evaluate(binding.node, null, depth + 1);
      case 'namespace':
        return [{ t: 'namespace', from: binding.from }];
      case 'parameter':
        return this.parameterValues(binding, env, depth);
      default:
        return [];
    }
  }

  parameterValues(binding, env, depth) {
    const bound = env?.fn === binding.fn ? env.args : null;
    const sites = bound ? [bound] : this.sitesFor(binding.fn);
    const values = [];
    for (const site of sites) {
      let argument;
      if (site.kind === 'jsx') {
        argument = [{ t: 'props', attributes: site.attributes }];
      } else {
        const node = site.args[binding.index];
        argument = node ? this.evaluate(node, site.env ?? null, depth + 1) : [];
      }
      values.push(...this.project(argument, binding.path, depth));
    }
    return values;
  }

  project(values, path, depth) {
    let current = values;
    for (const key of path) {
      current = current.flatMap((value) => this.member(value, key, depth));
    }
    return current;
  }

  member(value, key, depth) {
    if (value?.t === 'obj') {
      const values = [];
      for (const property of value.node.properties) {
        if (ts.isSpreadAssignment(property)) {
          for (const spread of this.evaluate(
            property.expression,
            value.env,
            depth + 1,
          )) {
            values.push(...this.member(spread, key, depth + 1));
          }
          continue;
        }
        const name = property.name ? propertyName(property.name) : null;
        if (key !== null && name !== key) continue;
        if (ts.isPropertyAssignment(property)) {
          values.push(
            ...this.evaluate(property.initializer, value.env, depth + 1),
          );
        } else if (ts.isShorthandPropertyAssignment(property)) {
          values.push(...this.evaluate(property.name, value.env, depth + 1));
        }
      }
      return values;
    }
    if (value?.t === 'arr') {
      const elements = value.node.elements;
      const chosen =
        typeof key === 'number' || /^\d+$/.test(String(key))
          ? [elements[Number(key)]].filter(Boolean)
          : key === null
            ? elements
            : [];
      return chosen.flatMap((element) =>
        ts.isSpreadElement(element)
          ? this.evaluate(element.expression, value.env, depth + 1).flatMap(
              (inner) => this.member(inner, null, depth + 1),
            )
          : this.evaluate(element, value.env, depth + 1),
      );
    }
    if (value?.t === 'props') {
      const values = [];
      for (const attribute of value.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        if (key !== null && attribute.name.getText() !== key) continue;
        const initializer = attribute.initializer;
        if (!initializer) continue;
        values.push(
          ...this.evaluate(
            ts.isJsxExpression(initializer)
              ? initializer.expression
              : initializer,
            null,
            depth + 1,
          ),
        );
      }
      return values;
    }
    if (value?.t === 'namespace' && typeof key === 'string') {
      return this.bindingValues(this.exported(value.from, key), null, depth);
    }
    return [];
  }

  call(fnValue, args, env, depth) {
    const site = { kind: 'call', args, env };
    const values = [];
    for (const expression of returnExpressions(fnValue.node)) {
      values.push(
        ...this.evaluate(
          expression,
          { fn: fnValue.node, args: site },
          depth + 1,
        ),
      );
    }
    return values;
  }

  evaluate(node, env, depth) {
    if (!node || depth > MAX_DEPTH) return [];
    const key = node;
    if (this.evaluating.has(key)) return [];
    this.evaluating.add(key);
    try {
      return this.evaluateNode(node, env, depth);
    } finally {
      this.evaluating.delete(key);
    }
  }

  evaluateNode(node, env, depth) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return [node.text];
    }
    if (ts.isTemplateExpression(node)) {
      let results = [node.head.text];
      for (const span of node.templateSpans) {
        const parts = this.evaluate(span.expression, env, depth + 1).filter(
          (value) => typeof value === 'string',
        );
        const choices = parts.length > 0 ? parts : [PLACEHOLDER];
        results = results
          .flatMap((prefix) =>
            choices.map((choice) => prefix + choice + span.literal.text),
          )
          .slice(0, MAX_COMBINATIONS);
      }
      return results;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression?.(node) ||
      ts.isNonNullExpression(node) ||
      ts.isTypeAssertionExpression(node)
    ) {
      return this.evaluate(node.expression, env, depth + 1);
    }
    if (ts.isConditionalExpression(node)) {
      return [
        ...this.evaluate(node.whenTrue, env, depth + 1),
        ...this.evaluate(node.whenFalse, env, depth + 1),
      ];
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.PlusToken) {
        const left = this.evaluate(node.left, env, depth + 1).filter(
          (value) => typeof value === 'string',
        );
        const right = this.evaluate(node.right, env, depth + 1).filter(
          (value) => typeof value === 'string',
        );
        return (left.length ? left : [PLACEHOLDER])
          .flatMap((a) =>
            (right.length ? right : [PLACEHOLDER]).map((b) => a + b),
          )
          .slice(0, MAX_COMBINATIONS);
      }
      if (
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        return [
          ...(operator === ts.SyntaxKind.AmpersandAmpersandToken
            ? []
            : this.evaluate(node.left, env, depth + 1)),
          ...this.evaluate(node.right, env, depth + 1),
        ];
      }
      return [];
    }
    if (ts.isIdentifier(node)) {
      return this.bindingValues(this.lookup(node), env, depth);
    }
    if (ts.isObjectLiteralExpression(node)) return [{ t: 'obj', node, env }];
    if (ts.isArrayLiteralExpression(node)) return [{ t: 'arr', node, env }];
    if (isFunctionLike(node)) return [{ t: 'fn', node }];
    if (ts.isPropertyAccessExpression(node)) {
      return this.evaluate(node.expression, env, depth + 1).flatMap((value) =>
        this.member(value, node.name.text, depth + 1),
      );
    }
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      const key =
        ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)
          ? argument.text
          : null;
      return this.evaluate(node.expression, env, depth + 1).flatMap((value) =>
        this.member(value, key, depth + 1),
      );
    }
    if (ts.isCallExpression(node)) {
      return this.evaluate(node.expression, env, depth + 1).flatMap((value) =>
        value?.t === 'fn' ? this.call(value, node.arguments, env, depth) : [],
      );
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL'
    ) {
      return this.evaluate(node.arguments?.[0], env, depth + 1);
    }
    return [];
  }

  navigationSinks(module) {
    const sinks = [];
    const add = (node, expression) => {
      if (expression && this.isLive(node)) sinks.push(expression);
    };
    const visit = (node) => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText() === 'href' &&
        node.initializer
      ) {
        const tag = node.parent.parent.tagName.getText();
        if (tag === 'a' || /^[A-Z]/.test(tag.split('.').at(-1))) {
          add(
            node,
            ts.isJsxExpression(node.initializer)
              ? node.initializer.expression
              : node.initializer,
          );
        }
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const first = node.arguments[0];
        if (ts.isIdentifier(callee) && REDIRECT_FUNCTIONS.has(callee.text)) {
          add(node, first);
        } else if (ts.isPropertyAccessExpression(callee)) {
          const method = callee.name.text;
          const receiver = callee.expression.getText();
          if (ROUTER_METHODS.has(method) && /router$/i.test(receiver)) {
            add(node, first);
          } else if (
            LOCATION_METHODS.has(method) &&
            /location$/.test(receiver)
          ) {
            add(node, first);
          } else if (
            receiver === 'NextResponse' &&
            (method === 'redirect' || method === 'rewrite')
          ) {
            add(node, first);
          }
        }
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === 'href' &&
        /location$/.test(node.left.expression.getText())
      ) {
        add(node, node.right);
      } else if (
        (ts.isPropertyAssignment(node) ||
          ts.isShorthandPropertyAssignment(node)) &&
        ts.isObjectLiteralExpression(node.parent) &&
        NAVIGATION_PROPERTY.test(propertyName(node.name) ?? '')
      ) {
        add(node, ts.isPropertyAssignment(node) ? node.initializer : node.name);
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
    return sinks;
  }

  isLive(node) {
    let statement = node;
    while (statement.parent && !ts.isSourceFile(statement.parent)) {
      statement = statement.parent;
    }
    if (
      !ts.isVariableStatement(statement) &&
      !ts.isFunctionDeclaration(statement)
    ) {
      return true;
    }
    const modifiers = ts.getModifiers?.(statement) ?? [];
    const exported = modifiers.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (
      modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      ) ||
      (exported && ENTRY_FILE.test(statement.getSourceFile().fileName))
    ) {
      return true;
    }
    const declarations = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
      : [statement];
    this.referenced ??= this.collectReferences();
    return declarations.some((declaration) => this.referenced.has(declaration));
  }

  collectReferences() {
    const referenced = new Set();
    const candidates = new Set();
    for (const module of this.modules.values()) {
      for (const statement of module.sourceFile.statements) {
        if (!SINK_TEXT.test(statement.getText())) continue;
        const declarations = ts.isVariableStatement(statement)
          ? statement.declarationList.declarations
          : ts.isFunctionDeclaration(statement)
            ? [statement]
            : [];
        for (const declaration of declarations) {
          if (declaration.name && ts.isIdentifier(declaration.name)) {
            candidates.add(declaration.name.text);
          }
        }
      }
    }
    for (const module of this.modules.values()) {
      const visit = (node) => {
        if (
          ts.isIdentifier(node) &&
          candidates.has(node.text) &&
          !(
            node.parent &&
            'name' in node.parent &&
            node.parent.name === node &&
            (ts.isVariableDeclaration(node.parent) ||
              ts.isFunctionDeclaration(node.parent) ||
              ts.isPropertyAssignment(node.parent) ||
              ts.isImportSpecifier(node.parent) ||
              ts.isImportClause(node.parent) ||
              ts.isExportSpecifier(node.parent) ||
              ts.isPropertyAccessExpression(node.parent) ||
              ts.isParameter(node.parent))
          )
        ) {
          const binding = this.lookup(node);
          if (binding.kind === 'variable') referenced.add(binding.declaration);
          if (binding.kind === 'function') referenced.add(binding.node);
        }
        ts.forEachChild(node, visit);
      };
      visit(module.sourceFile);
    }
    return referenced;
  }
}

export function navigationTargets(files) {
  ts ??= createRequire(join(REPO_ROOT, 'apps/frontend/package.json'))(
    'typescript',
  );
  const graph = new ModuleGraph(
    files.filter((file) => isProductionSource(file.path)),
  );
  const targets = [];
  for (const module of graph.modules.values()) {
    for (const sink of graph.navigationSinks(module)) {
      for (const value of graph.evaluate(sink, null, 0)) {
        if (typeof value !== 'string') continue;
        const path = value.split(/[?#]/)[0];
        if (path.startsWith('/'))
          targets.push({ path: module.path, value: path });
      }
    }
  }
  return targets;
}
