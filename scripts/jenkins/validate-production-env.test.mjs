import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const validator = fileURLToPath(
  new URL('./validate-production-env.mjs', import.meta.url),
);
const REMOVE = Symbol('remove');
const R2_ENDPOINT =
  'https://00000000000000000000000000000000.r2.cloudflarestorage.com';
const sessionSecret = Buffer.from('0123456789abcdef0123456789abcdef').toString(
  'base64url',
);
const joinCodeSecret = Buffer.from('fedcba9876543210fedcba9876543210').toString(
  'base64url',
);
const shortSecret = Buffer.alloc(31, 7).toString('base64url');

const baseEnvironment = Object.freeze({
  POSTGRES_USER: 'oss_hub',
  POSTGRES_PASSWORD: 'postgres-password-synthetic',
  POSTGRES_DB: 'oss_hub',
  DATABASE_URL:
    'postgresql://oss_hub:postgres-password-synthetic@postgres:5432/oss_hub',
  SESSION_SECRET: sessionSecret,
  TEAM_JOIN_CODE_SECRET: joinCodeSecret,
  FRONTEND_URL: 'https://oss-hub.example.test',
  GITHUB_OAUTH_CLIENT_ID: 'oauth-client-id-synthetic',
  GITHUB_OAUTH_CLIENT_SECRET: 'oauth-client-secret-synthetic',
  GITHUB_APP_ORG: 'synthetic-org',
  GITHUB_COLLECTION_APP_ID: '12345',
  GITHUB_OPERATIONS_APP_ID: '67890',
  GITHUB_COLLECTION_APP_API_BASE_URL: 'https://api.github.com',
  GITHUB_COLLECTION_APP_MAX_PAGES: '100',
  GITHUB_COLLECTION_APP_DEADLINE_MS: '30000',
  COLLECTION_CRON_EXPRESSION: '0 0 * * * *',
  PORT: '4000',
  SUBMISSION_FILE_STORAGE_MODE: 'managed',
  SUBMISSION_FILE_S3_ENDPOINT: R2_ENDPOINT,
  SUBMISSION_FILE_S3_REGION: 'auto',
  SUBMISSION_FILE_S3_BUCKET: 'synthetic-r2-bucket',
  SUBMISSION_FILE_S3_FORCE_PATH_STYLE: 'true',
  AUTH_INITIAL_ROLES: '',
  MAIL_MODE: 'send',
  GMAIL_SENDER: 'sender@example.test',
  GMAIL_OAUTH_CLIENT_ID: 'gmail-client-id-synthetic',
  GMAIL_OAUTH_CLIENT_SECRET: 'gmail-client-secret-synthetic',
  GMAIL_OAUTH_REFRESH_TOKEN: 'gmail-refresh-token-synthetic',
});

const syntheticSecrets = Object.freeze([
  baseEnvironment.POSTGRES_PASSWORD,
  sessionSecret,
  joinCodeSecret,
  baseEnvironment.GITHUB_OAUTH_CLIENT_SECRET,
  baseEnvironment.GMAIL_OAUTH_CLIENT_SECRET,
  baseEnvironment.GMAIL_OAUTH_REFRESH_TOKEN,
]);

function renderEnvironment(overrides = {}, lineEnding = '\n') {
  const values = { ...baseEnvironment, ...overrides };
  return (
    Object.entries(values)
      .filter(([, value]) => value !== REMOVE)
      .map(([key, value]) => `${key}=${value}`)
      .join(lineEnding) + lineEnding
  );
}

function replaceAssignment(contents, key, replacement) {
  const line = `${key}=${baseEnvironment[key]}`;
  assert.equal(contents.includes(line), true, `fixture key missing: ${key}`);
  return contents.replace(line, replacement);
}

function runValidator(contents) {
  const directory = mkdtempSync(join(tmpdir(), 'validate-production-env-'));
  const envFile = join(directory, 'production.env');
  writeFileSync(envFile, contents, { mode: 0o600 });
  const result = spawnSync(process.execPath, [validator, envFile], {
    encoding: 'utf8',
  });
  rmSync(directory, { recursive: true, force: true });
  return result;
}

