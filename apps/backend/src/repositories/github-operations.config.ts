import { Inject, Injectable } from '@nestjs/common';
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

@Injectable()
export class GithubOperationsConfig {
  constructor(
    @Inject(RUNTIME_CONFIG)
    private readonly runtimeConfig: RuntimeConfig = loadRuntimeConfig(
      process.env,
    ),
  ) {}

  requireCredentials(): GithubAppCredentials {
    const organization = configValue(this.runtimeConfig.GITHUB_APP_ORG);
    const appId = configValue(this.runtimeConfig.GITHUB_OPERATIONS_APP_ID);
    const privateKey = configValue(
      this.runtimeConfig.GITHUB_OPERATIONS_APP_PRIVATE_KEY,
    );
    if (organization === null || appId === null || privateKey === null) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      );
    }
    return {
      organization,
      appId,
      privateKey: privateKey.replaceAll('\\n', '\n'),
    };
  }
}

function configValue(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && value.length > 0 ? value : null;
}
