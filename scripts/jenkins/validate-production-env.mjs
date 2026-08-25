import { readFileSync } from 'node:fs';

class ContractError extends Error {}

function fail(diagnostic) {
  throw new ContractError(diagnostic);
}

function parseDotenv(contents) {
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

function requireHttpsProviderUrl(environment, key) {
  const parsed = parseUrl(environment, key, false);
  if (parsed === undefined) {
    return;
  }
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

function requireS3Endpoint(environment) {
  const key = 'SUBMISSION_FILE_S3_ENDPOINT';
  const parsed = parseUrl(environment, key, false);
  if (parsed === undefined) {
    return;
  }
  const { value, url } = parsed;
  const internalHttp = url.protocol === 'http:' && url.hostname === 'minio';
  if (
    (url.protocol !== 'https:' && !internalHttp) ||
    hasUserInfo(value) ||
    value.includes('?') ||
    value.includes('#')
  ) {
    fail(key);
  }
}

function validCronAtom(atom, minimum, maximum) {
  const match = /^(\*|[0-9]+(?:-[0-9]+)?)(?:\/([1-9][0-9]*))?$/u.exec(atom);
  if (!match) {
    return false;
  }
  if (match[1] === '*') {
    return match[2] === undefined || Number(match[2]) <= maximum - minimum + 1;
  }
  const [startText, endText = startText] = match[1].split('-');
  const start = Number(startText);
  const end = Number(endText);
  return (
    start >= minimum &&
    end <= maximum &&
    start <= end &&
    (match[2] === undefined || Number(match[2]) <= maximum - minimum + 1)
  );
}

function requireCron(environment) {
  const key = 'COLLECTION_CRON_EXPRESSION';
  const expression = optional(environment, key);
  if (expression === undefined) {
    return;
  }
  const fields = expression.split(' ');
  const ranges = [
    [0, 59],
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  if (
    fields.length !== ranges.length ||
    fields.some(
      (field, index) =>
        field === '' ||
        !field
          .split(',')
          .every((atom) =>
            validCronAtom(atom, ranges[index][0], ranges[index][1]),
          ),
    )
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
    'SUBMISSION_FILE_S3_ACCESS_KEY_ID',
    'SUBMISSION_FILE_S3_SECRET_ACCESS_KEY',
  ]) {
    required(environment, key);
  }

  requireStrongSecret(environment, 'SESSION_SECRET');
  requireStrongSecret(environment, 'TEAM_JOIN_CODE_SECRET');
  requireFrontendUrl(environment);

  if (required(environment, 'MAIL_MODE') !== 'send') {
    fail('MAIL_MODE');
  }

  requireBoolean(environment, 'SUBMISSION_FILE_S3_FORCE_PATH_STYLE', false);
  requireBoolean(
    environment,
    'SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED',
    false,
  );
  requireCanonicalInteger(environment, 'PORT', 1, 65_535);
  requireCanonicalInteger(
    environment,
    'GITHUB_COLLECTION_APP_MAX_PAGES',
    1,
    100,
  );
  requireCanonicalInteger(
    environment,
    'GITHUB_COLLECTION_APP_DEADLINE_MS',
    1,
    30_000,
  );
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
  requireCron(environment);

  const organization = required(environment, 'GITHUB_APP_ORG');
  if (
    organization.length > 39 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(organization)
  ) {
    fail('GITHUB_APP_ORG');
  }

  requireHttpsProviderUrl(environment, 'GITHUB_COLLECTION_APP_API_BASE_URL');
  requireS3Endpoint(environment);

  const region = optional(environment, 'SUBMISSION_FILE_S3_REGION');
  if (region !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(region)) {
    fail('SUBMISSION_FILE_S3_REGION');
  }

  const bucket = optional(environment, 'SUBMISSION_FILE_S3_BUCKET');
  if (
    bucket !== undefined &&
    (bucket.length < 3 ||
      bucket.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(bucket) ||
      /(?:\.\.|-\.|\.-)/u.test(bucket) ||
      /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(bucket))
  ) {
    fail('SUBMISSION_FILE_S3_BUCKET');
  }

  if (
    !environment.has('AUTH_INITIAL_ROLES') ||
    environment.get('AUTH_INITIAL_ROLES') !== ''
  ) {
    fail('AUTH_INITIAL_ROLES');
  }
}

try {
  if (process.argv.length !== 3) {
    fail('ENV_FILE');
  }
  const contents = readFileSync(process.argv[2], 'utf8');
  validate(parseDotenv(contents));
} catch (error) {
  const diagnostic =
    error instanceof ContractError ? error.message : 'ENV_FILE';
  console.error(`FAIL_CLOSED production_env: ${diagnostic}`);
  process.exitCode = 1;
}
