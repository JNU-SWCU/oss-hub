import { createHash } from 'node:crypto';
import { CollectionAppClient } from '../collection-app.client';
import { CollectionAppConfig } from '../collection-app.config';
import { CollectionAppTokenProvider } from '../collection-app.token';
import {
  COLLECTION_LIVE_SMOKE_ENDPOINTS,
  COLLECTION_LIVE_SMOKE_SCHEMA_VERSION,
  CollectionLiveSmokeAlias,
  CollectionLiveSmokeService,
} from '../collection-live-smoke.service';

const PUBLIC_ALIASES_ENV = 'GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES';
const PRIVATE_ALIAS_ENV = 'GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS';

function parseAlias(
  value: string,
  visibility: 'public' | 'private',
): CollectionLiveSmokeAlias {
  const separator = value.indexOf('=');
  const label = value.slice(0, separator).trim();
  const repository = value.slice(separator + 1).trim();
  if (separator < 1 || !/^[a-z][a-z0-9-]*$/.test(label) || !repository) {
    throw new Error('Invalid live smoke alias configuration');
  }
  return { label, repository, visibility };
}

export function aliasesFromEnv(
  env: NodeJS.ProcessEnv,
): CollectionLiveSmokeAlias[] {
  const publicValues =
    env[PUBLIC_ALIASES_ENV]?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const privateValue = env[PRIVATE_ALIAS_ENV]?.trim();
  if (publicValues.length === 0 || !privateValue)
    throw new Error('Live smoke fixtures are required');
  return [
    ...publicValues.map((value) => parseAlias(value, 'public')),
    parseAlias(privateValue, 'private'),
  ];
}

async function main(): Promise<void> {
  try {
    const config = CollectionAppConfig.fromEnv();
    const tokens = new CollectionAppTokenProvider(config);
    const client = new CollectionAppClient(config, tokens);
    const output = await new CollectionLiveSmokeService(
      client,
      tokens,
      config.orgLogin,
      aliasesFromEnv(process.env),
    ).verify();
    process.stdout.write(`${JSON.stringify(output)}\n`);
    if (output.result !== 'PASS') process.exitCode = 1;
  } catch {
    const normalized = JSON.stringify({ status: 'FAIL', aliases: [] });
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: COLLECTION_LIVE_SMOKE_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        aliases: [],
        endpointCategories: COLLECTION_LIVE_SMOKE_ENDPOINTS,
        normalizedStatus: 'FAIL',
        complete: false,
        idempotent: false,
        digest: createHash('sha256').update(normalized).digest('hex'),
        result: 'FAIL',
      })}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
