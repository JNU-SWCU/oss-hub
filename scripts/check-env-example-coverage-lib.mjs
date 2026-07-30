// env 계약은 세 선언 목록의 집합 관계를 검사한다.
// - compose 필수 보간·runtime manifest 키는 .env.example 에 선언되어야 한다.
// - runtime manifest 키는 backend environment 에 주입되어야 한다.
// - RUNTIME_CONFIG_KEYS·loader property·env.KEY 읽기는 서로 같아야 한다.
// 일반 소스의 process.env 금지는 ESLint가 소유하며 이 파일은 소스 AST를 순회하지 않는다.

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

const CHECK = Object.freeze({
  composeDeclaration: 'compose-declaration',
  runtimeDeclaration: 'runtime-declaration',
  backendInjection: 'backend-injection',
});

export const ENV_CONTRACT_EXEMPTIONS = Object.freeze([
  Object.freeze({
    key: 'IMAGE_TAG',
    checks: Object.freeze([CHECK.composeDeclaration]),
    reason: 'Jenkins가 주입하는 production image 치환 키이다.',
  }),
  Object.freeze({
    key: 'NODE_ENV',
    checks: Object.freeze([CHECK.runtimeDeclaration, CHECK.backendInjection]),
    reason: 'Dockerfile과 compose.local.yml이 소유한다.',
  }),
  Object.freeze({
    key: 'DIGEST_FORCE_TO',
    checks: Object.freeze([CHECK.runtimeDeclaration, CHECK.backendInjection]),
    reason: 'notifications CLI 전용 키이다.',
  }),
  Object.freeze({
    key: 'SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED',
    checks: Object.freeze([CHECK.backendInjection]),
    reason: 'submissions maintenance CLI 전용 키이다.',
  }),
  Object.freeze({
    key: 'SUBMISSION_FILE_CLEANUP_OPERATOR_ID',
    checks: Object.freeze([CHECK.backendInjection]),
    reason: 'submissions maintenance CLI 전용 키이다.',
  }),
  Object.freeze({
    key: 'GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES',
    checks: Object.freeze([CHECK.backendInjection]),
    reason: 'collection smoke CLI 전용 키이다.',
  }),
  Object.freeze({
    key: 'GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS',
    checks: Object.freeze([CHECK.backendInjection]),
    reason: 'collection smoke CLI 전용 키이다.',
  }),
]);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractEnvExampleKeys(text) {
  const keys = [];
  const seen = new Set();

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    keys.push(match[1]);
  }

  return keys;
}

/**
 * compose 원문에서 필수 `${VAR:?}`·`${VAR?error}` 키를
 * 최초 등장 순서로 중복 없이 추출한다.
 *
 * @param {string} composeText
 * @returns {string[]}
 */
export function extractRequiredComposeKeys(composeText) {
  const keys = [];
  const seen = new Set();

  for (const rawLine of composeText.split(/\r?\n/)) {
    collectRequiredKeysFromSegment(stripYamlLineComment(rawLine), keys, seen);
  }

  return keys;
}

/**
 * canonical runtime-config 파일의 manifest·loader·env 읽기를 추출한다.
 * loader는 직접 `return Object.freeze({ KEY: env.KEY })` 형태여야 한다.
 *
 * @param {string} text
 * @returns {{
 *   manifestKeys: string[],
 *   loaderPropertyKeys: string[],
 *   loaderReadKeys: string[],
 *   errors: string[]
 * }}
 */
