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

// 승인 helper 면제는 이름만으로 주지 않는다.
// 승인 경로에서 해당 이름의 top-level 함수 선언이 정확히 하나일 때만
// 그 선언 본문의 process.env[param] 을 면제한다.
// 중첩 함수·메서드·function expression·중복 선언은 면제 대상이 아니다(fail-closed).
/** @type {ReadonlyMap<string, ReadonlySet<string>>} */
const APPROVED_ENV_HELPERS = new Map([
  [
    'environmentValue',
    new Set([
      'apps/backend/src/repositories/github-operations.config.ts',
      'apps/backend/src/submissions/submission-file-storage.config.ts',
    ]),
  ],
  [
    'booleanEnvironmentValue',
    new Set(['apps/backend/src/submissions/submission-file-storage.config.ts']),
  ],
]);
const RUNTIME_CONFIG_PATH = 'apps/backend/src/runtime-config/runtime-config.ts';

/**
 * RuntimeConfig가 코드 키의 공통 획득 지점이므로 CLI 전용 키는 이 경로에서도
 * 기존 소비 경로와 같은 선언·service mapping 면제를 적용한다.
 */
function isRuntimeConfigPath(relPath) {
  return relPath.replaceAll('\\', '/') === RUNTIME_CONFIG_PATH;
}

// CollectionAppConfig.envNames 및 유사 config 리터럴.
// error code(GITHUB_OPERATIONS_UPSTREAM 등)는 접두 필터로 제외.
const CONFIG_LITERAL_RE =
  /^(GITHUB_(APP_ORG|COLLECTION_APP_[A-Z0-9_]+|OPERATIONS_APP_[A-Z0-9_]+|OAUTH_[A-Z0-9_]+)|SUBMISSION_FILE_S3_(ENDPOINT|REGION|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|FORCE_PATH_STYLE)|SUBMISSION_FILE_CLEANUP_[A-Z0-9_]+)$/;

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const TEST_FILE_RE = /\.(spec|test)\.([cm]?[jt]sx?)$|\.test\.([cm]?js)$/;

// integration runner sentinel 은 integration spec 만 읽는다.
// `*integration*` substring 면제는 production 파일명까지 덮으므로 금지.
const INTEGRATION_SPEC_RE = /\.integration\.spec\.[cm]?[jt]sx?$/;

/**
 * IMAGE_TAG 는 compose image 치환 전용이다.
 * production compose 의 `${IMAGE_TAG:?}` 는 유지하되, 로컬 두 파일 스택
 * (compose.yml + compose.local.yml) 은 호출자 IMAGE_TAG 를 요구하지 않으므로
 * .env.example 문서화 대상이 아니다(compose 필수 문서 면제만, 코드 키 면제 아님).
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isComposeRequiredDocExempt(key) {
  return key === 'IMAGE_TAG';
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
      return (
        relPath.includes('/notifications/cli/') || isRuntimeConfigPath(relPath)
      );
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
      return (
        relPath.includes('/notifications/cli/') || isRuntimeConfigPath(relPath)
      );
    case 'OSS_HUB_INTEGRATION_RUNNER':
      return isIntegrationRunnerPath(relPath);
    case 'SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED':
    case 'SUBMISSION_FILE_CLEANUP_OPERATOR_ID':
      return (
        relPath.includes('/submissions/cli/') || isRuntimeConfigPath(relPath)
      );
    case 'GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES':
    case 'GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS':
      return (
        relPath.includes('/collection/cli/') || isRuntimeConfigPath(relPath)
      );
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
 * compose.yml 원문에서 필수 보간 키(`${VAR:?}` · `${VAR?error}`)를
 * 순서 유지·중복 제거로 뽑는다.
 * `$${...}` 이스케이프와 주석 속 토큰은 제외한다.
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
 * docker compose config --format json 정규화 모델에서
 * services.<service>.environment 에 키가 있는지 판정한다.
 * x- 확장·anchor 는 공식 구현이 해석한 뒤의 services 만 본다.
 * map 형태와 list 형태(`KEY` / `KEY=value`)를 모두 인정한다.
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
 * 승인 helper 면제는 (승인 경로, 유일한 top-level 함수 선언) 쌍으로만 적용한다.
 * 중복·중첩·메서드·function expression 은 면제하지 않고 명시 실패한다.
 *
 * @param {string} filePath
 * @param {string} sourceText
 * @param {typeof import('typescript')} ts
 * @param {{ relPath?: string }} [options]
 */
