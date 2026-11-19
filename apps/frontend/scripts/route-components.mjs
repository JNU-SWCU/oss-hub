import { join, sep } from 'node:path';
import ts from 'typescript';

function walk(node, visit) {
  if (visit(node) !== false)
    ts.forEachChild(node, (child) => {
      walk(child, visit);
    });
}

function returned(fn) {
  if (!fn?.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const result = [];
  walk(fn.body, (n) => {
    if (ts.isFunctionLike(n)) return false;
    if (ts.isReturnStatement(n) && n.expression) result.push(n.expression);
  });
  return result;
}

export function analyzeComponents(dir, roots) {
  const config = ts.readConfigFile(join(dir, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.convertCompilerOptionsFromJson(
    config.config?.compilerOptions ?? {},
    dir,
  );
  const program = ts.createProgram(roots, {
    ...options,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
  });
  const checker = program.getTypeChecker();
  function decl(n) {
    let s = checker.getSymbolAtLocation(n);
    if (s?.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    return s?.valueDeclaration;
  }
  const local = (d) =>
    d &&
    !d.getSourceFile().isDeclarationFile &&
    d.getSourceFile().fileName.startsWith(dir + sep) &&
    !d.getSourceFile().fileName.includes('/node_modules/');
  function entry(file) {
    const symbol = checker.getSymbolAtLocation(program.getSourceFile(file));
    const sym = checker
      .getExportsOfModule(symbol)
      .find((s) => s.name === 'default');
    if (!sym) throw new Error(`missing default export: ${file}`);
    return (
      sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
    ).valueDeclaration;
  }
  function literal(n, seen = new Set()) {
    if (!n || seen.has(n)) return;
    seen.add(n);
    if (ts.isIdentifier(n)) return literal(decl(n)?.initializer, seen);
    if (
      ts.isAsExpression(n) ||
      ts.isParenthesizedExpression(n) ||
      ts.isSatisfiesExpression(n)
    )
      return literal(n.expression, seen);
    return n;
  }
  function bindingSources(binding, inputs) {
    const steps = [];
    let root = binding;
    while (ts.isBindingElement(root)) {
      const pattern = root.parent;
      steps.unshift({
        key: ts.isArrayBindingPattern(pattern)
          ? pattern.elements.indexOf(root)
          : (root.propertyName ?? root.name).text,
        fallback: root.initializer,
      });
      root = pattern.parent;
    }
    let sources = inputs.get(root) ?? [root.initializer];
    if (ts.isParameter(root) && root.parent.parameters[0] === root) {
      const call = root.parent.parent;
      if (
        ts.isCallExpression(call) &&
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === 'map'
      ) {
        const list = literal(call.expression.expression);
        if (list && ts.isArrayLiteralExpression(list)) sources = list.elements;
      }
    }
    for (const { key, fallback } of steps) {
      sources = sources.map((source) => {
        const node = literal(source);
        if (node && ts.isArrayLiteralExpression(node))
          return node.elements[key] ?? fallback;
        if (node && ts.isObjectLiteralExpression(node)) {
          const prop = node.properties.find((p) => p.name?.text === key);
          return (
            prop?.initializer ??
            (prop && ts.isShorthandPropertyAssignment(prop)
              ? checker.getShorthandAssignmentValueSymbol(prop)
                  ?.valueDeclaration?.initializer
              : fallback)
          );
        }
        return fallback;
      });
    }
    return sources;
  }
  function values(n, inputs, env = new Map(), seen = new Set(), exact = false) {
    if (!n || seen.has(n)) return [];
    seen = new Set([...seen, n]);
    const val = (x) => values(x, inputs, env, seen, exact);
    if (ts.isStringLiteralLike(n)) return [n.text];
    if (
      ts.isIdentifier(n) ||
      ts.isElementAccessExpression(n) ||
      ts.isPropertyAccessExpression(n)
    ) {
      const type = checker.getTypeAtLocation(n);
      const literals = (type.isUnion() ? type.types : [type]).filter((t) =>
        t.isStringLiteral(),
      );
      if (literals.length) return literals.map((t) => t.value);
    }
    if (
      ts.isJsxExpression(n) ||
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n)
    )
      return val(n.expression);
    if (ts.isConditionalExpression(n))
      return [...val(n.whenTrue), ...val(n.whenFalse)];
    if (ts.isTemplateExpression(n)) {
      let prefixes = [n.head.text];
      for (const span of n.templateSpans) {
        const parts = val(span.expression);
        if (exact && !parts.length) return [];
        prefixes = prefixes.flatMap((p) =>
          (parts.length ? parts : ['~']).map(
            (part) => p + part + span.literal.text,
          ),
        );
      }
      return prefixes;
    }
    if (ts.isCallExpression(n)) {
      const d = decl(n.expression);
      if (!local(d)) return [];
      const fn = d.initializer ?? d;
      const bindings = new Map(env);
      fn.parameters?.forEach((p, i) =>
        bindings.set(p, val(n.arguments[i] ?? p.initializer)),
      );
      return returned(fn).flatMap((x) =>
        values(x, inputs, bindings, seen, exact),
      );
    }
    const d = decl(n);
    if (d && ts.isBindingElement(d)) {
      const projected = bindingSources(d, inputs).flatMap(val);
      if (projected.length) return projected;
      const property = (d.propertyName ?? d.name).getText();
      const member = checker
        .getTypeAtLocation(d.parent)
        .getProperty(property)?.valueDeclaration;
      const sources = [
        ...(inputs.get(d) ?? []),
        ...(inputs.get(member) ?? []),
        member?.initializer,
        d.initializer,
      ];
      return sources.flatMap(val);
    }
    return (
      env.get(d) ??
      (inputs.has(d)
        ? inputs.get(d).flatMap(val)
        : local(d)
          ? val(d.initializer)
          : [])
    );
  }

  function references(file) {
    const urls = [];
    walk(program.getSourceFile(file), (n) => {
      if (
        ts.isTypeNode(n) ||
        ts.isImportDeclaration(n) ||
        ts.isExportDeclaration(n)
      )
        return false;
      if (ts.isStringLiteralLike(n) || ts.isCallExpression(n))
        urls.push(...values(n, new Map(), new Map(), new Set(), true));
    });
    return urls;
  }

  function alwaysRedirects(file) {
    const symbol = checker.getSymbolAtLocation(program.getSourceFile(file));
    const handler = checker
      .getExportsOfModule(symbol)
      .find(
        (s) => s.name === 'middleware' || s.name === 'default',
      )?.valueDeclaration;
    const body = (handler?.initializer ?? handler)?.body;
    const expr =
      body && ts.isBlock(body)
        ? body.statements.length === 1 &&
          ts.isReturnStatement(body.statements[0]) &&
          body.statements[0].expression
        : body;
    return (
      expr &&
      ts.isCallExpression(expr) &&
      decl(expr.expression)?.name?.text === 'redirect' &&
      decl(expr.expression)?.parent?.name?.text === 'NextResponse'
    );
  }

  function links(file) {
    const sinks = [];
    const inputs = new Map();
    function bind(d, x) {
      if (!d || !x) return;
      if (!inputs.has(d)) inputs.set(d, []);
      inputs.get(d).push(x);
    }
    const seen = new Set();
    function follow(d) {
      if (!local(d) || seen.has(d)) return;
      seen.add(d);
      walk(d, (n) => {
        if (ts.isTypeNode(n)) return false;
        if (n !== d && ts.isFunctionDeclaration(n)) return false;
        if (
          n !== d &&
          ts.isVariableDeclaration(n) &&
          n.initializer &&
          !ts.isCallExpression(n.initializer)
        )
          return false;
        let value;
        if (ts.isJsxAttribute(n) && n.name.getText() === 'href') {
          const tag = n.parent.parent.tagName;
          const target = decl(tag);
          if (
            tag.getText() === 'a' ||
            target?.getSourceFile().fileName.includes('/next/dist/client/link')
          )
            value = n.initializer;
          else {
            bind(decl(n.name), n.initializer);
            const props = (target?.initializer ?? target)?.parameters?.[0]
              ?.name;
            if (props && ts.isObjectBindingPattern(props)) {
              bind(
                props.elements.find(
                  (p) => (p.propertyName ?? p.name).getText() === 'href',
                ),
                n.initializer,
              );
            }
          }
        }
        if (
          (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
          n.name.getText() === 'href'
        ) {
          const prop = checker
            .getContextualType(n.parent)
            ?.getProperty('href')?.valueDeclaration;
          bind(
            prop,
            n.initializer ??
              checker.getShorthandAssignmentValueSymbol(n)?.valueDeclaration
                ?.name,
          );
        }
        if (ts.isCallExpression(n)) {
          const method = decl(n.expression);
          if (local(method))
            (method.initializer ?? method).parameters?.forEach((p, i) => {
              bind(p, n.arguments[i] ?? p.initializer);
            });
          if (
            method?.getSourceFile().fileName.includes('/next/dist/') &&
            ['push', 'replace', 'redirect', 'permanentRedirect'].includes(
              method.name?.getText(),
            )
          )
            value = n.arguments[0];
          if (
            method?.parent?.name?.text === 'Location' &&
            ['assign', 'replace'].includes(method.name.text)
          )
            value = n.arguments[0];
        }
        if (value) sinks.push(value);
        if (ts.isIdentifier(n)) follow(decl(n));
      });
    }
    follow(entry(file));
    return new Set(sinks.flatMap((sink) => values(sink, inputs)));
  }

  function screens(file) {
    const id = (d) => `${d.getSourceFile().fileName}:${d.pos}`;
    const root = entry(file);
    const direct = [id(root)];
    const branch = [];
    const outputs = returned(root.initializer ?? root).map(ts.skipParentheses);
    if (outputs.length === 1) {
      let [node] = outputs;
      let wrapper = '';
      let allowed;
      if (ts.isJsxElement(node)) {
        const outer = decl(node.openingElement.tagName);
        const content = node.children.filter(
          (c) => !ts.isJsxText(c) || c.text.trim(),
        );
        const attrs = node.openingElement.attributes.properties;
        if (
          !local(outer) ||
          content.length !== 1 ||
          attrs.length !== 1 ||
          attrs[0].name?.getText() !== 'allow'
        )
          return { direct, branch };
        allowed = attrs[0].initializer?.expression;
        wrapper = id(outer) + '/';
        [node] = content;
      }
      const component = (n) =>
        ts.isJsxSelfClosingElement(n) &&
        !n.attributes.properties.length &&
        decl(n.tagName);
      const primary = component(node);
      if (local(primary)) {
        if (!wrapper) direct.push(id(primary));
        if (allowed && ts.isArrayLiteralExpression(allowed)) {
          for (const role of allowed.elements.filter(ts.isStringLiteral))
            direct.push(`${wrapper}${id(primary)}:${role.text.toLowerCase()}`);
        }
        const choices = returned(primary.initializer ?? primary).map(
          ts.skipParentheses,
        );
        for (const choice of choices) {
          const condition = choice.parent.parent;
          if (
            wrapper &&
            local(component(choice)) &&
            ts.isIfStatement(condition) &&
            condition.thenStatement === choice.parent &&
            ts.isBinaryExpression(condition.expression) &&
            condition.expression.operatorToken.kind ===
              ts.SyntaxKind.EqualsEqualsEqualsToken &&
            ts.isStringLiteral(condition.expression.right)
          ) {
            branch.push(
              `${wrapper}${id(component(choice))}:${condition.expression.right.text.toLowerCase()}`,
            );
          }
        }
      }
    }
    return { direct, branch };
  }
  return { links, screens, references, alwaysRedirects };
}
