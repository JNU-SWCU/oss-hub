import {
  loadRuntimeConfig,
  type RuntimeConfig,
  type RuntimeEnvKey,
} from '../platform/runtime-config.config';
import { loadPrivateKeyFileConfig } from '../platform/private-key-file.config';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const COLLECTION_MAX_PAGES = 100;
const COLLECTION_DEADLINE_MS = 30_000;

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

  readonly graphqlUrl?: string;
}

export class CollectionAppConfig {
  static readonly envNames = {
    appId: 'GITHUB_COLLECTION_APP_ID',
    orgLogin: 'GITHUB_APP_ORG',
    privateKeyFile: 'GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE',
  } as const;

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

    const appId = required(this.envNames.appId);
    if (!/^\d+$/.test(appId))
      throw new CollectionAppConfigError(this.envNames.appId);
    const orgLogin = required(this.envNames.orgLogin);
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(orgLogin)) {
      throw new CollectionAppConfigError(this.envNames.orgLogin);
    }

    return {
      appId,
      orgLogin,
      privateKey: resolvePrivateKey(config, this.envNames),
      apiBaseUrl: GITHUB_API_BASE_URL,
      maxPages: COLLECTION_MAX_PAGES,
      deadlineMs: COLLECTION_DEADLINE_MS,
    };
  }
}

export interface CollectionPublicReadConfigValues {
  readonly token: string;
}

export class CollectionPublicReadConfig {
  static readonly envNames = {
    token: 'GITHUB_PUBLIC_READ_TOKEN',
  } as const;

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): CollectionPublicReadConfigValues {
    return this.fromRuntimeConfig(loadRuntimeConfig(env));
  }

  static fromRuntimeConfig(
    config: RuntimeConfig,
  ): CollectionPublicReadConfigValues {
    const required = (name: RuntimeEnvKey): string => {
      const value = config[name]?.trim();
      if (!value) throw new CollectionAppConfigError(name);
      return value;
    };
    return {
      token: required(this.envNames.token),
    };
  }
}

function resolvePrivateKey(
  config: RuntimeConfig,
  envNames: typeof CollectionAppConfig.envNames,
): string {
  const filePath = config[envNames.privateKeyFile]?.trim();
  if (!filePath) {
    throw new CollectionAppConfigError(envNames.privateKeyFile);
  }
  try {
    return loadPrivateKeyFileConfig(envNames.privateKeyFile, filePath);
  } catch (error) {
    throw new CollectionAppConfigError(envNames.privateKeyFile, {
      cause: error,
    });
  }
}

export const COLLECTION_FAILURE_BACKOFF_BASE_MS = 60 * 60 * 1000;

export const COLLECTION_FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
