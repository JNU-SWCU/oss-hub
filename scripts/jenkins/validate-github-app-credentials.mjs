#!/usr/bin/env node

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.github.com';

export function parseDeploymentIdentity(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }

  const required = (key) => {
    const value = values.get(key)?.trim();
    if (!value) throw new Error(`missing deployment identity: ${key}`);
    return value;
  };

  return {
    organization: required('GITHUB_APP_ORG'),
    collectionAppId: required('GITHUB_COLLECTION_APP_ID'),
    operationsAppId: required('GITHUB_OPERATIONS_APP_ID'),
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createAppJwt(appId, privateKey, now = new Date()) {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const unsigned = `${base64urlJson({ alg: 'RS256', typ: 'JWT' })}.${base64urlJson(
    {
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: appId,
    },
  )}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

export async function assertGitHubAppCredential(
  label,
  appId,
  organization,
  privateKey,
  fetcher = globalThis.fetch,
) {
  if (!/^\d+$/.test(appId)) throw new Error(`${label}: invalid app id`);
  const jwt = createAppJwt(appId, privateKey);
  const request = async (path, init = {}) =>
    fetcher(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'User-Agent': 'oss-hub-jenkins-credential-check',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

  const appResponse = await request('/app');
  if (appResponse.status !== 200) {
    throw new Error(
      `${label}: app authentication status ${appResponse.status}`,
    );
  }
  const app = await appResponse.json();
  if (String(app.id) !== appId) throw new Error(`${label}: app id mismatch`);

  const installationResponse = await request(
    `/orgs/${encodeURIComponent(organization)}/installation`,
  );
  if (installationResponse.status !== 200) {
    throw new Error(
      `${label}: installation discovery status ${installationResponse.status}`,
    );
  }
  const installation = await installationResponse.json();
  if (
    String(installation.app_id) !== appId ||
    installation.account?.login?.toLowerCase() !== organization.toLowerCase() ||
    !Number.isSafeInteger(installation.id)
  ) {
    throw new Error(`${label}: installation identity mismatch`);
  }

  const tokenResponse = await request(
    `/app/installations/${installation.id}/access_tokens`,
    { method: 'POST' },
  );
  if (tokenResponse.status !== 201) {
    throw new Error(
      `${label}: installation token status ${tokenResponse.status}`,
    );
  }
  const token = await tokenResponse.json();
  if (typeof token.token !== 'string' || token.token.length === 0) {
    throw new Error(`${label}: installation token missing`);
  }
}

async function main() {
  const [envFile, collectionKeyFile, operationsKeyFile] = process.argv.slice(2);
  if (!envFile || !collectionKeyFile || !operationsKeyFile) {
    throw new Error(
      'usage: validate-github-app-credentials.mjs <env-file> <collection-key-file> <operations-key-file>',
    );
  }
  const [envSource, collectionKey, operationsKey] = await Promise.all([
    readFile(envFile, 'utf8'),
    readFile(collectionKeyFile, 'utf8'),
    readFile(operationsKeyFile, 'utf8'),
  ]);
  const identity = parseDeploymentIdentity(envSource);
  await assertGitHubAppCredential(
    'collection',
    identity.collectionAppId,
    identity.organization,
    collectionKey,
  );
  await assertGitHubAppCredential(
    'operations',
    identity.operationsAppId,
    identity.organization,
    operationsKey,
  );
  console.log('GitHub App credential validation: ok');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'credential validation failed',
    );
    process.exitCode = 1;
  });
}
