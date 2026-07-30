// 집합 기반 env 계약의 fixture 회귀 테스트.
// compose 선언·runtime manifest/loader 일치·backend 주입·면제 경계를 검증한다.
// process.env 문법·helper scope·소스 확장자 검사는 ESLint 테스트가 소유한다.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ENV_CONTRACT_EXEMPTIONS,
  buildSyntheticEnvFile,
  evaluateEnvContract,
  extractEnvExampleKeys,
  extractRequiredComposeKeys,
  extractRuntimeConfigContract,
  serviceEnvironmentMapsKey,
} from './check-env-example-coverage-lib.mjs';
import { parseArguments } from './check-env-example-coverage.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const RUNTIME_CONFIG_PATH = 'apps/backend/src/runtime-config/runtime-config.ts';

const BASE_RUNTIME_KEYS = [
  'AUTH_INITIAL_ROLES',
  'GITHUB_OPERATIONS_APP_ID',
  'GITHUB_OPERATIONS_APP_PRIVATE_KEY',
  'COLLECTION_CRON_EXPRESSION',
  'PORT',
];

const BASE_ENV = `DATABASE_URL=postgresql://synthetic
AUTH_INITIAL_ROLES=
GITHUB_OPERATIONS_APP_ID=
GITHUB_OPERATIONS_APP_PRIVATE_KEY=
COLLECTION_CRON_EXPRESSION=
PORT=
`;

const BASE_COMPOSE = `services:
  backend:
    image: busybox:latest
    environment:
      DATABASE_URL: \${DATABASE_URL:?required}
      AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
      GITHUB_OPERATIONS_APP_ID: \${GITHUB_OPERATIONS_APP_ID:-}
      GITHUB_OPERATIONS_APP_PRIVATE_KEY: \${GITHUB_OPERATIONS_APP_PRIVATE_KEY:-}
      COLLECTION_CRON_EXPRESSION: \${COLLECTION_CRON_EXPRESSION:-}
      PORT: \${PORT:-4000}
`;

const REPRESENTATIVE_MAPPING_KEYS = [
  'GITHUB_OPERATIONS_APP_ID',
  'GITHUB_OPERATIONS_APP_PRIVATE_KEY',
  'COLLECTION_CRON_EXPRESSION',
  'PORT',
];

/**
 * @param {string[]} manifestKeys
 * @param {Array<[string, string]>} [mappings]
 * @param {string[]} [extraEntries]
 */
function runtimeConfigSource(
  manifestKeys,
  mappings = manifestKeys.map((key) => [key, key]),
  extraEntries = [],
) {
  const manifest = manifestKeys.map((key) => `  '${key}',`).join('\n');
  const properties = [
    ...mappings.map(([property, read]) => `    ${property}: env.${read},`),
    ...extraEntries.map((entry) => `    ${entry},`),
  ].join('\n');

  return `export const RUNTIME_CONFIG_KEYS = [
${manifest}
] as const;

export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[number];
export type RuntimeConfig = Readonly<
  Record<RuntimeConfigKey, string | undefined>
>;

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  return Object.freeze({
${properties}
  });
}
`;
}

const BASE_RUNTIME = runtimeConfigSource(BASE_RUNTIME_KEYS);

/**
 * @param {string[]} [backendKeys]
 * @param {Record<string, object>} [otherServices]
 */
function composeModel(backendKeys = BASE_RUNTIME_KEYS, otherServices = {}) {
  return {
    services: {
      backend: {
        environment: Object.fromEntries(
          backendKeys.map((key) => [key, 'synthetic']),
        ),
      },
      ...otherServices,
    },
  };
}

/**
 * @param {{
 *   composeText?: string,
 *   envText?: string,
 *   runtimeText?: string,
 *   composeConfig?: object|null,
 *   composeConfigSkipped?: boolean
 * }} [fixture]
 */
