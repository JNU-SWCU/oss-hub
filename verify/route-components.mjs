import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

const ts = createRequire(
  new URL('../apps/frontend/package.json', import.meta.url),
)('typescript');

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
    const module = checker.getSymbolAtLocation(program.getSourceFile(file));
    const sym = checker
      .getExportsOfModule(module)
      .find((s) => s.name === 'default');
    if (!sym) throw new Error(`missing default export: ${file}`);
    return (
      sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
    ).valueDeclaration;
  }
  // Evaluate strings only at navigation sinks; an unknown interpolation stands
  // for one example dynamic segment, never for an arbitrary path prefix.
  function values(n, inputs, env = new Map(), seen = new Set()) {
    if (!n || seen.has(n)) return [];
    seen = new Set([...seen, n]);
    const val = (x) => values(x, inputs, env, seen);
    if (ts.isStringLiteralLike(n)) return [n.text];
    if (ts.isElementAccessExpression(n) || ts.isPropertyAccessExpression(n)) {
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
      return returned(fn).flatMap((x) => values(x, inputs, bindings, seen));
    }
    const d = decl(n);
    return (
      env.get(d) ??
      (inputs.has(d)
        ? inputs.get(d).flatMap(val)
        : local(d)
          ? val(d.initializer)
          : [])
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

  // Only follow whole return branches, not widgets inside a composed screen.
  // A single child inside a layout-like wrapper is its page content.
  function screens(file) {
    const result = new Set();
    const seen = new Set();
    function render(n) {
      if (ts.isParenthesizedExpression(n)) return render(n.expression);
      if (ts.isConditionalExpression(n)) {
        render(n.whenTrue);
        render(n.whenFalse);
        return;
      }
      if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
        const children = n.children.filter(
          (c) => !ts.isJsxText(c) || c.text.trim(),
        );
        if (
          children.length === 1 &&
          (ts.isJsxElement(children[0]) ||
            ts.isJsxSelfClosingElement(children[0]))
        )
          return render(children[0]);
        if (children.length || ts.isJsxFragment(n)) return;
        n = n.openingElement;
      }
      if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) return;
      const d = decl(n.tagName);
      if (!local(d)) return;
      const props = n.attributes.properties.map((p) => p.getText()).sort();
      result.add(`${d.getSourceFile().fileName}:${d.pos}:${props.join(' ')}`);
      if (!props.length) expand(d);
    }
    function expand(d) {
      if (seen.has(d)) return;
      seen.add(d);
      for (const expr of returned(d.initializer ?? d)) render(expr);
    }
    const root = entry(file);
    result.add(`${root.getSourceFile().fileName}:${root.pos}:`);
    expand(root);
    return result;
  }
  return { links, screens };
}
