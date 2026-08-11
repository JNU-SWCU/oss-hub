const EXPECTED_ENV_KEYS = new Set([
  'DATABASE_URL',
  'E2E_PROGRAM_AUTHORING_CONTROL',
  'FRONTEND_URL',
  'GITHUB_APP_ORG',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'HOME',
  'MAIL_MODE',
  'NODE_ENV',
  'PATH',
  'PORT',
  'SESSION_SECRET',
  'TEAM_JOIN_CODE_SECRET',
  '__CF_USER_TEXT_ENCODING',
]);

const REQUIRED_SYNTHETIC_VALUES = {
  E2E_PROGRAM_AUTHORING_CONTROL: 'enabled',
  GITHUB_APP_ORG: 'e2e-org',
  GITHUB_OAUTH_CLIENT_ID: 'synthetic-e2e-client',
  GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-e2e-client-secret',
  MAIL_MODE: 'dry-run',
  NODE_ENV: 'test',
};

const unexpectedKeys = Object.keys(process.env).filter(
  (key) => !EXPECTED_ENV_KEYS.has(key),
);
const mismatchedKeys = Object.entries(REQUIRED_SYNTHETIC_VALUES)
  .filter(([key, value]) => process.env[key] !== value)
  .map(([key]) => key);

if (unexpectedKeys.length > 0 || mismatchedKeys.length > 0) {
  const affectedKeys = [...unexpectedKeys, ...mismatchedKeys].join(', ');
  process.stderr.write(
    `backend env isolation: unexpected or mismatched keys: ${affectedKeys}\n`,
  );
  process.exitCode = 1;
}
