import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildSyntheticEnvFile,
  collectCodeHits,
  evaluateEnvContract,
  extractKeysFromSource,
  extractRequiredComposeKeys,
  isDeclarationExempt,
  isIntegrationRunnerPath,
  isServiceMappingExempt,
  keyInEnvExample,
  listScanFiles,
  loadTypescript,
  serviceEnvironmentMapsKey,
} from './check-env-example-coverage-lib.mjs';
import { parseArguments, runCheck } from './check-env-example-coverage.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const ts = loadTypescript(REPO_ROOT);

const BASE_ENV_ALL = `DATABASE_URL=value
GITHUB_OPERATIONS_APP_ID=
GITHUB_OPERATIONS_APP_PRIVATE_KEY=
COLLECTION_CRON_EXPRESSION=
PORT=
`;

const BASE_COMPOSE_ALL = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      GITHUB_OPERATIONS_APP_ID: \${GITHUB_OPERATIONS_APP_ID:?required}
      GITHUB_OPERATIONS_APP_PRIVATE_KEY: \${GITHUB_OPERATIONS_APP_PRIVATE_KEY:?required}
      COLLECTION_CRON_EXPRESSION: \${COLLECTION_CRON_EXPRESSION:-}
      PORT: \${PORT:-4000}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;

const OPS_HELPER = `function environmentValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}
export function loadOps() {
  return {
    id: environmentValue('GITHUB_OPERATIONS_APP_ID'),
    key: environmentValue('GITHUB_OPERATIONS_APP_PRIVATE_KEY'),
  };
}
`;

const SCHEDULER = `export const cron = process.env.COLLECTION_CRON_EXPRESSION?.trim() || '0 0 * * * *';
export const port = Number.parseInt(process.env.PORT ?? '4000', 10);
`;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-contract-test-'));
}

/**
 * @param {string} root
 * @param {Record<string, string>} files
 */
function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

/**
 * @param {string} composeText
 * @param {string[]} requiredKeys
 */
function composeConfigFromText(
  composeText,
  requiredKeys = extractRequiredComposeKeys(composeText),
) {
  const tmp = makeTempDir();
  try {
    const composePath = path.join(tmp, 'compose.yml');
    const envPath = path.join(tmp, 'synthetic.env');
    fs.writeFileSync(composePath, composeText, 'utf8');
    fs.writeFileSync(envPath, buildSyntheticEnvFile(requiredKeys), 'utf8');
    const stdout = execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        envPath,
        '-f',
        'compose.yml',
        'config',
        '--format',
        'json',
      ],
      { cwd: tmp, encoding: 'utf8', timeout: 60_000 },
    );
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * @param {string} scanRoot
 * @param {string} composeText
 * @param {string} envText
 * @param {{ skipDocker?: boolean }} [options]
 */
function evaluateFixture(scanRoot, composeText, envText, options = {}) {
  const codeHits = collectCodeHits(scanRoot, REPO_ROOT, ts);
  const composeConfig = options.skipDocker
    ? null
    : composeConfigFromText(composeText);
  return evaluateEnvContract({
    composeText,
    envExampleText: envText,
    composeConfig,
    codeHits,
    options: { composeConfigSkipped: Boolean(options.skipDocker) },
  });
}

/**
 * @param {string} source
 * @param {string} [fileName]
 */
function extract(source, fileName = 'sample.ts') {
  return extractKeysFromSource(fileName, source, ts);
}

// --- 순수 함수: 키 추출 AST ---

test('process.env.KEY 와 대괄호 리터럴·백틱 리터럴을 수집한다', () => {
  const { keys, unsupported } = extract(`
    export const a = process.env.ALPHA_KEY;
    export const b = process.env['BETA_KEY'];
    export const c = process.env["GAMMA_KEY"];
    export const d = process.env[\`DELTA_KEY\`];
  `);
  assert.deepEqual(keys.sort(), [
    'ALPHA_KEY',
    'BETA_KEY',
    'DELTA_KEY',
    'GAMMA_KEY',
  ]);
  assert.equal(unsupported.length, 0);
});