function outputOf(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function assertNoSensitiveOutput(result, redactedValues = []) {
  const output = outputOf(result);
  const leaked = [...syntheticSecrets, ...redactedValues].some(
    (value) =>
      typeof value === 'string' && value !== '' && output.includes(value),
  );
  assert.equal(
    leaked,
    false,
    'validator output must not contain fixture values',
  );
}

function control(name, contents) {
  return { name, contents };
}

function reject(name, key, value, diagnostic = key) {
  return {
    name,
    value,
    contents: renderEnvironment({ [key]: value }),
    diagnostic,
  };
}

function removed(name, key) {
  return reject(name, key, REMOVE);
}

function rawReject(name, contents, diagnostic, redactedValues = []) {
  return { name, contents, diagnostic, redactedValues };
}

const controls = [
  control(
    'baseline production env with empty AUTH_INITIAL_ROLES',
    renderEnvironment(),
  ),
  control(
    'comments blank lines and CRLF are accepted',
    `# synthetic production fixture\r\n\r\n${renderEnvironment({}, '\r\n')}`,
  ),
  control(
    'plain single and double quoted values are accepted',
    replaceAssignment(
      replaceAssignment(
        renderEnvironment(),
        'GITHUB_APP_ORG',
        "GITHUB_APP_ORG='synthetic-org'",
      ),
      'SUBMISSION_FILE_S3_REGION',
      'SUBMISSION_FILE_S3_REGION="auto"',
    ),
  ),
  control('minimum port is accepted', renderEnvironment({ PORT: '1' })),
  control('maximum port is accepted', renderEnvironment({ PORT: '65535' })),
  control(
    'false cleanup maintenance boolean is accepted',
    renderEnvironment({
      SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED: 'false',
    }),
  ),
  control(
    'bounded positive collection integers are accepted',
    renderEnvironment({
      GITHUB_COLLECTION_APP_MAX_PAGES: '100',
      GITHUB_COLLECTION_APP_DEADLINE_MS: '30000',
    }),
  ),
  control(
    'root slash HTTPS frontend origin is accepted',
    renderEnvironment({ FRONTEND_URL: 'https://oss-hub.example.test/' }),
  ),
  control(
    'non-default HTTPS frontend port is accepted',
    renderEnvironment({ FRONTEND_URL: 'https://oss-hub.example.test:8443' }),
  ),
  control(
    'six-field stepped cron is accepted',
    renderEnvironment({ COLLECTION_CRON_EXPRESSION: '0 */15 * * * *' }),
  ),
  control(
    'managed R2 configuration accepts a dotted bucket',
    renderEnvironment({
      SUBMISSION_FILE_S3_BUCKET: 'synthetic.r2.bucket',
    }),
  ),
  control(
    'missing compose-defaulted values are accepted',
    renderEnvironment({
      GITHUB_COLLECTION_APP_API_BASE_URL: REMOVE,
      GITHUB_COLLECTION_APP_MAX_PAGES: REMOVE,
      GITHUB_COLLECTION_APP_DEADLINE_MS: REMOVE,
      COLLECTION_CRON_EXPRESSION: REMOVE,
      PORT: REMOVE,
    }),
  ),
  control(
    'canonical hyphenated GitHub organization is accepted',
    renderEnvironment({ GITHUB_APP_ORG: 'synthetic-security-org' }),
  ),
  control(
    'canonical mixed-case GitHub organization is accepted',
    renderEnvironment({ GITHUB_APP_ORG: 'Synthetic-Security-Org' }),
  ),
  control(
    'HTTPS GitHub Enterprise API path is accepted',
    renderEnvironment({
      GITHUB_COLLECTION_APP_API_BASE_URL: 'https://github.example.test/api/v3',
    }),
  ),
];

const parserRejects = [
  rawReject(
    'duplicate dotenv key',
    `${renderEnvironment()}PORT=4001\n`,
    'PORT',
    ['4001'],
  ),
  rawReject(
    'export-prefixed assignment',
    replaceAssignment(
      renderEnvironment(),
      'SESSION_SECRET',
      `export SESSION_SECRET=${sessionSecret}`,
    ),
    'SESSION_SECRET',
  ),
  rawReject(
    'source-style command',
    `${renderEnvironment()}source ./synthetic-production.env\n`,
    /dotenv|syntax|line/i,
    ['source ./synthetic-production.env'],
  ),
  rawReject(
    'braced dotenv interpolation',
    replaceAssignment(
      renderEnvironment(),
      'TEAM_JOIN_CODE_SECRET',
      'TEAM_JOIN_CODE_SECRET=${SESSION_SECRET}',
    ),
    'TEAM_JOIN_CODE_SECRET',
    ['${SESSION_SECRET}'],
  ),
  rawReject(
    'bare dollar interpolation',
    replaceAssignment(
      renderEnvironment(),
      'TEAM_JOIN_CODE_SECRET',
      'TEAM_JOIN_CODE_SECRET=$SESSION_SECRET',
    ),
    'TEAM_JOIN_CODE_SECRET',
    ['$SESSION_SECRET'],
  ),
  rawReject(
    'command substitution',
    replaceAssignment(renderEnvironment(), 'PORT', 'PORT=$(id -u)'),
    'PORT',
    ['$(id -u)'],
  ),
  rawReject(
    'backtick substitution',
    replaceAssignment(renderEnvironment(), 'PORT', 'PORT=`id -u`'),
    'PORT',
    ['`id -u`'],
  ),
  rawReject(
    'assignment missing equals delimiter',
    `${renderEnvironment()}UNSUPPORTED LINE\n`,
    /dotenv|syntax|line/i,
    ['UNSUPPORTED LINE'],
  ),
  rawReject(
    'unterminated quoted value',
    replaceAssignment(
      renderEnvironment(),
      'GITHUB_APP_ORG',
      'GITHUB_APP_ORG="synthetic-org',
    ),
    'GITHUB_APP_ORG',
    ['"synthetic-org'],
  ),
  rawReject(
    'shell command separator',
    replaceAssignment(renderEnvironment(), 'PORT', 'PORT=4000; id'),
    'PORT',
    ['4000; id'],
  ),
];

const valueRejects = [
  removed('missing session secret', 'SESSION_SECRET'),
  reject('blank session secret', 'SESSION_SECRET', ''),
  reject('short session secret', 'SESSION_SECRET', shortSecret),
  reject('non-base64url session secret', 'SESSION_SECRET', 'not+base64/value='),
  reject('obviously weak session secret', 'SESSION_SECRET', 'change-me'),
  removed('missing join-code secret', 'TEAM_JOIN_CODE_SECRET'),
  reject('blank join-code secret', 'TEAM_JOIN_CODE_SECRET', ''),
  reject('short join-code secret', 'TEAM_JOIN_CODE_SECRET', shortSecret),
  reject(
    'non-base64url join-code secret',
    'TEAM_JOIN_CODE_SECRET',
    'not+base64/value=',
  ),
  reject(
    'obviously weak join-code secret',
    'TEAM_JOIN_CODE_SECRET',
    'change-me',
  ),

  reject('HTTP frontend origin', 'FRONTEND_URL', 'http://oss-hub.example.test'),
  reject(
    'frontend origin with credentials',
    'FRONTEND_URL',
    'https://user:pass@oss-hub.example.test',
  ),
  reject(
    'frontend origin with empty userinfo',
    'FRONTEND_URL',
    'https://@oss-hub.example.test',
  ),
  reject(
    'frontend origin with query',
    'FRONTEND_URL',
    'https://oss-hub.example.test?mode=prod',
  ),
  reject(
    'frontend origin with empty query',
    'FRONTEND_URL',
    'https://oss-hub.example.test?',
  ),
  reject(
    'frontend origin with fragment',
    'FRONTEND_URL',
    'https://oss-hub.example.test#prod',
  ),
  reject(
    'frontend origin with path',
    'FRONTEND_URL',
    'https://oss-hub.example.test/app',
  ),
  reject(
    'noncanonical default HTTPS port',
    'FRONTEND_URL',
    'https://oss-hub.example.test:443',
  ),

  removed('missing mail mode', 'MAIL_MODE'),
  reject('blank mail mode', 'MAIL_MODE', ''),
  reject('dry-run production mail mode', 'MAIL_MODE', 'dry-run'),
  reject('uppercase production mail mode', 'MAIL_MODE', 'SEND'),
  reject('unknown production mail mode', 'MAIL_MODE', 'smtp'),
  removed('missing Gmail sender', 'GMAIL_SENDER'),
  removed('missing Gmail OAuth client ID', 'GMAIL_OAUTH_CLIENT_ID'),
  removed('missing Gmail OAuth client secret', 'GMAIL_OAUTH_CLIENT_SECRET'),
  removed('missing Gmail OAuth refresh token', 'GMAIL_OAUTH_REFRESH_TOKEN'),

  reject(
    'numeric S3 path-style boolean',
    'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
    '1',
  ),
  reject(
    'uppercase S3 path-style boolean',
    'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
    'TRUE',
  ),
  reject(
    'invalid cleanup maintenance boolean',
    'SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED',
    'enabled',
  ),

  ...[
    ['zero port', 'PORT', '0'],
    ['port above 65535', 'PORT', '65536'],
    ['negative port', 'PORT', '-1'],
    ['decimal port', 'PORT', '4000.5'],
    ['noncanonical leading-zero port', 'PORT', '04000'],
    ['zero collection max pages', 'GITHUB_COLLECTION_APP_MAX_PAGES', '0'],
    [
      'collection max pages above 100',
      'GITHUB_COLLECTION_APP_MAX_PAGES',
      '101',
    ],
    ['decimal collection max pages', 'GITHUB_COLLECTION_APP_MAX_PAGES', '1.5'],
    ['zero collection deadline', 'GITHUB_COLLECTION_APP_DEADLINE_MS', '0'],
    [
      'collection deadline above 30000',
      'GITHUB_COLLECTION_APP_DEADLINE_MS',
      '30001',
    ],
    [
      'decimal collection deadline',
      'GITHUB_COLLECTION_APP_DEADLINE_MS',
      '10.5',
    ],
  ].map(([name, key, value]) => reject(name, key, value)),

  reject(
    'five-field collection cron',
    'COLLECTION_CRON_EXPRESSION',
    '0 * * * *',
  ),
  reject(
    'seven-field collection cron',
    'COLLECTION_CRON_EXPRESSION',
    '0 0 0 * * * *',
  ),
  reject('cron descriptor', 'COLLECTION_CRON_EXPRESSION', '@hourly'),
  reject(
    'out-of-range cron minute',
    'COLLECTION_CRON_EXPRESSION',
    '0 60 * * * *',
  ),

  removed('missing GitHub OAuth client ID', 'GITHUB_OAUTH_CLIENT_ID'),
  removed('missing GitHub OAuth client secret', 'GITHUB_OAUTH_CLIENT_SECRET'),
  removed('missing Collection App ID', 'GITHUB_COLLECTION_APP_ID'),
  reject('zero Collection App ID', 'GITHUB_COLLECTION_APP_ID', '0'),
  reject('negative Collection App ID', 'GITHUB_COLLECTION_APP_ID', '-1'),
  reject(
    'noncanonical Collection App ID',
    'GITHUB_COLLECTION_APP_ID',
    '012345',
  ),
  removed('missing Operations App ID', 'GITHUB_OPERATIONS_APP_ID'),
  reject('zero Operations App ID', 'GITHUB_OPERATIONS_APP_ID', '0'),
  reject('nonnumeric Operations App ID', 'GITHUB_OPERATIONS_APP_ID', 'app-id'),
  removed('missing GitHub organization', 'GITHUB_APP_ORG'),
  reject('leading-hyphen GitHub organization', 'GITHUB_APP_ORG', '-synthetic'),
  reject('trailing-hyphen GitHub organization', 'GITHUB_APP_ORG', 'synthetic-'),
  reject(
    'overlong GitHub organization',
    'GITHUB_APP_ORG',
    'synthetic-organization-name-that-is-over-thirty-nine',
  ),
  reject(
    'HTTP Collection App API endpoint',
    'GITHUB_COLLECTION_APP_API_BASE_URL',
    'http://api.github.com',
  ),
  reject(
    'credentialed Collection App API endpoint',
    'GITHUB_COLLECTION_APP_API_BASE_URL',
    'https://user:pass@api.github.invalid',
  ),
  reject(
    'queried Collection App API endpoint',
    'GITHUB_COLLECTION_APP_API_BASE_URL',
    'https://api.github.com?mode=prod',
  ),
  reject(
    'fragmented Collection App API endpoint',
    'GITHUB_COLLECTION_APP_API_BASE_URL',
    'https://api.github.com#prod',
  ),

  reject(
    'public HTTP S3 endpoint',
    'SUBMISSION_FILE_S3_ENDPOINT',
    'http://storage.example.test',
  ),
  reject(
    'credentialed S3 endpoint',
    'SUBMISSION_FILE_S3_ENDPOINT',
    'https://user:pass@storage.example.test',
  ),
  reject(
    'queried S3 endpoint',
    'SUBMISSION_FILE_S3_ENDPOINT',
    'https://storage.example.test?mode=prod',
  ),
  reject(
    'unsupported S3 endpoint scheme',
    'SUBMISSION_FILE_S3_ENDPOINT',
    'ftp://storage.example.test',
  ),
  reject('uppercase S3 region', 'SUBMISSION_FILE_S3_REGION', 'US-EAST-1'),
  reject('spaced S3 region', 'SUBMISSION_FILE_S3_REGION', 'us east 1'),
  reject(
    'uppercase S3 bucket',
    'SUBMISSION_FILE_S3_BUCKET',
    'Synthetic-Bucket',
  ),
  reject(
    'underscored S3 bucket',
    'SUBMISSION_FILE_S3_BUCKET',
    'synthetic_bucket',
  ),
  reject('too-short S3 bucket', 'SUBMISSION_FILE_S3_BUCKET', 'ab'),
  reject('IP-shaped S3 bucket', 'SUBMISSION_FILE_S3_BUCKET', '192.168.1.1'),
  removed('missing storage mode', 'SUBMISSION_FILE_STORAGE_MODE'),
  reject(
    'retired MinIO storage mode',
    'SUBMISSION_FILE_STORAGE_MODE',
    'minio',
    'SUBMISSION_FILE_STORAGE_MODE',
  ),
  rawReject(
    'managed mode rejects a safe-looking non-R2 endpoint',
    renderEnvironment({
      SUBMISSION_FILE_S3_ENDPOINT: 'https://storage.example.test',
    }),
    'SUBMISSION_FILE_STORAGE_MODE',
  ),
  rawReject(
    'managed mode requires auto region',
    renderEnvironment({
      SUBMISSION_FILE_S3_REGION: 'us-east-1',
    }),
    'SUBMISSION_FILE_STORAGE_MODE',
  ),
  rawReject(
    'managed mode requires selected path style',
    renderEnvironment({
      SUBMISSION_FILE_S3_FORCE_PATH_STYLE: 'false',
    }),
    'SUBMISSION_FILE_STORAGE_MODE',
  ),
  rawReject(
    'managed env must not store access key',
    renderEnvironment({
      SUBMISSION_FILE_S3_ACCESS_KEY_ID: 'storage-access-synthetic',
    }),
    'SUBMISSION_FILE_STORAGE_MODE',
    ['storage-access-synthetic'],
  ),

  reject('non-empty initial roles seed', 'AUTH_INITIAL_ROLES', '12345:ADMIN'),
  reject('whitespace initial roles seed', 'AUTH_INITIAL_ROLES', ' '),
];

for (const { name, contents } of controls) {
  test(`control: ${name}`, () => {
    const result = runValidator(contents);
    assertNoSensitiveOutput(result);
    assert.equal(result.status, 0, 'accepted production env must exit zero');
  });
}

for (const testCase of [...parserRejects, ...valueRejects]) {
  test(`reject: ${testCase.name}`, () => {
    const result = runValidator(testCase.contents);
    const output = outputOf(result);
    assertNoSensitiveOutput(result, [
      ...(testCase.redactedValues ?? []),
      typeof testCase.value === 'string' && testCase.value.length >= 4
        ? testCase.value
        : '',
    ]);
    assert.notEqual(
      result.status,
      0,
      'invalid production env must fail closed',
    );
    const diagnostic =
      typeof testCase.diagnostic === 'string'
        ? output.includes(testCase.diagnostic)
        : testCase.diagnostic.test(output);
    assert.equal(
      diagnostic,
      true,
      'failure must identify only the invalid key or syntax location',
    );
  });
}
