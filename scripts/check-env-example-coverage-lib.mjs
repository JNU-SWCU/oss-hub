// env 계약 삼중 불변식 판정 라이브러리.
// (1) 선언 — 키가 .env.example 에 있다
// (2) 주입 — 키가 소유 서비스 environment 에 명시 매핑돼 있다
// (3) 소비 — 코드가 그 키를 읽는다
// 세 불변식은 독립이다. 하나라도 깨지면 실패한다.
//
// Compose 정규화 모델은 호출측이 `docker compose config --format json`으로 만든다.
// 코드 키 추출은 TypeScript AST 로 한다(정규식 줄 단위 파싱 금지).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const REQUIRED_INTERPOLATION_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g;
const APPROVED_ENV_HELPERS = new Set([
  'environmentValue',
  'booleanEnvironmentValue',
]);

// CollectionAppConfig.envNames 및 유사 config 리터럴.
// error code(GITHUB_OPERATIONS_UPSTREAM 등)는 접두 필터로 제외.
const CONFIG_LITERAL_RE =
  /^(GITHUB_(APP_ORG|COLLECTION_APP_[A-Z0-9_]+|OPERATIONS_APP_[A-Z0-9_]+|OAUTH_[A-Z0-9_]+)|SUBMISSION_FILE_S3_(ENDPOINT|REGION|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|FORCE_PATH_STYLE)|SUBMISSION_FILE_CLEANUP_[A-Z0-9_]+)$/;

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const TEST_FILE_RE = /\.(spec|test)\.([cm]?[jt]sx?)$|\.test\.([cm]?js)$/;

// integration runner sentinel 은 integration spec 만 읽는다.
// `*integration*` substring 면제는 production 파일명까지 덮으므로 금지.
const INTEGRATION_SPEC_RE = /\.integration\.spec\.[cm]?[jt]sx?$/;

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isComposeRequiredDocExempt(key) {
  void key;
  // IMAGE_TAG 는 로컬 placeholder 로 .env.example 에 둔다. 면제 없음.
  return false;
}

/**
 * NODE_ENV 는 키 전역 면제다(의도적 예외).
 * Dockerfile 과 compose.local.yml 이 소유하므로 .env.example·compose
 * services.*.environment 계약 대상이 아니다.
 * 그 외 키는 경로 조건 면제만 쓴다.
 *
 * @param {string} key
 * @param {string} relPath
 */
export function isDeclarationExempt(key, relPath) {
  switch (key) {
    case 'NODE_ENV':
      return true;
    case 'DIGEST_FORCE_TO':
      return relPath.includes('/notifications/cli/');
    case 'OSS_HUB_INTEGRATION_RUNNER':
      return isIntegrationRunnerPath(relPath);
    default:
      return false;
  }
}

/**
 * @param {string} key
 * @param {string} owner
 * @param {string} relPath
 */
export function isServiceMappingExempt(key, owner, relPath) {
  void owner;
  switch (key) {
    case 'NODE_ENV':
      // apps/*/Dockerfile · compose.local.yml 소유
      return true;
    case 'IMAGE_TAG':
      // compose image: 치환 전용. 서비스 environment 매핑 대상 아님.
      return true;
    case 'DIGEST_FORCE_TO':
      return relPath.includes('/notifications/cli/');
    case 'OSS_HUB_INTEGRATION_RUNNER':
      return isIntegrationRunnerPath(relPath);
    case 'SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED':
    case 'SUBMISSION_FILE_CLEANUP_OPERATOR_ID':
      return relPath.includes('/submissions/cli/');
    case 'GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES':
    case 'GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS':
      return relPath.includes('/collection/cli/');
    default:
      return false;
  }
}

/**
 * @param {string} relPath
 */
export function isIntegrationRunnerPath(relPath) {
  return INTEGRATION_SPEC_RE.test(relPath.replaceAll('\\', '/'));
}

/**
 * @param {string} envExampleText
 * @param {string} key
 */