test('여러 줄 구조 분해에서 property key 만 수집한다', () => {
  const { keys, unsupported } = extract(`
    const {
      UNDECLARED_MULTILINE,
    } = process.env;
    export const v = UNDECLARED_MULTILINE;
  `);
  assert.deepEqual(keys, ['UNDECLARED_MULTILINE']);
  assert.equal(unsupported.length, 0);
});

test('rename { KEY: ALIAS } 는 KEY 만 수집하고 ALIAS 는 수집하지 않는다', () => {
  const { keys } = extract(`
    const { REAL_ENV_KEY: localAlias } = process.env;
    export const v = localAlias;
  `);
  assert.deepEqual(keys, ['REAL_ENV_KEY']);
  assert.ok(!keys.includes('localAlias'));
  assert.ok(!keys.includes('LOCALALIAS'));
});

test("default { KEY = 'PROD' } 는 KEY 만 수집하고 PROD 는 수집하지 않는다", () => {
  const { keys } = extract(`
    const { REAL_ENV_KEY = 'PROD' } = process.env;
    export const v = REAL_ENV_KEY;
  `);
  assert.deepEqual(keys, ['REAL_ENV_KEY']);
  assert.ok(!keys.includes('PROD'));
});

test('nested destructuring 내부 binding 이름은 키가 아니다', () => {
  const { keys } = extract(`
    const { OUTER_KEY: { INNER_NAME } } = process.env as any;
    export const v = INNER_NAME;
  `);
  assert.deepEqual(keys, ['OUTER_KEY']);
  assert.ok(!keys.includes('INNER_NAME'));
});

test('주석 처리된 process.env.KEY 와 동적 접근은 무시한다', () => {
  const { keys, unsupported } = extract(`
    // export const v = process.env.COMMENTED_KEY;
    /* process.env.BLOCK_COMMENT_KEY */
    // process.env[dynamicVar]
    export const ok = 1;
  `);
  assert.deepEqual(keys, []);
  assert.equal(unsupported.length, 0);
});

test('승인 helper 본문의 process.env[name] 은 면제하고 호출 인자는 수집한다', () => {
  const { keys, unsupported } = extract(OPS_HELPER);
  assert.deepEqual(keys.sort(), [
    'GITHUB_OPERATIONS_APP_ID',
    'GITHUB_OPERATIONS_APP_PRIVATE_KEY',
  ]);
  assert.equal(unsupported.length, 0);
});

test('같은 파일의 무관한 process.env[someVar] 는 unsupported 로 실패한다', () => {
  const { keys, unsupported } = extract(`
    function environmentValue(name: string): string | null {
      const value = process.env[name]?.trim();
      return value && value.length > 0 ? value : null;
    }
    export function load() {
      return environmentValue('DECLARED_KEY');
    }
    export const bad = process.env[someVariable];
  `);
  assert.deepEqual(keys, ['DECLARED_KEY']);
  assert.equal(unsupported.length, 1);
  assert.match(unsupported[0].expression, /process\.env\[someVariable\]/);
  assert.ok(unsupported[0].line > 0);
});

test('env.KEY · *_ENV 상수 · config 리터럴을 수집한다', () => {
  const { keys } = extract(`
    const PUBLIC_ALIASES_ENV = 'GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES';
    export function read(env: NodeJS.ProcessEnv) {
      return env.TEAM_JOIN_CODE_SECRET;
    }
    export const names = {
      appId: 'GITHUB_COLLECTION_APP_ID',
      bucket: 'SUBMISSION_FILE_S3_BUCKET',
      noise: 'GITHUB_OPERATIONS_UPSTREAM',
    };
    void PUBLIC_ALIASES_ENV;
  `);
  assert.ok(keys.includes('TEAM_JOIN_CODE_SECRET'));
  assert.ok(keys.includes('GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES'));
  assert.ok(keys.includes('GITHUB_COLLECTION_APP_ID'));
  assert.ok(keys.includes('SUBMISSION_FILE_S3_BUCKET'));
  assert.ok(!keys.includes('GITHUB_OPERATIONS_UPSTREAM'));
});