export function extractKeysFromSource(filePath, sourceText, ts, options = {}) {
  /** @type {string[]} */
  const keys = [];
  /** @type {{ line: number, expression: string }[]} */
  const unsupported = [];
  /** @type {string[]} */
  const parseErrors = [];

  const relPath = normalizePath(options.relPath ?? filePath);

  const scriptKind = scriptKindForPath(ts, filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  if (
    Array.isArray(sourceFile.parseDiagnostics) &&
    sourceFile.parseDiagnostics.length > 0
  ) {
    for (const diagnostic of sourceFile.parseDiagnostics) {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        ' ',
      );
      let location = relPath;
      if (typeof diagnostic.start === 'number') {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          diagnostic.start,
        );
        location = `${relPath}:${line + 1}`;
      }
      parseErrors.push(
        `env example contract: source parse failed in ${location}: ${message}`,
      );
    }
    return { keys: [], unsupported: [], parseErrors };
  }

  /**
   * 승인 경로의 유일한 top-level 함수 선언 노드 → 첫 파라미터 이름.
   * 중복이면 parseErrors 에 남기고 면제하지 않는다(fail-closed).
   * @type {Map<import('typescript').Node, string>}
   */
  const approvedHelperNodes = resolveApprovedHelperNodes(
    ts,
    sourceFile,
    relPath,
    parseErrors,
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
    const helperParam = approvedHelperParamName(node, approvedHelperNodes);
    if (helperParam) {
      helperParamStack.push(helperParam);
      ts.forEachChild(node, visit);
      helperParamStack.pop();
      return;
    }

    // 승인 helper 안의 중첩 함수·메서드·화살표 함수는 자기 스코프를 새로 연다.
    // 파라미터 이름을 문자열로만 비교하면 중첩 스코프가 같은 이름을 재사용할 때
    // 면제가 전파되므로, 스코프 경계에서 끊어 문서가 공표한 경계와 일치시킨다.
    if (helperParamStack.length > 0 && isNestedFunctionScope(ts, node)) {
      const saved = helperParamStack.splice(0, helperParamStack.length);
      ts.forEachChild(node, visit);
      helperParamStack.push(...saved);
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
    collectHelperCallKeys(
      ts,
      node,
      sourceFile,
      keys,
      unsupported,
      helperParamStack,
    );
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

  return { keys: uniqueKeys, unsupported, parseErrors };
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
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      const scanError = new Error(
        `env example contract: directory scan failed: ${current}: ${detail}`,
      );
      scanError.name = 'DirectoryScanError';
      throw scanError;
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
 * unsupported dynamic · parse 실패 · 순회 오류가 있으면 throw.
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
  const failureMessages = [];

  /** @type {Array<{ owner: string, dir: string }>} */
  const owners = [
    { owner: 'backend', dir: path.join(scanRoot, 'apps/backend/src') },
    { owner: 'frontend', dir: path.join(scanRoot, 'apps/frontend/src') },
  ];

  // 스캔 대상이 하나도 없으면 코드→계약 방향을 전혀 검증하지 못한 것이다.
  // 그 상태로 성공을 보고하면 "code keys declared and service-mapped"가 거짓 주장이 되므로
  // 조용히 통과시키지 않고 명시적으로 실패시킨다(모노레포 구조 변경 시 검사기 무력화 방지).
  if (!owners.some(({ dir }) => fs.existsSync(dir))) {
    const error = new Error(
      `env example contract: no scan target found under ${scanRoot}; expected apps/backend/src or apps/frontend/src`,
    );
    error.name = 'EnvContractScanError';
    /** @type {any} */ (error).messages = [error.message];
    throw error;
  }

  for (const { owner, dir } of owners) {
    let files;
    try {
      files = listScanFiles(dir);
    } catch (error) {
      failureMessages.push(
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    for (const filePath of files) {
      const relPath = normalizeRelPath(scanRoot, filePath);
      let sourceText;
      try {
        sourceText = fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : String(error ?? 'unknown');
        failureMessages.push(
          `env example contract: failed to read source file ${relPath}: ${detail}`,
        );
        continue;
      }

      const { keys, unsupported, parseErrors } = extractKeysFromSource(
        filePath,
        sourceText,
        ts,
        { relPath },
      );
      for (const message of parseErrors) {
        failureMessages.push(message);
      }
      for (const item of unsupported) {
        failureMessages.push(
          `env example contract: unsupported dynamic process.env access in ${relPath}:${item.line}: ${item.expression}`,
        );
      }
      for (const key of keys) {
        hits.push({ key, owner, relPath });
      }
    }
  }

  if (failureMessages.length > 0) {
    const error = new Error(failureMessages.join('\n'));
    error.name = 'EnvContractScanError';
    /** @type {any} */ (error).messages = failureMessages;
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
 * 테스트·문서용 승인 helper 경로 목록.
 * @returns {ReadonlyMap<string, ReadonlySet<string>>}
 */
export function approvedEnvHelperPaths() {
  return APPROVED_ENV_HELPERS;
}

/**
 * @param {string} scanRoot
 * @param {string} filePath
 */
function normalizeRelPath(scanRoot, filePath) {
  return normalizePath(path.relative(scanRoot, filePath));
}

/**
 * @param {string} value
 */
function normalizePath(value) {
  return value.split(path.sep).join('/');
}

/**
 * @param {string} text
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 한 문자열 구간에서 필수 보간 키를 수집한다. 중첩 `${...}` 도 재귀 스캔한다.
 * @param {string} segment
 * @param {string[]} keys
 * @param {Set<string>} seen
 */
function collectRequiredKeysFromSegment(segment, keys, seen) {
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === '$' && segment[i + 1] === '$') {
      // compose 이스케이프: $$ → 리터럴 $
      i += 2;
      continue;
    }
    if (ch === '$' && segment[i + 1] === '{') {
      const bodyStart = i + 2;
      const bodyEnd = findInterpolationEnd(segment, bodyStart);
      if (bodyEnd < 0) {
        i += 1;
        continue;
      }
      const body = segment.slice(bodyStart, bodyEnd);
      const requiredKey = requiredKeyFromInterpolationBody(body);
      if (requiredKey && !seen.has(requiredKey)) {
        seen.add(requiredKey);
        keys.push(requiredKey);
      }
      // 메시지/기본값 구간의 중첩 보간
      collectRequiredKeysFromSegment(body, keys, seen);
      i = bodyEnd + 1;
      continue;
    }
    i += 1;
  }
}

/**
 * 따옴표 밖의 `#` 이후를 주석으로 제거한다.
 * @param {string} line
 */
function stripYamlLineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      if (line[i - 1] === '\\') continue;
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * `${` 본문의 닫는 `}` 위치. 중첩 중괄호를 허용한다.
 * @param {string} text
 * @param {number} bodyStart
 */
function findInterpolationEnd(text, bodyStart) {
  let depth = 1;
  for (let i = bodyStart; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 보간 본문에서 필수 키 이름을 뽑는다.
 * `VAR:?msg` · `VAR?msg` 만 필수. `VAR:-` · `VAR-` · `VAR:+` · `VAR+` · `VAR` 는 제외.
 * @param {string} body
 * @returns {string|null}
 */
function requiredKeyFromInterpolationBody(body) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/.exec(body);
  if (!match) return null;
  const key = match[1];
  const rest = match[2];
  if (rest.startsWith(':?')) return key;
  if (rest.startsWith(':-') || rest.startsWith(':+')) return null;
  if (rest.startsWith('?')) return key;
  return null;
}

/**
 * @param {typeof import('typescript')} ts
 * @param {string} filePath
 */
function scriptKindForPath(ts, filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.mts')) {
    return ts.ScriptKind.MTS ?? ts.ScriptKind.TS;
  }
  if (lower.endsWith('.cts')) {
    return ts.ScriptKind.CTS ?? ts.ScriptKind.TS;
  }
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.cjs') ||
    lower.endsWith('.mjs')
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * 승인 경로에서 helper 이름별 유일한 top-level 함수 선언만 면제 대상으로 고른다.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @param {string} relPath
 * @param {string[]} parseErrors
 * @returns {Map<import('typescript').Node, string>}
 */
function resolveApprovedHelperNodes(ts, sourceFile, relPath, parseErrors) {
  /** @type {Map<import('typescript').Node, string>} */
  const approved = new Map();
  const normalizedRel = normalizePath(relPath);

  for (const [helperName, paths] of APPROVED_ENV_HELPERS) {
    if (!paths.has(normalizedRel)) continue;

    const topLevel = collectTopLevelBindingsNamed(ts, sourceFile, helperName);
    const functionDecls = topLevel.filter(
      (binding) => binding.kind === 'function-declaration',
    );

    if (topLevel.length === 0) {
      continue;
    }

    if (topLevel.length !== 1 || functionDecls.length !== 1) {
      const locations = topLevel
        .map((binding) => `${relPath}:${binding.line} (${binding.reason})`)
        .join(', ');
      parseErrors.push(
        `env example contract: approved helper ${helperName} must be exactly one top-level function declaration in ${relPath}; found ${topLevel.length} top-level binding(s): ${locations}`,
      );
      continue;
    }

    const only = functionDecls[0];
    const param = firstParamName(ts, only.node.parameters);
    if (!param) {
      parseErrors.push(
        `env example contract: approved helper ${helperName} at ${relPath}:${only.line} has no identifiable first parameter name`,
      );
      continue;
    }
    approved.set(only.node, param);
  }

  return approved;
}

/**
 * 소스 파일 top-level 에서 helper 이름과 같은 바인딩을 수집한다.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @param {string} name
 * @returns {Array<{ node: import('typescript').Node, kind: string, line: number, reason: string }>}
 */
function collectTopLevelBindingsNamed(ts, sourceFile, name) {
  /** @type {Array<{ node: import('typescript').Node, kind: string, line: number, reason: string }>} */
  const bindings = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      bindings.push({
        node: statement,
        kind: 'function-declaration',
        line: lineOf(ts, sourceFile, statement),
        reason: 'top-level function declaration',
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (declaration.name.text !== name) continue;
        const init = declaration.initializer;
        let kind = 'variable';
        let reason = 'top-level variable binding';
        if (init && ts.isArrowFunction(init)) {
          kind = 'arrow-function';
          reason = 'top-level arrow function binding';
        } else if (init && ts.isFunctionExpression(init)) {
          kind = 'function-expression';
          reason = 'top-level function expression binding';
        }
        bindings.push({
          node: declaration,
          kind,
          line: lineOf(ts, sourceFile, declaration),
          reason,
        });
      }
    }
  }

  return bindings;
}

/**
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @param {import('typescript').Node} node
 */
function lineOf(ts, sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return line + 1;
}

/**
 * 유일한 승인 top-level 함수 선언 노드일 때만 파라미터 이름을 반환한다.
 * @param {import('typescript').Node} node
 * @param {Map<import('typescript').Node, string>} approvedHelperNodes
 * @returns {string|null}
 */
function approvedHelperParamName(node, approvedHelperNodes) {
  return approvedHelperNodes.get(node) ?? null;
}

/**
 * 자기 파라미터 스코프를 새로 여는 중첩 함수형 노드인지 판정한다.
 * 승인 helper 자신은 호출부에서 먼저 처리되므로 여기 도달하지 않는다.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @returns {boolean}
 */
function isNestedFunctionScope(ts, node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/**
 * @param {string} name
 */
function isApprovedHelperName(name) {
  return APPROVED_ENV_HELPERS.has(name);
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
 * 승인 helper 이름 호출: 첫 인자가 정적 리터럴이면 키 수집, 아니면 명시 실패.
 * 승인 helper 본문에서 다른 승인 helper 로 파라미터를 넘기는 위임 호출
 * (booleanEnvironmentValue → environmentValue(name)) 은 허용한다.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @param {import('typescript').SourceFile} sourceFile
 * @param {string[]} keys
 * @param {{ line: number, expression: string }[]} unsupported
 * @param {string[]} helperParamStack
 */
function collectHelperCallKeys(
  ts,
  node,
  sourceFile,
  keys,
  unsupported,
  helperParamStack,
) {
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
  if (!name || !isApprovedHelperName(name)) return;

  const arg = node.arguments[0];
  if (arg && isStaticStringLiteral(ts, arg)) {
    keys.push(arg.text);
    return;
  }
  // 승인 helper 본문 안에서 파라미터를 그대로 넘기는 위임은 동적 호출이 아니다.
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
