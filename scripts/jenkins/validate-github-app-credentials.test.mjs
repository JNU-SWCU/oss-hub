import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  assertGitHubAppCredential,
  parseDeploymentIdentity,
} from './validate-github-app-credentials.mjs';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

function response(status, body) {
  return new Response(JSON.stringify(body), { status });
}

test('deployment env에서 두 App 식별자만 읽는다', () => {
  assert.deepEqual(
    parseDeploymentIdentity(`
# comment
GITHUB_APP_ORG=synthetic-org
GITHUB_COLLECTION_APP_ID=12345
GITHUB_OPERATIONS_APP_ID="67890"
IGNORED_SECRET=must-not-be-read
`),
    {
      organization: 'synthetic-org',
      collectionAppId: '12345',
      operationsAppId: '67890',
    },
  );
});

test('App, installation, token identity가 모두 맞아야 통과한다', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path === '/app') return response(200, { id: 12345 });
    if (path === '/orgs/synthetic-org/installation') {
      return response(200, {
        id: 101,
        app_id: 12345,
        account: { login: 'synthetic-org' },
      });
    }
    return response(201, { token: 'synthetic-installation-token' });
  };

  await assertGitHubAppCredential(
    'operations',
    '12345',
    'synthetic-org',
    privateKey,
    fetcher,
  );

  assert.equal(calls.length, 3);
  assert.match(
    calls[0].init.headers.Authorization,
    /^Bearer [^.]+\.[^.]+\.[^.]+$/,
  );
  assert.equal(calls[2].init.method, 'POST');
});

test('다른 App key는 installation token 발급 전에 거부한다', async () => {
  let calls = 0;
  const fetcher = async (url) => {
    calls += 1;
    const path = new URL(url).pathname;
    if (path === '/app') return response(200, { id: 54321 });
    throw new Error('unexpected request');
  };

  await assert.rejects(
    assertGitHubAppCredential(
      'operations',
      '12345',
      'synthetic-org',
      privateKey,
      fetcher,
    ),
    /operations: app id mismatch/,
  );
  assert.equal(calls, 1);
});
