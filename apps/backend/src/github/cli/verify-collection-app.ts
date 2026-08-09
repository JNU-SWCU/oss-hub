import { createHash } from 'node:crypto';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../../runtime-config/runtime-config';
import { CollectionAppClient } from '../collection-app.client';
import { CollectionAppConfig } from '../collection-app.config';
import { CollectionAppTokenProvider } from '../collection-app.token';
import {
  COLLECTION_LIVE_SMOKE_ENDPOINTS,
  COLLECTION_LIVE_SMOKE_SCHEMA_VERSION,
  CollectionLiveSmokeAlias,
  CollectionLiveSmokeService,
} from '../service/collection-live-smoke.service';

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

/** Typed projection from a RuntimeConfig snapshot. */
export function aliasesFromRuntimeConfig(
  config: RuntimeConfig,
): CollectionLiveSmokeAlias[] {
  const publicValues =
    config.GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const privateValue = config.GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS?.trim();
  if (publicValues.length === 0 || !privateValue)
    throw new Error('Live smoke fixtures are required');
  return [
    ...publicValues.map((value) => parseAlias(value, 'public')),
    parseAlias(privateValue, 'private'),
  ];
}

/** Compatibility façade — one snapshot via loadRuntimeConfig, then project. */
export function aliasesFromEnv(
  env: NodeJS.ProcessEnv,
): CollectionLiveSmokeAlias[] {
  return aliasesFromRuntimeConfig(loadRuntimeConfig(env));
}

async function main(): Promise<void> {
  try {
    const runtimeConfig = loadRuntimeConfig(process.env);
    const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
    const tokens = new CollectionAppTokenProvider(config);
    const client = new CollectionAppClient(config, tokens);
    const output = await new CollectionLiveSmokeService(
      client,
      tokens,
      config.orgLogin,
      aliasesFromRuntimeConfig(runtimeConfig),
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
