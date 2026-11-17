export const PLACEHOLDER = '\0';

const QUOTES = `'"\``;
const IDENTIFIER = /(?<![.\w$])([A-Za-z_$][\w$]*)/g;
const NAVIGATION_CONTEXTS = [
  /\shref=(?!=)\{?/g,
  /\.href\s*=(?!=)\s*/g,
  /\b\w*(?:href|Href|url|Url|destination)\s*:\s*/g,
  /\b(?:push|replace|redirect|permanentRedirect|navigate|assign|prefetch)\s*\(\s*/g,
];
const SHORTHAND_NAVIGATION = /[{,]\s*(href|url|destination)\s*(?=[,}])/g;
const MAX_DEPTH = 6;

function skipLiteral(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    if (quote !== '`' && char === '\n') return index + 1;
    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      index = closingIndex(source, index + 1) + 1;
      continue;
    }
    index += 1;
  }
  return index;
}

function closingIndex(source, openIndex) {
  let depth = 0;
  let index = openIndex;
  while (index < source.length) {
    const char = source[index];
    if (QUOTES.includes(char)) {
      index = skipLiteral(source, index);
      continue;
    }
    if ('([{'.includes(char)) depth += 1;
    if (')]}'.includes(char)) {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return source.length;
}

function stripComments(source) {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (QUOTES.includes(char)) {
      const end = skipLiteral(source, index);
      output += source.slice(index, end);
      index = end;
    } else if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      output += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
}

function readExpression(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index += 1;
  if (QUOTES.includes(source[index])) {
    return source.slice(index, skipLiteral(source, index));
  }
  const begin = index;
  while (index < source.length) {
    const char = source[index];
    if (QUOTES.includes(char)) {
      index = skipLiteral(source, index);
      continue;
    }
    if ('([{'.includes(char)) {
      index = closingIndex(source, index) + 1;
      continue;
    }
    if (',;)]}'.includes(char)) break;
    index += 1;
  }
  return source.slice(begin, index).trim();
}

function topLevelArgs(source, openIndex) {
  const inner = source.slice(openIndex + 1, closingIndex(source, openIndex));
  const args = [];
  let index = 0;
  let begin = 0;
  while (index < inner.length) {
    const char = inner[index];
    if (QUOTES.includes(char)) {
      index = skipLiteral(inner, index);
      continue;
    }
    if ('([{'.includes(char)) {
      index = closingIndex(inner, index) + 1;
      continue;
    }
    if (char === ',') {
      args.push(inner.slice(begin, index).trim());
      begin = index + 1;
    }
    index += 1;
  }
  args.push(inner.slice(begin).trim());
  return args.filter(Boolean);
}

function literalsOf(expression) {
  const literals = [];
  let index = 0;
  while (index < expression.length) {
    if (QUOTES.includes(expression[index])) {
      const end = skipLiteral(expression, index);
      const after = expression.slice(end).trimStart();
      const before = expression.slice(0, index).trimEnd();
      const objectKey = after.startsWith(':') && /[{,]$/.test(before);
      if (!objectKey) literals.push(expression.slice(index + 1, end - 1));
      index = end;
      continue;
    }
    index += 1;
  }
  return literals;
}

function withoutLiterals(expression) {
  let output = '';
  let index = 0;
  while (index < expression.length) {
    if (QUOTES.includes(expression[index])) {
      const end = skipLiteral(expression, index);
      output += ' '.repeat(end - index);
      index = end;
      continue;
    }
    output += expression[index];
    index += 1;
  }
  return output;
}

function parameterNames(text) {
  return topLevelArgs(`(${text})`, 0).map(
    (param) => /^[\s.]*([A-Za-z_$][\w$]*)/.exec(param)?.[1] ?? '',
  );
}

function functionBody(source, afterParams) {
  const arrow = /^\s*(?::[^=]*?)?=>\s*/.exec(source.slice(afterParams));
  const blockStart = arrow
    ? afterParams + arrow[0].length
    : source.indexOf('{', afterParams);
  if (blockStart < 0) return { body: '', returns: [] };
  if (source[blockStart] !== '{' || (arrow && source[blockStart] !== '{')) {
    const expression = readExpression(source, blockStart);
    return { body: expression, returns: [expression] };
  }
  const body = source.slice(blockStart, closingIndex(source, blockStart) + 1);
  const returns = [...body.matchAll(/\breturn\b/g)].map((match) =>
    readExpression(body, match.index + match[0].length),
  );
  return { body, returns };
}

function collectSymbols(files) {
  const symbols = new Map();
  const add = (name, symbol) =>
    symbols.set(name, [...(symbols.get(name) ?? []), symbol]);
  const declaration =
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+?)?=\s*(?:async\s+)?(\()?/g;
  for (const { source } of files) {
    for (const match of source.matchAll(declaration)) {
      const openParen = match.index + match[0].length - 1;
      if (match[1] || match[3]) {
        const close = closingIndex(source, openParen);
        const params = parameterNames(source.slice(openParen + 1, close));
        const afterParams = close + 1;
        const isArrow = /^\s*(?::[^=]*?)?=>/.test(source.slice(afterParams));
        if (match[1] || isArrow) {
          add(match[1] ?? match[2], {
            params,
            ...functionBody(source, afterParams),
          });
          continue;
        }
      }
      if (match[2]) {
        const start = match.index + match[0].length - (match[3] ? 1 : 0);
        add(match[2], { value: readExpression(source, start) });
      }
    }
  }
  return symbols;
}

function navigationExpressions(source) {
  const expressions = [];
  for (const context of NAVIGATION_CONTEXTS) {
    for (const match of source.matchAll(context)) {
      expressions.push(readExpression(source, match.index + match[0].length));
    }
  }
  for (const match of source.matchAll(SHORTHAND_NAVIGATION)) {
    expressions.push(match[1]);
  }
  return expressions.filter(Boolean);
}

function callArguments(source, navigationParams) {
  const expressions = [];
  for (const [name, indexes] of navigationParams) {
    for (const call of source.matchAll(
      new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g'),
    )) {
      const args = topLevelArgs(source, call.index + call[0].length - 1);
      for (const index of indexes) {
        if (args[index]) expressions.push(args[index]);
      }
    }
  }
  return expressions;
}

function navigationParameters(symbols) {
  const navigationParams = new Map();
  for (let round = 0; round < 5; round += 1) {
    let changed = false;
    for (const [name, definitions] of symbols) {
      for (const definition of definitions) {
        if (!definition.params) continue;
        const expressions = [
          ...navigationExpressions(definition.body),
          ...callArguments(definition.body, navigationParams),
        ];
        definition.params.forEach((param, index) => {
          if (!param) return;
          const used = expressions.some((expression) =>
            new RegExp(
              `(?<![.\\w$])${param.replace(/\$/g, '\\$')}(?![\\w$])`,
            ).test(withoutLiterals(expression)),
          );
          const known = navigationParams.get(name) ?? new Set();
          if (used && !known.has(index)) {
            known.add(index);
            navigationParams.set(name, known);
            changed = true;
          }
        });
      }
    }
    if (!changed) break;
  }
  return navigationParams;
}

function substituteArguments(text, params, args) {
  let output = text;
  params.forEach((param, index) => {
    const literal = /^(['"`])([^'"`$]*)\1$/.exec(args[index] ?? '');
    if (param && literal) {
      output = output.replace(
        new RegExp(`\\$\\{\\s*${param.replace(/\$/g, '\\$')}\\s*\\}`, 'g'),
        literal[2],
      );
    }
  });
  return output;
}

function resolver(symbols) {
  const memo = new Map();
  const active = new Set();
  const resolve = (expression, depth = 0) => {
    if (memo.has(expression)) return memo.get(expression);
    if (depth > MAX_DEPTH || active.has(expression)) return new Set();
    active.add(expression);
    const paths = new Set();
    for (const literal of literalsOf(expression)) {
      const head = /^\$\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(literal);
      if (!head) {
        paths.add(literal);
        continue;
      }
      const rest = literal.slice(head[0].length);
      const prefixes = [...resolve(head[1], depth + 1)].filter((prefix) =>
        prefix.startsWith('/'),
      );
      for (const prefix of prefixes) paths.add(prefix + rest);
      if (prefixes.length === 0) paths.add(literal);
    }
    const code = withoutLiterals(expression);
    for (const match of code.matchAll(IDENTIFIER)) {
      const name = match[1];
      const definitions = symbols.get(name);
      if (!definitions) continue;
      const call = /^\s*\(/.exec(code.slice(match.index + name.length));
      const args = call
        ? topLevelArgs(
            expression,
            match.index + name.length + call[0].length - 1,
          )
        : [];
      for (const definition of definitions) {
        const sources = definition.params
          ? definition.returns.map((text) =>
              substituteArguments(text, definition.params, args),
            )
          : [definition.value];
        for (const text of sources) {
          for (const path of resolve(text, depth + 1)) {
            if (path.startsWith('/')) paths.add(path);
          }
        }
      }
    }
    active.delete(expression);
    if (depth === 0 || paths.size > 0) memo.set(expression, paths);
    return paths;
  };
  return resolve;
}

function normalizePath(text) {
  return text
    .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, PLACEHOLDER)
    .split(/[?#]/)[0];
}

export function navigationTargets(files) {
  const stripped = files.map(({ path, source }) => ({
    path,
    source: stripComments(source),
  }));
  const symbols = collectSymbols(stripped);
  const navigationParams = navigationParameters(symbols);
  const resolve = resolver(symbols);
  const targets = [];
  for (const { path, source } of stripped) {
    const expressions = [
      ...navigationExpressions(source),
      ...callArguments(source, navigationParams),
    ];
    for (const expression of expressions) {
      for (const raw of resolve(expression)) {
        const value = normalizePath(raw);
        if (value.startsWith('/')) targets.push({ path, value });
      }
    }
  }
  return targets;
}