function evaluateFixture(fixture = {}) {
  return evaluateEnvContract({
    composeText: fixture.composeText ?? BASE_COMPOSE,
    envExampleText: fixture.envText ?? BASE_ENV,
    runtimeConfigText: fixture.runtimeText ?? BASE_RUNTIME,
    composeConfig:
      fixture.composeConfig === undefined
        ? composeModel()
        : fixture.composeConfig,
    options: {
      composeConfigSkipped: fixture.composeConfigSkipped ?? false,
    },
  });
}

/**
 * @param {{ ok: true }|{ ok: false, errors: string[] }} result
 */
function messages(result) {
  return result.ok ? [] : result.errors;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-contract-test-'));
}

/**
 * @param {string} root
 * @param {Record<string, string>} files
 */
function writeTree(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
}

/**
 * @param {string} root
 */
function writeContractTree(root) {
  writeTree(root, {
    'compose.yml': BASE_COMPOSE,
    '.env.example': BASE_ENV,
    [RUNTIME_CONFIG_PATH]: BASE_RUNTIME,
  });
}

/**
 * @param {string} composeText
 */
function composeConfigFromText(composeText) {
  const root = makeTempDir();

  try {
    fs.writeFileSync(path.join(root, 'compose.yml'), composeText, 'utf8');
    fs.writeFileSync(
      path.join(root, 'synthetic.env'),
      buildSyntheticEnvFile(extractRequiredComposeKeys(composeText)),
      'utf8',
    );

    const stdout = execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        'synthetic.env',
        '-f',
        'compose.yml',
        'config',
        '--format',
        'json',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    return JSON.parse(stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function dockerComposeAvailable() {
  try {
    execFileSync('docker', ['compose', 'version'], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

const DOCKER_COMPOSE_AVAILABLE = dockerComposeAvailable();

function makeShOnlyPath() {
  const root = makeTempDir();
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync('/bin/sh', path.join(bin, 'sh'));
  return { root, bin };
}

/**
 * @param {string} root
 * @param {{ requireDocker?: boolean, ci?: string }} [options]
 */
function runEntry(root, options = {}) {
  const args = [
    path.join(REPO_ROOT, 'scripts/check-env-example-coverage.mjs'),
    path.join(root, 'compose.yml'),
    path.join(root, '.env.example'),
    root,
  ];

  if (options.requireDocker) args.push('--require-docker');

  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      CI: options.ci ?? 'false',
      OSS_HUB_ENV_CONTRACT_REQUIRE_DOCKER: '',
      PATH: options.path ?? process.env.PATH,
    },
  });
}

test('required compose ?·:?를 추출하고 선택 보간·주석·$$를 제외한다', () => {
  const keys = extractRequiredComposeKeys(`
A: \${A:?required}
C: \${C?required}
OPTIONAL_1: \${OPTIONAL_1:-fallback}
OPTIONAL_2: \${OPTIONAL_2-default}
PLAIN: \${PLAIN}
ESCAPED: $\${ESCAPED:?ignored}
ODD_DOLLARS: $$\${ODD_DOLLARS?required}
# COMMENTED: \${COMMENTED:?ignored}
NESTED: \${OUTER:?\${INNER?required}}
`);

  assert.deepEqual(keys, ['A', 'C', 'ODD_DOLLARS', 'OUTER', 'INNER']);
});

test('env 목록은 export·공백·CRLF를 허용하고 최초 순서로 dedupe한다', () => {
  assert.deepEqual(
    extractEnvExampleKeys(
      '\uFEFF# prose\r\nexport FOO=one\r\n  BAR = two\r\nFOO=duplicate\r\nFOOO=three\r\n',
    ),
    ['FOO', 'BAR', 'FOOO'],
  );
});

test('유사 env key는 runtime 선언을 충족하지 않는다', () => {
  const runtimeText = runtimeConfigSource(['FOO']);
  const result = evaluateFixture({
    composeText: 'services: {}\n',
    envText: 'FOOO=value\n',
    runtimeText,
    composeConfig: composeModel(['AUTH_INITIAL_ROLES', 'FOO']),
  });

  assert.equal(result.ok, false);
  assert.ok(
    messages(result).some((message) =>
      message.includes('runtime key missing from .env.example: FOO'),
    ),
  );
});

test('manifest·loader property·env read가 일치하면 성공한다', () => {
  const result = evaluateFixture();
  assert.equal(result.ok, true, messages(result).join('\n'));
});

test('runtime parser는 주석과 문자열 속 가짜 선언을 세지 않는다', () => {
  const source =
    BASE_RUNTIME.replace("  'PORT',", "  // 마지막 runtime key\n  'PORT',") +
    '\nconst fake = `\n' +
    "export const RUNTIME_CONFIG_KEYS = ['FAKE'] as const;\n" +
    '`;\n';

  const contract = extractRuntimeConfigContract(source);

  assert.deepEqual(contract.errors, []);
  assert.deepEqual(contract.manifestKeys, BASE_RUNTIME_KEYS);
  assert.deepEqual(contract.loaderPropertyKeys, BASE_RUNTIME_KEYS);
  assert.deepEqual(contract.loaderReadKeys, BASE_RUNTIME_KEYS);
});

test('manifest에만 키를 추가한 반쪽 편집은 실패한다', () => {
  const runtimeText = runtimeConfigSource(
    [...BASE_RUNTIME_KEYS, 'MANIFEST_ONLY'],
    BASE_RUNTIME_KEYS.map((key) => [key, key]),
  );
  const contract = extractRuntimeConfigContract(runtimeText);

  assert.ok(
    contract.errors.some(
      (message) =>
        message.includes('MANIFEST_ONLY') &&
        message.includes('missing from loadRuntimeConfig'),
    ),
  );
});

test('loader에만 키를 추가한 반쪽 편집은 실패한다', () => {
  const runtimeText = runtimeConfigSource(BASE_RUNTIME_KEYS, [
    ...BASE_RUNTIME_KEYS.map((key) => [key, key]),
    ['LOADER_ONLY', 'LOADER_ONLY'],
  ]);
  const contract = extractRuntimeConfigContract(runtimeText);

  assert.ok(
    contract.errors.some(
      (message) =>
        message.includes('LOADER_ONLY') &&
        message.includes('missing from RUNTIME_CONFIG_KEYS'),
    ),
  );
});

test('loader property가 다른 env key를 읽으면 실패한다', () => {
  const mappings = BASE_RUNTIME_KEYS.map((key) =>
    key === 'PORT' ? ['PORT', 'OTHER_PORT'] : [key, key],
  );
  const contract = extractRuntimeConfigContract(
    runtimeConfigSource(BASE_RUNTIME_KEYS, mappings),
  );

  assert.ok(
    contract.errors.some((message) =>
      message.includes('PORT reads env.OTHER_PORT'),
    ),
  );
});

test('manifest 중복 key를 실패시킨다', () => {
  const contract = extractRuntimeConfigContract(
    runtimeConfigSource([...BASE_RUNTIME_KEYS, 'PORT']),
  );

  assert.ok(
    contract.errors.some((message) =>
      message.includes('duplicate RUNTIME_CONFIG_KEYS key: PORT'),
    ),
  );
});

test('loader spread·동적 식은 지원하지 않고 실패시킨다', () => {
  const contract = extractRuntimeConfigContract(
    runtimeConfigSource(BASE_RUNTIME_KEYS, undefined, ['...otherConfig']),
  );

  assert.ok(
    contract.errors.some((message) =>
      message.includes('unsupported loadRuntimeConfig entry'),
    ),
  );
});

test('숫자를 포함한 required compose key 누락을 검출한다', () => {
  const result = evaluateFixture({
    composeText: `services:
  backend:
    environment:
      SUBMISSION_FILE_S3_BUCKET: \${SUBMISSION_FILE_S3_BUCKET:?required}
`,
    envText: '',
    runtimeText: runtimeConfigSource([]),
    composeConfig: composeModel(['AUTH_INITIAL_ROLES']),
  });

  assert.ok(
    messages(result).some((message) =>
      message.includes('required key missing: SUBMISSION_FILE_S3_BUCKET'),
    ),
  );
});

test('runtime key가 .env.example에 없으면 실패한다', () => {
  const envText = BASE_ENV.replace('PORT=\n', '');
  const result = evaluateFixture({ envText });

  assert.ok(
    messages(result).some((message) =>
      message.includes('runtime key missing from .env.example: PORT'),
    ),
  );
});

for (const key of REPRESENTATIVE_MAPPING_KEYS) {
  test(`${key}가 backend environment에 없으면 실패한다`, () => {
    const backendKeys = BASE_RUNTIME_KEYS.filter(
      (candidate) => candidate !== key,
    );
    const result = evaluateFixture({
      composeConfig: composeModel(backendKeys),
    });

    assert.ok(
      messages(result).some(
        (message) =>
          message.includes(key) &&
          message.includes('not mapped in backend service environment'),
      ),
    );
  });
}

test('다른 서비스의 mapping은 backend 주입을 충족하지 않는다', () => {
  const key = 'GITHUB_OPERATIONS_APP_ID';
  const backendKeys = BASE_RUNTIME_KEYS.filter(
    (candidate) => candidate !== key,
  );
  const result = evaluateFixture({
    composeConfig: composeModel(backendKeys, {
      worker: { environment: { [key]: 'synthetic' } },
    }),
  });

  assert.ok(
    messages(result).some(
      (message) =>
        message.includes(key) &&
        message.includes('backend service environment'),
    ),
  );
});

test('x-extension spoof는 backend mapping으로 인정하지 않는다', () => {
  const key = 'SPOOFED_KEY';
  const runtimeText = runtimeConfigSource([...BASE_RUNTIME_KEYS, key]);
  const result = evaluateFixture({
    envText: `${BASE_ENV}${key}=\n`,
    runtimeText,
    composeConfig: {
      services: composeModel().services,
      'x-probe': {
        backend: { environment: { [key]: 'synthetic' } },
      },
    },
  });

  assert.ok(
    messages(result).some((message) =>
      message.includes(
        `runtime key not mapped in backend service environment: ${key}`,
      ),
    ),
  );
});

test('map-form과 list-form environment를 모두 인정한다', () => {
  assert.equal(
    serviceEnvironmentMapsKey(
      { services: { backend: { environment: { PORT: '4000' } } } },
      'backend',
      'PORT',
    ),
    true,
  );
  assert.equal(
    serviceEnvironmentMapsKey(
      {
        services: {
          backend: {
            environment: ['PORT', 'SESSION_SECRET=synthetic'],
          },
        },
      },
      'backend',
      'PORT',
    ),
    true,
  );
  assert.equal(
    serviceEnvironmentMapsKey(
      {
        services: {
          backend: {
            environment: ['PORT', 'SESSION_SECRET=synthetic'],
          },
        },
      },
      'backend',
      'SESSION_SECRET',
    ),
    true,
  );
});

test(
  'Docker anchor merge를 정규화한 뒤 실제 mapping으로 인정한다',
  { skip: !DOCKER_COMPOSE_AVAILABLE },
  () => {
    const composeText = `x-backend-env: &backend-env
  AUTH_INITIAL_ROLES: \${AUTH_INITIAL_ROLES:-}
  PORT: \${PORT:-4000}
services:
  backend:
    image: busybox:latest
    environment:
      <<: *backend-env
`;
    const composeConfig = composeConfigFromText(composeText);
    const result = evaluateFixture({
      composeText,
      envText: 'AUTH_INITIAL_ROLES=\nPORT=\n',
      runtimeText: runtimeConfigSource(['AUTH_INITIAL_ROLES', 'PORT']),
      composeConfig,
    });

    assert.equal(result.ok, true, messages(result).join('\n'));
  },
);

test('AUTH_INITIAL_ROLES는 manifest와 무관하게 명시 mapping이 필요하다', () => {
  const result = evaluateFixture({
    runtimeText: runtimeConfigSource([]),
    envText: '',
    composeText: 'services: {}\n',
    composeConfig: composeModel([]),
  });

  assert.ok(
    messages(result).includes(
      'env example contract: backend environment must explicitly map AUTH_INITIAL_ROLES.',
    ),
  );
});

test('면제 원장은 필요한 7개 key만 좁은 check에 등록한다', () => {
  const ledger = Object.fromEntries(
    ENV_CONTRACT_EXEMPTIONS.map((entry) => [entry.key, [...entry.checks]]),
  );

  assert.deepEqual(ledger.IMAGE_TAG, ['compose-declaration']);
  assert.deepEqual(ledger.NODE_ENV, [
    'runtime-declaration',
    'backend-injection',
  ]);
  assert.deepEqual(ledger.DIGEST_FORCE_TO, [
    'runtime-declaration',
    'backend-injection',
  ]);
  assert.deepEqual(ledger.SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED, [
    'backend-injection',
  ]);
  assert.deepEqual(ledger.SUBMISSION_FILE_CLEANUP_OPERATOR_ID, [
    'backend-injection',
  ]);
  assert.deepEqual(ledger.GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES, [
    'backend-injection',
  ]);
  assert.deepEqual(ledger.GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS, [
    'backend-injection',
  ]);
  assert.equal('OSS_HUB_INTEGRATION_RUNNER' in ledger, false);
});

test('NODE_ENV·DIGEST_FORCE_TO는 문서화와 backend 주입을 면제한다', () => {
  const result = evaluateFixture({
    composeText: 'services: {}\n',
    envText: '',
    runtimeText: runtimeConfigSource(['NODE_ENV', 'DIGEST_FORCE_TO']),
    composeConfig: composeModel(['AUTH_INITIAL_ROLES']),
  });

  assert.equal(result.ok, true, messages(result).join('\n'));
});

test('cleanup·smoke key는 문서화가 필요하지만 backend 주입은 면제한다', () => {
  const keys = [
    'SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED',
    'SUBMISSION_FILE_CLEANUP_OPERATOR_ID',
    'GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES',
    'GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS',
  ];
  const envText = keys.map((key) => `${key}=`).join('\n');
  const result = evaluateFixture({
    composeText: 'services: {}\n',
    envText,
    runtimeText: runtimeConfigSource(keys),
    composeConfig: composeModel(['AUTH_INITIAL_ROLES']),
  });

  assert.equal(result.ok, true, messages(result).join('\n'));

  const missingDeclaration = evaluateFixture({
    composeText: 'services: {}\n',
    envText: envText.replace('SUBMISSION_FILE_CLEANUP_OPERATOR_ID=\n', ''),
    runtimeText: runtimeConfigSource(keys),
    composeConfig: composeModel(['AUTH_INITIAL_ROLES']),
  });

  assert.ok(
    messages(missingDeclaration).some((message) =>
      message.includes(
        'runtime key missing from .env.example: SUBMISSION_FILE_CLEANUP_OPERATOR_ID',
      ),
    ),
  );
});

test('IMAGE_TAG 면제는 compose 문서화에만 적용된다', () => {
  const composeText = `services:
  backend:
    image: app:\${IMAGE_TAG:?required}
`;

  const composeOnly = evaluateFixture({
    composeText,
    envText: '',
    runtimeText: runtimeConfigSource([]),
    composeConfig: composeModel(['AUTH_INITIAL_ROLES']),
  });
  assert.equal(composeOnly.ok, true, messages(composeOnly).join('\n'));

  const codeUse = evaluateFixture({
    composeText,
    envText: '',
    runtimeText: runtimeConfigSource(['IMAGE_TAG']),
    composeConfig: composeModel(['AUTH_INITIAL_ROLES']),
  });
  assert.ok(
    messages(codeUse).some((message) =>
      message.includes('runtime key missing from .env.example: IMAGE_TAG'),
    ),
  );
  assert.ok(
    messages(codeUse).some((message) =>
      message.includes(
        'runtime key not mapped in backend service environment: IMAGE_TAG',
      ),
    ),
  );
});

test('OSS_HUB_INTEGRATION_RUNNER는 더 이상 면제되지 않는다', () => {
  const result = evaluateFixture({
    composeText: 'services: {}\n',
    envText: '',
    runtimeText: runtimeConfigSource(['OSS_HUB_INTEGRATION_RUNNER']),
    composeConfig: composeModel(['AUTH_INITIAL_ROLES']),
  });

  assert.ok(
    messages(result).some((message) =>
      message.includes(
        'runtime key missing from .env.example: OSS_HUB_INTEGRATION_RUNNER',
      ),
    ),
  );
  assert.ok(
    messages(result).some((message) =>
      message.includes(
        'runtime key not mapped in backend service environment: OSS_HUB_INTEGRATION_RUNNER',
      ),
    ),
  );
});

test('compose model 부재와 명시적 local skip을 구분한다', () => {
  const missing = evaluateFixture({ composeConfig: null });
  assert.ok(
    messages(missing).includes(
      'env example contract: compose config model is required for service mapping checks',
    ),
  );

  const skipped = evaluateFixture({
    composeConfig: null,
    composeConfigSkipped: true,
  });
  assert.equal(skipped.ok, true, messages(skipped).join('\n'));

  const declarationStillRuns = evaluateFixture({
    envText: BASE_ENV.replace('PORT=\n', ''),
    composeConfig: null,
    composeConfigSkipped: true,
  });
  assert.ok(
    messages(declarationStillRuns).some((message) =>
      message.includes('runtime key missing from .env.example: PORT'),
    ),
  );
});

test('parseArguments는 세 positional과 --require-docker를 보존한다', () => {
  assert.deepEqual(
    parseArguments([
      'compose.custom.yml',
      '.env.custom',
      'contract-root',
      '--require-docker',
    ]),
    {
      help: false,
      requireDocker: true,
      composeFile: 'compose.custom.yml',
      envExample: '.env.custom',
      scanRoot: 'contract-root',
    },
  );

  assert.deepEqual(parseArguments([]), {
    help: false,
    requireDocker: false,
    composeFile: 'compose.yml',
    envExample: '.env.example',
    scanRoot: '',
  });
});

test('Docker 없는 local 실행은 mapping 검사를 명시적으로 skip한다', () => {
  const root = makeTempDir();
  const shOnly = makeShOnlyPath();

  try {
    writeContractTree(root);
    const result = runEntry(root, {
      ci: 'false',
      path: shOnly.bin,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /skipping checks \[service-mapping, compose-config\]/,
    );
    assert.match(
      result.stderr,
      /declaration and runtime-loader checks still run/,
    );
    assert.match(result.stdout, /env example contract: ok/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(shOnly.root, { recursive: true, force: true });
  }
});

test('Docker 없는 --require-docker 실행은 fail-closed다', () => {
  const root = makeTempDir();
  const shOnly = makeShOnlyPath();

  try {
    writeContractTree(root);
    const result = runEntry(root, {
      requireDocker: true,
      ci: 'false',
      path: shOnly.bin,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /docker not found on PATH/);
    assert.doesNotMatch(result.stdout, /env example contract: ok/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(shOnly.root, { recursive: true, force: true });
  }
});

test('CI=true는 플래그가 없어도 Docker 부재를 fail-closed로 처리한다', () => {
  const root = makeTempDir();
  const shOnly = makeShOnlyPath();

  try {
    writeContractTree(root);
    const result = runEntry(root, {
      ci: 'true',
      path: shOnly.bin,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /docker not found on PATH/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(shOnly.root, { recursive: true, force: true });
  }
});
