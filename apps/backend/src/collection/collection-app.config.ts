const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_DEADLINE_MS = 30_000;

export class CollectionAppConfigError extends Error {
  readonly code = 'COLLECTION_APP_CONFIG_INVALID';

  constructor(readonly field: string) {
    super(`Invalid Collection App configuration: ${field}`);
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
    apiBaseUrl: 'GITHUB_COLLECTION_APP_API_BASE_URL',
    maxPages: 'GITHUB_COLLECTION_APP_MAX_PAGES',
    deadlineMs: 'GITHUB_COLLECTION_APP_DEADLINE_MS',
  } as const;

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): CollectionAppConfigValues {
    const required = (name: string): string => {
      const value = env[name]?.trim();
      if (!value) throw new CollectionAppConfigError(name);
      return value;
    };
    const positiveInteger = (
      name: string,
      fallback: number,
      maximum: number,
    ): number => {
      const raw = env[name]?.trim();
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
      env[this.envNames.apiBaseUrl]?.trim() || DEFAULT_API_BASE;
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
      privateKey: required(this.envNames.privateKey).replace(/\\n/g, '\n'),
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
