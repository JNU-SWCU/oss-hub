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

export interface CollectionPublicReadConfigValues {
  readonly token: string;
}

/**
 * 외부 public 저장소 수집 전용 서비스 계정 fine-grained PAT 설정. GitHub GraphQL v4는
 * OAuth App client_id:client_secret Basic Auth를 받지 않고(REST 전용 미인증 한도 상향
 * 기전), 조직 설치 범위 밖 저장소를 REST·GraphQL 양쪽에서 읽는 이 수집 경로는 실제
 * 인증 주체에 묶인 bearer 토큰을 요구하므로 PAT 하나로 통일한다. fine-grained PAT은
 * 스코프 선택과 무관하게 public repo 읽기를 항상 포함한다.
 *
 * 기존 3종 GitHub 자격증명과 달리 org 수집 경로가 이 값 없이도 계속 동작해야 하므로
 * `CollectionAppConfig.fromRuntimeConfig`가 아니라 별도 accessor로 분리했다 — 모듈
 * 부트스트랩에서 무조건 required로 만들지 않고, 외부 수집이 실제로 시도되는 지점에서만
 * 이 accessor를 호출해 부재를 명시적으로 실패시킨다.
 */
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
