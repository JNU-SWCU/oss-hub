import { Injectable, Logger } from '@nestjs/common';
import { GithubApiCredentials } from './github-api.client';

class ProductionBatchCollectionConfiguredError extends Error {
  override readonly name = 'ProductionBatchCollectionConfiguredError';

  constructor() {
    super('GITHUB_BATCH_LOGINS cannot be enabled in production');
  }
}

/**
 * 수집 인증은 OAuth App client_id:client_secret Basic 단일 경로다.
 * PAT(GITHUB_COLLECTOR_TOKEN)는 지원하지 않으며, 설정돼 있으면 값을 노출하지 않고
 * 시작을 거부한다 — 잘못된 경로가 조용히 동작하는 것을 막기 위함이다.
 */
@Injectable()
export class CollectionConfig {
  private readonly logger = new Logger(CollectionConfig.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';
  private readonly credentials: GithubApiCredentials | null;

  readonly legacyUserCollectionEnabled = !this.isProduction;
  readonly batchLogins: string[];

  constructor() {
    if (process.env.GITHUB_COLLECTOR_TOKEN !== undefined) {
      throw new Error(
        'unsupported configuration: GITHUB_COLLECTOR_TOKEN is not supported',
      );
    }

    this.batchLogins = [
      ...new Set(
        (process.env.GITHUB_BATCH_LOGINS ?? '')
          .split(',')
          .map((login) => login.trim())
          .filter((login) => login.length > 0),
      ),
    ];
    if (this.isProduction && this.batchLogins.length > 0) {
      throw new ProductionBatchCollectionConfiguredError();
    }

    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    if (clientId && clientSecret) {
      this.credentials = { clientId, clientSecret };
    } else {
      this.credentials = null;
      if (this.legacyUserCollectionEnabled) {
        this.logger.warn(
          'GitHub OAuth 환경변수 미설정 — 수집 기능은 구성 전까지 실패합니다.',
        );
      }
    }
  }

  requireCredentials(): GithubApiCredentials {
    if (!this.credentials) {
      throw new Error(
        'GitHub OAuth 환경변수가 없습니다 (GITHUB_OAUTH_CLIENT_ID/SECRET).',
      );
    }
    return this.credentials;
  }
}
