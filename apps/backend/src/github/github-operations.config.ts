import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type { GithubAppCredentials } from './github-app.token';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { resolvePrivateKeyInput } from '../runtime-config/private-key-file';

const PRIVATE_KEY_FILE_ENV_KEY = 'GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE';

@Injectable()
export class GithubOperationsConfig {
  private readonly logger = new Logger(GithubOperationsConfig.name);

  constructor(
    @Inject(RUNTIME_CONFIG)
    private readonly runtimeConfig: RuntimeConfig = loadRuntimeConfig(
      process.env,
    ),
  ) {}

  requireOrganization(): string {
    const organization = configValue(this.runtimeConfig.GITHUB_APP_ORG);
    if (organization === null) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      );
    }
    return organization;
  }

  requireCredentials(): GithubAppCredentials {
    const organization = this.requireOrganization();
    const appId = configValue(this.runtimeConfig.GITHUB_OPERATIONS_APP_ID);
    const privateKey = this.resolvePrivateKey();
    if (appId === null || privateKey === null) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      );
    }
    return { organization, appId, privateKey };
  }

  private resolvePrivateKey(): string | null {
    try {
      return resolvePrivateKeyInput(
        PRIVATE_KEY_FILE_ENV_KEY,
        this.runtimeConfig.GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE,
        this.runtimeConfig.GITHUB_OPERATIONS_APP_PRIVATE_KEY,
        () =>
          this.logger.warn(
            `${PRIVATE_KEY_FILE_ENV_KEY} takes precedence; deprecated GITHUB_OPERATIONS_APP_PRIVATE_KEY is ignored`,
          ),
      );
    } catch (error) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
        null,
        { cause: error },
      );
    }
  }
}

function configValue(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && value.length > 0 ? value : null;
}
