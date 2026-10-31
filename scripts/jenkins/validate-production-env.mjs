import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

class ContractError extends Error {}

function fail(diagnostic) {
  throw new ContractError(diagnostic);
}

export function parseDotenv(contents) {
  const environment = new Map();
  const lines = contents.split(/\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith('\r')
      ? lines[index].slice(0, -1)
      : lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }

    const exported = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=/u.exec(line);
    if (exported) {
      fail(exported[1]);
    }

    const delimiter = line.indexOf('=');
    if (delimiter <= 0) {
      fail(`dotenv syntax at line ${index + 1}`);
    }

    const key = line.slice(0, delimiter);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      fail(`dotenv syntax at line ${index + 1}`);
    }
    if (environment.has(key)) {
      fail(key);
    }

    const rawValue = line.slice(delimiter + 1);
    let value = rawValue;
    if (rawValue.startsWith("'") || rawValue.startsWith('"')) {
      const quote = rawValue[0];
      if (rawValue.length < 2 || !rawValue.endsWith(quote)) {
        fail(key);
      }
      value = rawValue.slice(1, -1);
      if (value.includes(quote)) {
        fail(key);
      }
    } else if (rawValue.includes("'") || rawValue.includes('"')) {
      fail(key);
    }

    if (/[$`;|&]/u.test(value)) {
      fail(key);
    }
    environment.set(key, value);
  }

  return environment;
}

function required(environment, key) {
  if (!environment.has(key) || environment.get(key) === '') {
    fail(key);
  }
  return environment.get(key);
}

function optional(environment, key) {
  const value = environment.get(key);
  return value === '' ? undefined : value;
}

function requireCanonicalInteger(environment, key, minimum, maximum) {
  const value = optional(environment, key);
  if (value === undefined) {
    return;
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    fail(key);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(key);
  }
}

function requireBoolean(environment, key, isRequired = true) {
  const value = isRequired
    ? required(environment, key)
    : optional(environment, key);
  if (value !== undefined && value !== 'true' && value !== 'false') {
    fail(key);
  }
}

function requireStrongSecret(environment, key) {
  const value = required(environment, key);
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    fail(key);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < 32 || decoded.toString('base64url') !== value) {
    fail(key);
  }
}

function parseUrl(environment, key, isRequired = true) {
  const value = isRequired
    ? required(environment, key)
    : optional(environment, key);
  if (value === undefined) {
    return undefined;
  }
  try {
    return { value, url: new URL(value) };
  } catch {
    fail(key);
  }
}

function hasUserInfo(value) {
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/u, 1)[0];
  return authority.includes('@');
}

function requireFrontendUrl(environment) {
  const key = 'FRONTEND_URL';
  const { value, url } = parseUrl(environment, key);
  if (
    url.protocol !== 'https:' ||
    hasUserInfo(value) ||
    value.includes('?') ||
    value.includes('#') ||
    (url.pathname !== '' && url.pathname !== '/') ||
    /:443(?:\/|$)/u.test(value)
  ) {
    fail(key);
  }
}

function requireS3Endpoint(environment) {
  const key = 'SUBMISSION_FILE_S3_ENDPOINT';
  const parsed = parseUrl(environment, key);
  const { value, url } = parsed;
  if (
    url.protocol !== 'https:' ||
    hasUserInfo(value) ||
    value.includes('?') ||
    value.includes('#')
  ) {
    fail(key);
  }
}

function validate(environment) {
  for (const key of [
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'DATABASE_URL',
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_SECRET',
    'GMAIL_SENDER',
    'GMAIL_OAUTH_CLIENT_ID',
    'GMAIL_OAUTH_CLIENT_SECRET',
    'GMAIL_OAUTH_REFRESH_TOKEN',
    'GITHUB_COLLECTION_APP_ID',
    'GITHUB_OPERATIONS_APP_ID',
  ]) {
    required(environment, key);
  }

  requireStrongSecret(environment, 'SESSION_SECRET');
  requireStrongSecret(environment, 'TEAM_JOIN_CODE_SECRET');
  requireFrontendUrl(environment);

  const storageMode = required(environment, 'SUBMISSION_FILE_STORAGE_MODE');
  if (storageMode !== 'managed') {
    fail('SUBMISSION_FILE_STORAGE_MODE');
  }
  requireBoolean(environment, 'SUBMISSION_FILE_S3_FORCE_PATH_STYLE');
  requireBoolean(
    environment,
    'SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED',
    false,
  );
  requireCanonicalInteger(environment, 'PORT', 1, 65_535);
  requireCanonicalInteger(
    environment,
    'GITHUB_COLLECTION_APP_ID',
    1,
    Number.MAX_SAFE_INTEGER,
  );
  requireCanonicalInteger(
    environment,
    'GITHUB_OPERATIONS_APP_ID',
    1,
    Number.MAX_SAFE_INTEGER,
  );

  const organization = required(environment, 'GITHUB_APP_ORG');
  if (
    organization.length > 39 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(organization)
  ) {
    fail('GITHUB_APP_ORG');
  }

  requireS3Endpoint(environment);

  const region = required(environment, 'SUBMISSION_FILE_S3_REGION');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(region)) {
    fail('SUBMISSION_FILE_S3_REGION');
  }

  const bucket = required(environment, 'SUBMISSION_FILE_S3_BUCKET');
  if (
    bucket.length < 3 ||
    bucket.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(bucket) ||
    /(?:\.\.|-\.|\.-)/u.test(bucket) ||
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(bucket)
  ) {
    fail('SUBMISSION_FILE_S3_BUCKET');
  }

  const managedEndpoint = new URL(
    required(environment, 'SUBMISSION_FILE_S3_ENDPOINT'),
  );
  if (
    !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/iu.test(
      managedEndpoint.hostname,
    ) ||
    managedEndpoint.pathname !== '/' ||
    region !== 'auto' ||
    required(environment, 'SUBMISSION_FILE_S3_FORCE_PATH_STYLE') !== 'true' ||
    environment.has('SUBMISSION_FILE_S3_ACCESS_KEY_ID') ||
    environment.has('SUBMISSION_FILE_S3_SECRET_ACCESS_KEY')
  ) {
    fail('SUBMISSION_FILE_STORAGE_MODE');
  }

  if (
    !environment.has('AUTH_INITIAL_ROLES') ||
    environment.get('AUTH_INITIAL_ROLES') !== ''
  ) {
    fail('AUTH_INITIAL_ROLES');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (
      process.argv.length !== 3 &&
      !(process.argv.length === 5 && process.argv[3] === '--value')
    ) {
      fail('ENV_FILE');
    }
    const contents = readFileSync(process.argv[2], 'utf8');
    const environment = parseDotenv(contents);
    validate(environment);
    if (process.argv[3] === '--value') {
      const key = process.argv[4];
      if (
        ![
          'SUBMISSION_FILE_S3_ENDPOINT',
          'SUBMISSION_FILE_S3_REGION',
          'SUBMISSION_FILE_S3_BUCKET',
          'SUBMISSION_FILE_S3_FORCE_PATH_STYLE',
        ].includes(key)
      )
        fail('unsupported storage value');
      process.stdout.write(required(environment, key));
    }
  } catch (error) {
    const diagnostic =
      error instanceof ContractError ? error.message : 'ENV_FILE';
    console.error(`FAIL_CLOSED production_env: ${diagnostic}`);
    process.exitCode = 1;
  }
}
