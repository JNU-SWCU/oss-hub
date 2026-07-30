import {
  loadRuntimeConfig,
  type RuntimeConfig,
  type RuntimeEnvKey,
} from '../runtime-config/runtime-config';
import { Logger } from '@nestjs/common';
import { resolvePrivateKeyInput } from '../runtime-config/private-key-file';

const logger = new Logger('CollectionAppConfig');

const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_DEADLINE_MS = 30_000;

export class CollectionAppConfigError extends Error {
  readonly code = 'COLLECTION_APP_CONFIG_INVALID';

  constructor(
    readonly field: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid Collection App configuration: ${field}`, options);
    this.name = 'CollectionAppConfigError';
  }
}

export interface CollectionAppConfigValues {
  readonly appId: string;
  readonly orgLogin: string;
  readonly privateKey: string;
  readonly apiBaseUrl: string;
  readonly maxPages: number;
  readonly deadlineMs: number;
}

export class CollectionAppConfig {
  static readonly envNames = {
    appId: 'GITHUB_COLLECTION_APP_ID',
    orgLogin: 'GITHUB_APP_ORG',
    privateKey: 'GITHUB_COLLECTION_APP_PRIVATE_KEY',
    privateKeyFile: 'GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE',
    apiBaseUrl: 'GITHUB_COLLECTION_APP_API_BASE_URL',
    maxPages: 'GITHUB_COLLECTION_APP_MAX_PAGES',
    deadlineMs: 'GITHUB_COLLECTION_APP_DEADLINE_MS',
  } as const;

  /**
   * Compatibility façade — snapshots env through RuntimeConfig, then projects.
   * Prefer `fromRuntimeConfig` when a snapshot is already in hand (DI/CLI).
   */
  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): CollectionAppConfigValues {
    return this.fromRuntimeConfig(loadRuntimeConfig(env));
  }

  static fromRuntimeConfig(config: RuntimeConfig): CollectionAppConfigValues {
    const required = (name: RuntimeEnvKey): string => {
      const value = config[name]?.trim();
      if (!value) throw new CollectionAppConfigError(name);
      return value;
    };
    const positiveInteger = (
      name: RuntimeEnvKey,
      fallback: number,
      maximum: number,
    ): number => {
      const raw = config[name]?.trim();
      if (!raw) return fallback;
      if (!/^\d+$/.test(raw)) throw new CollectionAppConfigError(name);
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new CollectionAppConfigError(name);
      }
      return value;
    };

    const appId = required(this.envNames.appId);
    if (!/^\d+$/.test(appId))
      throw new CollectionAppConfigError(this.envNames.appId);
    const orgLogin = required(this.envNames.orgLogin);
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(orgLogin)) {
      throw new CollectionAppConfigError(this.envNames.orgLogin);
    }
    const apiBaseUrl =
      config[this.envNames.apiBaseUrl]?.trim() || DEFAULT_API_BASE;
    let parsedBase: URL;
    try {
      parsedBase = new URL(apiBaseUrl);
    } catch {
      throw new CollectionAppConfigError(this.envNames.apiBaseUrl);
    }
    if (
      parsedBase.protocol !== 'https:' ||
      parsedBase.username ||
      parsedBase.password ||
      parsedBase.search ||
      parsedBase.hash
    ) {
      throw new CollectionAppConfigError(this.envNames.apiBaseUrl);
    }

    return {
      appId,
      orgLogin,
      privateKey: resolvePrivateKey(config, this.envNames),
      apiBaseUrl: parsedBase.toString().replace(/\/$/, ''),
      maxPages: positiveInteger(
        this.envNames.maxPages,
        DEFAULT_MAX_PAGES,
        DEFAULT_MAX_PAGES,
      ),
      deadlineMs: positiveInteger(
        this.envNames.deadlineMs,
        DEFAULT_DEADLINE_MS,
        DEFAULT_DEADLINE_MS,
      ),
    };
  }
}

function resolvePrivateKey(
  config: RuntimeConfig,
  envNames: typeof CollectionAppConfig.envNames,
): string {
  let resolved: string | null;
  try {
    resolved = resolvePrivateKeyInput(
      envNames.privateKeyFile,
      config[envNames.privateKeyFile],
      config[envNames.privateKey],
      () =>
        logger.warn(
          `${envNames.privateKeyFile} takes precedence; deprecated ${envNames.privateKey} is ignored`,
        ),
    );
  } catch (error) {
    throw new CollectionAppConfigError(envNames.privateKeyFile, {
      cause: error,
    });
  }
  if (resolved === null) {
    throw new CollectionAppConfigError(envNames.privateKey);
  }
  return resolved;
}