// --- compose 정규화 모델 ---

test('x- 확장 아래 가짜 backend.environment 는 서비스 매핑으로 인정하지 않는다', () => {
  const composeText = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
x-probe:
  backend:
    environment:
      FAKE_KEY: \${FAKE_KEY:-}
`;
  const config = composeConfigFromText(composeText);
  assert.equal(
    serviceEnvironmentMapsKey(config, 'backend', 'DATABASE_URL'),
    true,
  );
  assert.equal(serviceEnvironmentMapsKey(config, 'backend', 'FAKE_KEY'), false);
  assert.ok(config['x-probe']);
});

test('anchor merge 로 services.backend 에 들어온 키는 매핑으로 인정한다', () => {
  const composeText = `x-backend-env: &backend-env
  DATABASE_URL: \${DATABASE_URL:?required}
  AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
  MAPPED_VIA_ANCHOR: \${MAPPED_VIA_ANCHOR:-}
services:
  backend:
    image: alpine
    environment:
      <<: *backend-env
`;
  const config = composeConfigFromText(composeText);
  assert.equal(
    serviceEnvironmentMapsKey(config, 'backend', 'MAPPED_VIA_ANCHOR'),
    true,
  );
});

test('extractRequiredComposeKeys 는 ${VAR:?} 만 순서 유지로 뽑는다', () => {
  const keys = extractRequiredComposeKeys(`
    image: app:\${IMAGE_TAG:?required}
    environment:
      A: \${A:?x}
      B: \${B:-y}
      A_AGAIN: \${A:?x}
  `);
  assert.deepEqual(keys, ['IMAGE_TAG', 'A']);
});

// --- 면제 범위 ---

test('OSS_HUB_INTEGRATION_RUNNER 면제는 integration spec 경로만 허용한다', () => {
  assert.equal(
    isIntegrationRunnerPath(
      'apps/backend/src/auth/auth.repository.integration.spec.ts',
    ),
    true,
  );
  assert.equal(
    isDeclarationExempt(
      'OSS_HUB_INTEGRATION_RUNNER',
      'apps/backend/src/auth/auth.repository.integration.spec.ts',
    ),
    true,
  );
  assert.equal(
    isDeclarationExempt(
      'OSS_HUB_INTEGRATION_RUNNER',
      'apps/backend/src/testing/integration-runner.ts',
    ),
    false,
  );
  assert.equal(
    isDeclarationExempt(
      'OSS_HUB_INTEGRATION_RUNNER',
      'apps/backend/src/production-integration-helper.ts',
    ),
    false,
  );
  assert.equal(
    isServiceMappingExempt(
      'OSS_HUB_INTEGRATION_RUNNER',
      'backend',
      'apps/backend/src/production-integration-helper.ts',
    ),
    false,
  );
});

test('NODE_ENV 는 키 전역 면제(Dockerfile·compose.local.yml 소유 의도적 예외)이다', () => {
  assert.equal(
    isDeclarationExempt('NODE_ENV', 'apps/backend/src/main.ts'),
    true,
  );
  assert.equal(
    isServiceMappingExempt('NODE_ENV', 'backend', 'apps/backend/src/main.ts'),
    true,
  );
});

// --- 계약 평가 fixture (기존 의도 이식) ---

test('필수 키가 모두 있으면 성공', () => {
  const root = makeTempDir();
  try {
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      SUBMISSION_FILE_S3_BUCKET: \${SUBMISSION_FILE_S3_BUCKET:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const env = 'DATABASE_URL=value\nSUBMISSION_FILE_S3_BUCKET=value\n';
    writeTree(root, {});
    const result = evaluateFixture(root, compose, env);
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('숫자를 포함한 S3 필수 키 누락이면 실패', () => {
  const root = makeTempDir();
  try {
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      SUBMISSION_FILE_S3_BUCKET: \${SUBMISSION_FILE_S3_BUCKET:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('required key missing: SUBMISSION_FILE_S3_BUCKET'),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AUTH_INITIAL_ROLES 명시 매핑 누락이면 실패', () => {
  const root = makeTempDir();
  try {
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('AUTH_INITIAL_ROLES')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F7: 코드 키가 .env.example 에 없으면 undeclared 로 실패', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/repositories/ops.ts': OPS_HELPER,
      'apps/backend/src/collection/scheduler.ts': SCHEDULER,
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      GITHUB_OPERATIONS_APP_ID: \${GITHUB_OPERATIONS_APP_ID:-}
      GITHUB_OPERATIONS_APP_PRIVATE_KEY: \${GITHUB_OPERATIONS_APP_PRIVATE_KEY:-}
      COLLECTION_CRON_EXPRESSION: \${COLLECTION_CRON_EXPRESSION:-}
      PORT: \${PORT:-4000}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes('code reads undeclared key:')),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function f6Missing(missingKey) {
  const root = makeTempDir();
  writeTree(root, {
    'apps/backend/src/repositories/ops.ts': OPS_HELPER,
    'apps/backend/src/collection/scheduler.ts': SCHEDULER,
  });
  const compose = BASE_COMPOSE_ALL.split('\n')
    .filter((line) => !line.startsWith(`      ${missingKey}:`))
    .join('\n');
  return { root, compose };
}

for (const missingKey of [
  'GITHUB_OPERATIONS_APP_ID',
  'GITHUB_OPERATIONS_APP_PRIVATE_KEY',
  'COLLECTION_CRON_EXPRESSION',
  'PORT',
]) {
  test(`F6: ${missingKey} 가 .env.example 에 있어도 backend environment 매핑 없으면 실패`, () => {
    const { root, compose } = f6Missing(missingKey);
    try {
      const result = evaluateFixture(root, compose, BASE_ENV_ALL);
      assert.equal(result.ok, false);
      assert.ok(
        result.errors.some((e) =>
          e.includes(
            `code key not mapped in backend service environment: ${missingKey}`,
          ),
        ),
        result.errors.join('\n'),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('F6·F7 키를 선언하고 backend environment 에 매핑하면 성공', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/repositories/ops.ts': OPS_HELPER,
      'apps/backend/src/collection/scheduler.ts': SCHEDULER,
    });
    const result = evaluateFixture(root, BASE_COMPOSE_ALL, BASE_ENV_ALL);
    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('F6: 다른 서비스 environment 의 키만으로는 backend 매핑 불충족', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/repositories/ops.ts': OPS_HELPER,
      'apps/backend/src/collection/scheduler.ts': SCHEDULER,
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      COLLECTION_CRON_EXPRESSION: \${COLLECTION_CRON_EXPRESSION:-}
      PORT: \${PORT:-4000}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
  other:
    image: alpine
    environment:
      GITHUB_OPERATIONS_APP_ID: \${GITHUB_OPERATIONS_APP_ID:?required}
      GITHUB_OPERATIONS_APP_PRIVATE_KEY: \${GITHUB_OPERATIONS_APP_PRIVATE_KEY:?required}
`;
    const env = `${BASE_ENV_ALL}IMAGE_TAG=local\n`;
    const result = evaluateFixture(root, compose, env);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes(
          'code key not mapped in backend service environment: GITHUB_OPERATIONS_APP_ID',
        ),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('x-probe spoof: 선언만 있고 진짜 services.backend 매핑이 없으면 실패', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/app.ts': 'export const fake = process.env.FAKE_KEY;\n',
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
x-probe:
  backend:
    environment:
      FAKE_KEY: \${FAKE_KEY:-}
`;
    const result = evaluateFixture(
      root,
      compose,
      'DATABASE_URL=value\nFAKE_KEY=value\n',
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes(
          'code key not mapped in backend service environment: FAKE_KEY',
        ),
      ),
      result.errors.join('\n'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('anchor merge positive: 정규화 후 실제 매핑이면 통과', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/app.ts':
        'export const value = process.env.MAPPED_VIA_ANCHOR;\n',
    });
    const compose = `x-backend-env: &backend-env
  DATABASE_URL: \${DATABASE_URL:?required}
  AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
  MAPPED_VIA_ANCHOR: \${MAPPED_VIA_ANCHOR:-}
services:
  backend:
    image: alpine
    environment:
      <<: *backend-env
`;
    const result = evaluateFixture(
      root,
      compose,
      'DATABASE_URL=value\nMAPPED_VIA_ANCHOR=\n',
    );
    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('경로별 면제: NODE_ENV·notifications/cli DIGEST_FORCE_TO', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/runtime.ts':
        'export const nodeEnv = process.env.NODE_ENV;\n',
      'apps/backend/src/notifications/cli/send-digest.ts':
        'export const forceTo = process.env.DIGEST_FORCE_TO?.trim();\n',
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(
      root,
      compose,
      'DATABASE_URL=value\nIMAGE_TAG=local\n',
    );
    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('DIGEST_FORCE_TO 가 CLI 경로 밖이면 계약 검사 실패', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/runtime.ts':
        'export const forceTo = process.env.DIGEST_FORCE_TO;\n',
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('DIGEST_FORCE_TO')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('integration 면제 경계 밖 production 파일명은 실패한다', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/production-integration-helper.ts':
        'export const runner = process.env.OSS_HUB_INTEGRATION_RUNNER;\n',
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes('OSS_HUB_INTEGRATION_RUNNER')),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('IMAGE_TAG 가 compose 필수면 .env.example 문서화 필요', () => {
  const root = makeTempDir();
  try {
    const compose = `services:
  backend:
    image: app:\${IMAGE_TAG:?IMAGE_TAG is required}
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const missing = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(missing.ok, false);
    assert.ok(
      missing.errors.some((e) => e.includes('required key missing: IMAGE_TAG')),
    );
    const ok = evaluateFixture(
      root,
      compose,
      'DATABASE_URL=value\nIMAGE_TAG=local\n',
    );
    assert.equal(ok.ok, true, ok.ok ? '' : ok.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('테스트 전용(*.spec.ts) 키는 계약 검사에서 제외', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/thing.spec.ts': `
process.env.ONLY_IN_SPEC_KEY = 'x';
export const v = process.env.ONLY_IN_SPEC_KEY;
`,
    });
    const files = listScanFiles(path.join(root, 'apps/backend/src'));
    assert.equal(files.length, 0);
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('대괄호 리터럴 미선언 키를 검출한다', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/bracket.ts':
        "export const value = process.env['UNDECLARED_BRACKET_KEY'];\n",
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('code reads undeclared key: UNDECLARED_BRACKET_KEY'),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('const { KEY } = process.env 구조 분해를 검출한다', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/destruct.ts': `
const { UNDECLARED_DESTRUCT_KEY } = process.env;
export const value = UNDECLARED_DESTRUCT_KEY;
`,
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('code reads undeclared key: UNDECLARED_DESTRUCT_KEY'),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('해석 불가 동적 process.env[var] 는 collectCodeHits 가 명시 실패', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/dynamic.ts':
        'export const value = process.env[someVariable];\n',
    });
    assert.throws(
      () => collectCodeHits(root, REPO_ROOT, ts),
      (error) => {
        assert.match(
          String(error.message),
          /unsupported dynamic process\.env access/,
        );
        assert.match(String(error.message), /dynamic\.ts:\d+/);
        assert.match(String(error.message), /process\.env\[someVariable\]/);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('environmentValue helper 의 process.env[name] 은 동적 접근 실패가 아님', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/repositories/ops.ts': OPS_HELPER,
    });
    const result = evaluateFixture(root, BASE_COMPOSE_ALL, BASE_ENV_ALL);
    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('여러 줄 구조 분해 미선언 키를 검출한다', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/multi.ts': `
const {
  UNDECLARED_MULTILINE,
} = process.env;
export const v = UNDECLARED_MULTILINE;
`,
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('code reads undeclared key: UNDECLARED_MULTILINE'),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('주석 처리된 키는 계약 위반으로 잡히지 않는다', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/commented.ts': `
// export const v = process.env.COMMENTED_KEY;
// process.env[dynamicVar]
export const ok = 1;
`,
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('백틱 리터럴 미선언 키를 정상 수집해 undeclared 로 실패한다', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'apps/backend/src/bt.ts':
        'export const v = process.env[`BACKTICK_KEY`];\n',
    });
    const compose = `services:
  backend:
    image: alpine
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
`;
    const result = evaluateFixture(root, compose, 'DATABASE_URL=value\n');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('code reads undeclared key: BACKTICK_KEY'),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('같은 파일 무관 동적 접근은 runCheck 가 non-zero', () => {
  const root = makeTempDir();
  try {
    writeTree(root, {
      'compose.yml': BASE_COMPOSE_ALL,
      '.env.example': `${BASE_ENV_ALL}DECLARED_KEY=\n`,
      'apps/backend/src/helper.ts': `
function environmentValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}
export function load() {
  return environmentValue('GITHUB_OPERATIONS_APP_ID');
}
export const bad = process.env[someVariable];
`,
    });
    const stderrChunks = [];
    const stdoutChunks = [];
    const code = runCheck(
      {
        help: false,
        requireDocker: true,
        composeFile: path.join(root, 'compose.yml'),
        envExample: path.join(root, '.env.example'),
        scanRoot: root,
      },
      {
        repoRoot: REPO_ROOT,
        stdout: { write: (s) => stdoutChunks.push(s) },
        stderr: { write: (s) => stderrChunks.push(s) },
      },
    );
    assert.equal(code, 1);
    const stderr = stderrChunks.join('');
    assert.match(stderr, /unsupported dynamic process\.env access/);
    assert.match(stderr, /someVariable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keyInEnvExample 은 export 접두와 공백을 허용한다', () => {
  assert.equal(keyInEnvExample('export FOO=bar\n', 'FOO'), true);
  assert.equal(keyInEnvExample('  FOO = bar\n', 'FOO'), true);
  assert.equal(keyInEnvExample('FOOO=bar\n', 'FOO'), false);
});

test('parseArguments 는 --require-docker 와 positional 을 분리한다', () => {
  const parsed = parseArguments(['c.yml', 'e.env', 'scan', '--require-docker']);
  assert.equal(parsed.requireDocker, true);
  assert.equal(parsed.composeFile, 'c.yml');
  assert.equal(parsed.envExample, 'e.env');
  assert.equal(parsed.scanRoot, 'scan');
});

test('저장소 실제 compose·코드 계약은 runCheck exit 0', () => {
  const stderrChunks = [];
  const stdoutChunks = [];
  const code = runCheck(
    {
      help: false,
      requireDocker: true,
      composeFile: path.join(REPO_ROOT, 'compose.yml'),
      envExample: path.join(REPO_ROOT, '.env.example'),
      scanRoot: REPO_ROOT,
    },
    {
      repoRoot: REPO_ROOT,
      stdout: { write: (s) => stdoutChunks.push(s) },
      stderr: { write: (s) => stderrChunks.push(s) },
    },
  );
  assert.equal(
    code,
    0,
    `stderr=${stderrChunks.join('')}\nstdout=${stdoutChunks.join('')}`,
  );
  assert.match(stdoutChunks.join(''), /env example contract: ok/);
});
