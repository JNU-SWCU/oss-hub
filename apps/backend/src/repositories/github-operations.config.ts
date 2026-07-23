import { Injectable } from '@nestjs/common';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type { GithubAppCredentials } from './github-app.token';

@Injectable()
export class GithubOperationsConfig {
  requireCredentials(): GithubAppCredentials {
    const organization = environmentValue('GITHUB_APP_ORG');
    const appId = environmentValue('GITHUB_OPERATIONS_APP_ID');
    const privateKey = environmentValue('GITHUB_OPERATIONS_APP_PRIVATE_KEY');
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

function environmentValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}