export function keyInEnvExample(envExampleText, key) {
  const pattern = new RegExp(
    `^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`,
    'm',
  );
  return pattern.test(envExampleText);
}

/**
 * compose.yml 원문에서 ${VAR:?} 필수 키를 순서 유지·중복 제거로 뽑는다.
 * @param {string} composeText
 * @returns {string[]}
 */
export function extractRequiredComposeKeys(composeText) {
  const keys = [];
  const seen = new Set();
  REQUIRED_INTERPOLATION_RE.lastIndex = 0;
  let match;
  while ((match = REQUIRED_INTERPOLATION_RE.exec(composeText)) !== null) {
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * docker compose config --format json 정규화 모델에서
 * services.<service>.environment 에 키가 있는지 판정한다.
 * x- 확장·anchor 는 공식 구현이 해석한 뒤의 services 만 본다.
 *
 * @param {object|null|undefined} composeConfig
 * @param {string} service
 * @param {string} key
 */
export function serviceEnvironmentMapsKey(composeConfig, service, key) {
  const environment = composeConfig?.services?.[service]?.environment;
  if (environment == null) return false;
  if (Array.isArray(environment)) {
    return environment.some((entry) => {
      if (typeof entry !== 'string') return false;
      if (entry === key) return true;
      return entry.startsWith(`${key}=`);
    });
  }
  if (typeof environment === 'object') {
    return Object.prototype.hasOwnProperty.call(environment, key);
  }
  return false;
}

/**
 * @param {string} repoRoot  typescript 를 찾을 저장소 루트
 * @returns {typeof import('typescript')}
 */
export function loadTypescript(repoRoot) {
  const packageJson = path.join(repoRoot, 'package.json');
  const require = createRequire(pathToFileURL(packageJson).href);
  const backendRoot = path.join(repoRoot, 'apps/backend');
  try {
    const tsPath = require.resolve('typescript', { paths: [backendRoot] });
    return require(tsPath);
  } catch {
    throw new Error(
      'env example contract: typescript 를 해석할 수 없습니다. 저장소 루트에서 pnpm install 을 실행하세요.',
    );
  }
}

/**
 * 한 소스 파일에서 지원 형태로 읽히는 KEY 와 지원 불가 동적 접근을 추출한다.
 *
 * 지원:
 *   - process.env.KEY
 *   - process.env['KEY'] / process.env["KEY"] / process.env[`KEY`] (치환 없는 백틱)
 *   - const { KEY, KEY: alias, KEY = 'x' } = process.env  (property key 만)
 *   - env.KEY  (ProcessEnv 파라미터 관례)
 *   - environmentValue('KEY') / booleanEnvironmentValue('KEY')
 *   - NAME_ENV = 'KEY' 상수
 *   - 'GITHUB_*' / 'SUBMISSION_FILE_*' config 리터럴(접두 필터)
 *
 * 승인 helper(environmentValue|booleanEnvironmentValue) 본문의
 * process.env[<그 함수 파라미터>] 만 동적 접근 면제. 파일 전체 면제 금지.
 *
 * @param {string} filePath
 * @param {string} sourceText
 * @param {typeof import('typescript')} ts
 */
export function extractKeysFromSource(filePath, sourceText, ts) {
  /** @type {string[]} */
  const keys = [];
  /** @type {{ line: number, expression: string }[]} */
  const unsupported = [];

  const scriptKind = scriptKindForPath(ts, filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  /**
   * 방문 중인 승인 helper 파라미터 이름 스택.
   * @type {string[]}
   */
  const helperParamStack = [];

  /**
   * @param {import('typescript').Node} node
   */
  function visit(node) {
    const helperParam = approvedHelperParamName(ts, node);
    if (helperParam) {
      helperParamStack.push(helperParam);
      ts.forEachChild(node, visit);
      helperParamStack.pop();
      return;
    }

    collectProcessEnvAccess(
      ts,
      node,
      sourceFile,
      keys,
      unsupported,
      helperParamStack,
    );
    collectEnvParamAccess(ts, node, keys);
    collectHelperCallKeys(ts, node, keys);
    collectEnvNameConstants(ts, node, keys);
    collectConfigLiterals(ts, node, keys);

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const uniqueKeys = [];
  const seen = new Set();
  for (const key of keys) {
    if (!ENV_KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    uniqueKeys.push(key);
  }

  return { keys: uniqueKeys, unsupported };
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function listScanFiles(dir) {
  /** @type {string[]} */
  const files = [];
  if (!fs.existsSync(dir)) return files;

  /** @param {string} current */
  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      if (TEST_FILE_RE.test(entry.name)) continue;
      files.push(full);
    }
  }

  walk(dir);
  return files.sort();
}

/**
 * @param {object} input
 * @param {string} input.composeText
 * @param {string} input.envExampleText
 * @param {object|null} input.composeConfig
 *   null 이면 (2) 서비스 매핑·AUTH_INITIAL_ROLES 매핑 검사를 건너뛴다.
 *   호출측이 건너뛴 사실을 stderr 에 이미 알린 뒤에만 null 을 넘긴다.
 * @param {Array<{ key: string, owner: string, relPath: string }>} input.codeHits
 * @param {{ composeConfigSkipped?: boolean }} [input.options]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function evaluateEnvContract({
  composeText,
  envExampleText,
  composeConfig,
  codeHits,
  options = {},
}) {
  /** @type {string[]} */
  const errors = [];

  const requiredKeys = extractRequiredComposeKeys(composeText);
  for (const key of requiredKeys) {
    if (isComposeRequiredDocExempt(key)) continue;
    if (!keyInEnvExample(envExampleText, key)) {
      errors.push(`env example contract: required key missing: ${key}`);
    }
  }

  if (composeConfig) {
    if (
      !serviceEnvironmentMapsKey(composeConfig, 'backend', 'AUTH_INITIAL_ROLES')
    ) {
      errors.push(
        'env example contract: backend environment must explicitly map AUTH_INITIAL_ROLES.',
      );
    }
  } else if (!options.composeConfigSkipped) {
    errors.push(
      'env example contract: compose config model is required for service mapping checks',
    );
  }

  /** @type {Map<string, Array<{ owner: string, relPath: string }>>} */
  const byKey = new Map();
  for (const hit of codeHits) {
    const list = byKey.get(hit.key) ?? [];
    list.push({ owner: hit.owner, relPath: hit.relPath });
    byKey.set(hit.key, list);
  }

  for (const [key, hits] of byKey) {
    for (const owner of ['backend', 'frontend']) {
      const ownerHits = hits.filter((hit) => hit.owner === owner);
      if (ownerHits.length === 0) continue;

      const allDeclExempt = ownerHits.every((hit) =>
        isDeclarationExempt(key, hit.relPath),
      );
      if (!allDeclExempt && !keyInEnvExample(envExampleText, key)) {
        errors.push(
          `env example contract: code reads undeclared key: ${key} (${owner})`,
        );
      }

      const mappingNeeded = ownerHits.filter(
        (hit) => !isServiceMappingExempt(key, owner, hit.relPath),
      );
      if (mappingNeeded.length === 0) continue;

      if (!composeConfig) {
        // 호출측이 composeConfigSkipped 로 명시 skip 한 경우 매핑 검사는 생략.
        // 그렇지 않으면 위에서 이미 모델 부재 오류를 넣었다.
        continue;
      }

      if (!serviceEnvironmentMapsKey(composeConfig, owner, key)) {
        const samplePath = mappingNeeded[0].relPath;
        errors.push(
          `env example contract: code key not mapped in ${owner} service environment: ${key} (from ${samplePath})`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * scan_root 아래 backend/frontend src 를 스캔해 code hits 를 만든다.
 * unsupported dynamic 이 있으면 throw (message 에 file:line 과 표현 포함).
 *
 * @param {string} scanRoot
 * @param {string} repoRoot typescript resolve 기준
 * @param {typeof import('typescript')} [ts]
 */
export function collectCodeHits(
  scanRoot,
  repoRoot,
  ts = loadTypescript(repoRoot),
) {
  /** @type {Array<{ key: string, owner: string, relPath: string }>} */
  const hits = [];
  /** @type {string[]} */
  const unsupportedMessages = [];

  /** @type {Array<{ owner: string, dir: string }>} */
  const owners = [
    { owner: 'backend', dir: path.join(scanRoot, 'apps/backend/src') },
    { owner: 'frontend', dir: path.join(scanRoot, 'apps/frontend/src') },
  ];

  for (const { owner, dir } of owners) {
    for (const filePath of listScanFiles(dir)) {
      const relPath = normalizeRelPath(scanRoot, filePath);
      const sourceText = fs.readFileSync(filePath, 'utf8');
      const { keys, unsupported } = extractKeysFromSource(
        filePath,
        sourceText,
        ts,
      );
      for (const item of unsupported) {
        unsupportedMessages.push(
          `env example contract: unsupported dynamic process.env access in ${relPath}:${item.line}: ${item.expression}`,
        );
      }
      for (const key of keys) {
        hits.push({ key, owner, relPath });
      }
    }
  }

  if (unsupportedMessages.length > 0) {
    const error = new Error(unsupportedMessages.join('\n'));
    error.name = 'UnsupportedEnvAccessError';
    /** @type {any} */ (error).messages = unsupportedMessages;
    throw error;
  }

  return hits;
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
 * @param {string} scanRoot
 * @param {string} filePath
 */
function normalizeRelPath(scanRoot, filePath) {
  const rel = path.relative(scanRoot, filePath);
  return rel.split(path.sep).join('/');
}

/**
 * @param {string} text
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {typeof import('typescript')} ts
 * @param {string} filePath
 */
function scriptKindForPath(ts, filePath) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  if (filePath.endsWith('.mjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @returns {string|null} 파라미터 이름
 */
function approvedHelperParamName(ts, node) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    const name = node.name?.text;
    if (!name || !APPROVED_ENV_HELPERS.has(name)) return null;
    return firstParamName(ts, node.parameters);
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    if (!APPROVED_ENV_HELPERS.has(node.name.text)) return null;
    const init = node.initializer;
    if (!init) return null;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return firstParamName(ts, init.parameters);
    }
  }
  if (
    (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    APPROVED_ENV_HELPERS.has(node.name.text)
  ) {
    return firstParamName(ts, node.parameters ?? []);
  }
  return null;
}

/**
 * @param {typeof import('typescript')} ts
 * @param {readonly import('typescript').ParameterDeclaration[]} parameters
 */
function firstParamName(ts, parameters) {
  const first = parameters[0];
  if (!first || !ts.isIdentifier(first.name)) return null;
  return first.name.text;
}

/**
 * process.env 접근 수집. 승인 helper 본문의 process.env[param] 만 면제.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @param {import('typescript').SourceFile} sourceFile
 * @param {string[]} keys
 * @param {{ line: number, expression: string }[]} unsupported
 * @param {string[]} helperParamStack
 */
function collectProcessEnvAccess(
  ts,
  node,
  sourceFile,
  keys,
  unsupported,
  helperParamStack,
) {
  if (
    ts.isPropertyAccessExpression(node) &&
    isProcessEnv(ts, node.expression)
  ) {
    keys.push(node.name.text);
    return;
  }

  if (ts.isElementAccessExpression(node) && isProcessEnv(ts, node.expression)) {
    const arg = node.argumentExpression;
    if (arg && isStaticStringLiteral(ts, arg)) {
      keys.push(arg.text);
      return;
    }
    // 승인 helper 본문: process.env[<param>] 만 면제
    if (arg && ts.isIdentifier(arg) && helperParamStack.includes(arg.text)) {
      return;
    }
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    unsupported.push({
      line: line + 1,
      expression: node.getText(sourceFile).replace(/\s+/g, ' '),
    });
    return;
  }

  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    isProcessEnv(ts, node.initializer) &&
    ts.isObjectBindingPattern(node.name)
  ) {
    for (const element of node.name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const keyName = bindingPropertyKey(ts, element);
      if (keyName) keys.push(keyName);
    }
  }
}

/**
 * env.KEY / env['KEY'] (ProcessEnv 파라미터 관례). 동적 env[ident] 는 무시
 * (키는 *_ENV 상수·config 리터럴 경로로 수집).
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @param {string[]} keys
 */
function collectEnvParamAccess(ts, node, keys) {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'env'
  ) {
    keys.push(node.name.text);
    return;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'env' &&
    node.argumentExpression &&
    isStaticStringLiteral(ts, node.argumentExpression)
  ) {
    keys.push(node.argumentExpression.text);
  }
}

/**
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @param {string[]} keys
 */
function collectHelperCallKeys(ts, node, keys) {
  if (!ts.isCallExpression(node)) return;
  const callee = node.expression;
  let name = null;
  if (ts.isIdentifier(callee)) name = callee.text;
  else if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name)
  ) {
    name = callee.name.text;
  }
  if (!name || !APPROVED_ENV_HELPERS.has(name)) return;
  const arg = node.arguments[0];
  if (arg && isStaticStringLiteral(ts, arg)) {
    keys.push(arg.text);
  }
}

/**
 * NAME_ENV = 'KEY'
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @param {string[]} keys
 */
function collectEnvNameConstants(ts, node, keys) {
  if (!ts.isVariableDeclaration(node)) return;
  if (!ts.isIdentifier(node.name)) return;
  if (!node.name.text.endsWith('_ENV')) return;
  if (!node.initializer || !isStaticStringLiteral(ts, node.initializer)) return;
  const value = node.initializer.text;
  if (ENV_KEY_RE.test(value)) keys.push(value);
}

/**
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @param {string[]} keys
 */
function collectConfigLiterals(ts, node, keys) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (CONFIG_LITERAL_RE.test(node.text)) {
      keys.push(node.text);
    }
  }
}

/**
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Expression} expression
 */
function unwrapExpression(ts, expression) {
  let current = expression;
  for (;;) {
    if (
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if (
      typeof ts.isSatisfiesExpression === 'function' &&
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if (
      typeof ts.isTypeAssertionExpression === 'function' &&
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    break;
  }
  return current;
}

function isProcessEnv(ts, expression) {
  const unwrapped = unwrapExpression(ts, expression);
  return (
    ts.isPropertyAccessExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === 'process' &&
    unwrapped.name.text === 'env'
  );
}

/**
 * 작은따옴표·큰따옴표·치환 없는 백틱.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Expression} node
 * @returns {node is import('typescript').StringLiteral | import('typescript').NoSubstitutionTemplateLiteral}
 */
function isStaticStringLiteral(ts, node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/**
 * BindingElement 의 env 키: propertyName ?? name (rename 시 왼쪽 키만).
 * nested binding · default 값 토큰은 키가 아니다.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').BindingElement} element
 * @returns {string|null}
 */
function bindingPropertyKey(ts, element) {
  if (element.propertyName) {
    if (ts.isIdentifier(element.propertyName)) {
      return element.propertyName.text;
    }
    if (
      ts.isStringLiteral(element.propertyName) ||
      ts.isNoSubstitutionTemplateLiteral(element.propertyName)
    ) {
      return element.propertyName.text;
    }
    // computed property name 등은 정적 키가 아님
    return null;
  }
  if (ts.isIdentifier(element.name)) {
    return element.name.text;
  }
  // nested ObjectBindingPattern / ArrayBindingPattern — 내부 이름은 env 키가 아님
  return null;
}