export function extractRuntimeConfigContract(text) {
  const { withoutComments, code } = maskTypeScriptNonCode(text);
  const errors = [];
  const manifestKeys = [];
  const loaderPropertyKeys = [];
  const loaderReadKeys = [];
  let manifestParsed = false;
  let loaderParsed = false;

  const manifestStarts = [
    ...code.matchAll(/^[ \t]*export\s+const\s+RUNTIME_CONFIG_KEYS\s*=\s*\[/gm),
  ];

  if (manifestStarts.length !== 1) {
    errors.push(
      `env example contract: RUNTIME_CONFIG_KEYS must be declared exactly once; found ${manifestStarts.length}`,
    );
  } else {
    const match = manifestStarts[0];
    const start = (match.index ?? 0) + match[0].lastIndexOf('[');
    const end = findBalanced(code, start, '[', ']');

    if (end < 0) {
      errors.push(
        'env example contract: RUNTIME_CONFIG_KEYS array is unclosed',
      );
    } else {
      if (!/^\s*as\s+const\s*;/.test(code.slice(end + 1))) {
        errors.push(
          'env example contract: RUNTIME_CONFIG_KEYS must end with `as const;`',
        );
      }
      parseManifestEntries(
        withoutComments.slice(start + 1, end),
        manifestKeys,
        errors,
      );
      manifestParsed = true;
    }
  }

  const loaderStarts = [
    ...code.matchAll(
      /^[ \t]*export\s+function\s+loadRuntimeConfig\s*\(\s*env\s*:\s*NodeJS\.ProcessEnv\s*\)\s*:\s*RuntimeConfig\s*\{/gm,
    ),
  ];

  if (loaderStarts.length !== 1) {
    errors.push(
      `env example contract: loadRuntimeConfig must be declared exactly once; found ${loaderStarts.length}`,
    );
  } else {
    const loaderMatch = loaderStarts[0];
    const functionStart =
      (loaderMatch.index ?? 0) + loaderMatch[0].lastIndexOf('{');
    const functionEnd = findBalanced(code, functionStart, '{', '}');

    if (functionEnd < 0) {
      errors.push('env example contract: loadRuntimeConfig body is unclosed');
    } else {
      const functionBody = code.slice(functionStart + 1, functionEnd);
      const returns = [
        ...functionBody.matchAll(/\breturn\s+Object\.freeze\s*\(\s*\{/g),
      ];

      if (returns.length !== 1) {
        errors.push(
          `env example contract: loadRuntimeConfig must directly return exactly one Object.freeze object; found ${returns.length}`,
        );
      } else {
        const returnMatch = returns[0];
        const objectStart =
          functionStart +
          1 +
          (returnMatch.index ?? 0) +
          returnMatch[0].lastIndexOf('{');
        const objectEnd = findBalanced(code, objectStart, '{', '}');

        if (objectEnd < 0) {
          errors.push(
            'env example contract: loadRuntimeConfig Object.freeze object is unclosed',
          );
        } else {
          if (functionBody.slice(0, returnMatch.index).trim()) {
            errors.push(
              'env example contract: loadRuntimeConfig must not contain statements before the return',
            );
          }
          if (!/^\s*\)\s*;\s*$/.test(code.slice(objectEnd + 1, functionEnd))) {
            errors.push(
              'env example contract: loadRuntimeConfig must only return Object.freeze({...})',
            );
          }

          parseLoaderEntries(
            withoutComments.slice(objectStart + 1, objectEnd),
            loaderPropertyKeys,
            loaderReadKeys,
            errors,
          );
          loaderParsed = true;
        }
      }
    }
  }

  if (manifestParsed && loaderParsed) {
    compareKeySets(
      'RUNTIME_CONFIG_KEYS',
      manifestKeys,
      'loadRuntimeConfig properties',
      loaderPropertyKeys,
      errors,
    );
    compareKeySets(
      'RUNTIME_CONFIG_KEYS',
      manifestKeys,
      'loadRuntimeConfig env reads',
      loaderReadKeys,
      errors,
    );
  }

  return {
    manifestKeys,
    loaderPropertyKeys,
    loaderReadKeys,
    errors,
  };
}

/**
 * docker compose config JSON의 services.<service>.environment만 검사한다.
 *
 * @param {object|null|undefined} composeConfig
 * @param {string} service
 * @param {string} key
 * @returns {boolean}
 */
export function serviceEnvironmentMapsKey(composeConfig, service, key) {
  const environment = composeConfig?.services?.[service]?.environment;
  if (environment == null) return false;

  if (Array.isArray(environment)) {
    return environment.some((entry) => {
      if (typeof entry !== 'string') return false;
      return entry === key || entry.startsWith(`${key}=`);
    });
  }

  if (typeof environment === 'object') {
    return Object.prototype.hasOwnProperty.call(environment, key);
  }

  return false;
}

/**
 * @param {{
 *   composeText: string,
 *   envExampleText: string,
 *   runtimeConfigText: string,
 *   composeConfig: object|null,
 *   options?: { composeConfigSkipped?: boolean }
 * }} input
 * @returns {{ ok: true }|{ ok: false, errors: string[] }}
 */
export function evaluateEnvContract({
  composeText,
  envExampleText,
  runtimeConfigText,
  composeConfig,
  options = {},
}) {
  const errors = [];
  const envKeys = new Set(extractEnvExampleKeys(envExampleText));
  const requiredComposeKeys = extractRequiredComposeKeys(composeText);
  const runtime = extractRuntimeConfigContract(runtimeConfigText);
  const composeDeclarationExempt = exemptionKeys(CHECK.composeDeclaration);
  const runtimeDeclarationExempt = exemptionKeys(CHECK.runtimeDeclaration);
  const backendInjectionExempt = exemptionKeys(CHECK.backendInjection);

  errors.push(...runtime.errors);

  for (const key of requiredComposeKeys) {
    if (composeDeclarationExempt.has(key) || envKeys.has(key)) continue;
    errors.push(`env example contract: required key missing: ${key}`);
  }

  for (const key of runtime.manifestKeys) {
    if (runtimeDeclarationExempt.has(key) || envKeys.has(key)) continue;
    errors.push(
      `env example contract: runtime key missing from .env.example: ${key}`,
    );
  }

  if (composeConfig) {
    if (
      !serviceEnvironmentMapsKey(composeConfig, 'backend', 'AUTH_INITIAL_ROLES')
    ) {
      errors.push(
        'env example contract: backend environment must explicitly map AUTH_INITIAL_ROLES.',
      );
    }

    for (const key of runtime.manifestKeys) {
      if (
        key === 'AUTH_INITIAL_ROLES' ||
        backendInjectionExempt.has(key) ||
        serviceEnvironmentMapsKey(composeConfig, 'backend', key)
      ) {
        continue;
      }
      errors.push(
        `env example contract: runtime key not mapped in backend service environment: ${key}`,
      );
    }
  } else if (!options.composeConfigSkipped) {
    errors.push(
      'env example contract: compose config model is required for service mapping checks',
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * @param {string[]} requiredKeys
 * @returns {string}
 */
export function buildSyntheticEnvFile(requiredKeys) {
  const lines = [];
  const seen = new Set();

  for (const key of requiredKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${key}=synthetic-${key}`);
  }

  return `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
}

/**
 * @param {string} check
 */
function exemptionKeys(check) {
  return new Set(
    ENV_CONTRACT_EXEMPTIONS.filter((entry) => entry.checks.includes(check)).map(
      (entry) => entry.key,
    ),
  );
}

/**
 * TypeScript 주석을 제거한 view와 문자열·주석까지 가린 code view를 만든다.
 * 두 결과는 원문과 길이가 같아서 index를 원문에 그대로 적용할 수 있다.
 *
 * @param {string} source
 */
function maskTypeScriptNonCode(source) {
  let withoutComments = '';
  let code = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n' || ch === '\r') {
        lineComment = false;
        withoutComments += ch;
        code += ch;
      } else {
        withoutComments += ' ';
        code += ' ';
      }
      continue;
    }

    if (blockComment) {
      if (ch === '*' && next === '/') {
        withoutComments += '  ';
        code += '  ';
        blockComment = false;
        i += 1;
      } else {
        const masked = ch === '\n' || ch === '\r' ? ch : ' ';
        withoutComments += masked;
        code += masked;
      }
      continue;
    }

    if (quote) {
      withoutComments += ch;
      code += ch === '\n' || ch === '\r' ? ch : ' ';

      if (ch === '\\' && next !== undefined) {
        withoutComments += next;
        code += next === '\n' || next === '\r' ? next : ' ';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      withoutComments += '  ';
      code += '  ';
      lineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      withoutComments += '  ';
      code += '  ';
      blockComment = true;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      withoutComments += ch;
      code += ' ';
      continue;
    }

    withoutComments += ch;
    code += ch;
  }

  return { withoutComments, code };
}

/**
 * @param {string} text
 * @param {number} start
 * @param {string} open
 * @param {string} close
 */
function findBalanced(text, start, open, close) {
  let depth = 0;

  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) {
      depth += 1;
    } else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * @param {string} body
 * @param {string[]} keys
 * @param {string[]} errors
 */
function parseManifestEntries(body, keys, errors) {
  const seen = new Set();

  for (const rawEntry of body.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const match = /^(['"])([A-Z][A-Z0-9_]*)\1$/.exec(entry);
    if (!match) {
      errors.push(
        `env example contract: unsupported RUNTIME_CONFIG_KEYS entry: ${snippet(entry)}`,
      );
      continue;
    }

    const key = match[2];
    if (seen.has(key)) {
      errors.push(
        `env example contract: duplicate RUNTIME_CONFIG_KEYS key: ${key}`,
      );
      continue;
    }

    seen.add(key);
    keys.push(key);
  }
}

/**
 * @param {string} body
 * @param {string[]} properties
 * @param {string[]} reads
 * @param {string[]} errors
 */
function parseLoaderEntries(body, properties, reads, errors) {
  const seenProperties = new Set();
  const seenReads = new Set();

  for (const rawEntry of body.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const match = /^([A-Z][A-Z0-9_]*)\s*:\s*env\.([A-Z][A-Z0-9_]*)$/.exec(
      entry,
    );
    if (!match) {
      errors.push(
        `env example contract: unsupported loadRuntimeConfig entry: ${snippet(entry)}`,
      );
      continue;
    }

    const property = match[1];
    const read = match[2];

    if (seenProperties.has(property)) {
      errors.push(
        `env example contract: duplicate loadRuntimeConfig property: ${property}`,
      );
    } else {
      seenProperties.add(property);
      properties.push(property);
    }

    if (seenReads.has(read)) {
      errors.push(
        `env example contract: duplicate loadRuntimeConfig env read: ${read}`,
      );
    } else {
      seenReads.add(read);
      reads.push(read);
    }

    if (property !== read) {
      errors.push(
        `env example contract: loadRuntimeConfig mapping mismatch: ${property} reads env.${read}`,
      );
    }
  }
}

/**
 * @param {string} leftName
 * @param {string[]} left
 * @param {string} rightName
 * @param {string[]} right
 * @param {string[]} errors
 */
function compareKeySets(leftName, left, rightName, right, errors) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  for (const key of leftSet) {
    if (!rightSet.has(key)) {
      errors.push(
        `env example contract: ${key} is in ${leftName} but missing from ${rightName}`,
      );
    }
  }

  for (const key of rightSet) {
    if (!leftSet.has(key)) {
      errors.push(
        `env example contract: ${key} is in ${rightName} but missing from ${leftName}`,
      );
    }
  }
}

/**
 * @param {string} value
 */
function snippet(value) {
  return value.replace(/\s+/g, ' ').slice(0, 120);
}

function collectRequiredKeysFromSegment(segment, keys, seen) {
  let i = 0;

  while (i < segment.length) {
    if (segment[i] === '$' && segment[i + 1] === '$') {
      i += 2;
      continue;
    }

    if (segment[i] === '$' && segment[i + 1] === '{') {
      const bodyStart = i + 2;
      const bodyEnd = findInterpolationEnd(segment, bodyStart);

      if (bodyEnd < 0) {
        i += 1;
        continue;
      }

      const body = segment.slice(bodyStart, bodyEnd);
      const key = requiredKeyFromInterpolationBody(body);

      if (key && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }

      collectRequiredKeysFromSegment(body, keys, seen);
      i = bodyEnd + 1;
      continue;
    }

    i += 1;
  }
}

function stripYamlLineComment(line) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && line[i - 1] !== '\\') {
      inDouble = !inDouble;
    } else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }

  return line;
}

function findInterpolationEnd(text, bodyStart) {
  let depth = 1;

  for (let i = bodyStart; i < text.length; i += 1) {
    if (text[i] === '{') {
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function requiredKeyFromInterpolationBody(body) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/.exec(body);
  if (!match) return null;

  const rest = match[2];
  if (rest.startsWith(':?')) return match[1];
  if (rest.startsWith(':-') || rest.startsWith(':+')) return null;
  if (rest.startsWith('?')) return match[1];

  return null;
}
