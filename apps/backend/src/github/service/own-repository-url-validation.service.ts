import { Injectable, Logger } from '@nestjs/common';
import type { GithubAppClient } from '../github-app.client';
import {
  PROVISION_ERROR_CODES,
  RepositoryProvisionFailure,
} from '../repository-provision.failure';
import { resolveOwnGithubRepository } from '../repository-provision.github';

export type OwnRepositoryUrlValidationResult =
  | { readonly kind: 'VALID' }
  | { readonly kind: 'INVALID_FORMAT' }
  | { readonly kind: 'NOT_FOUND_OR_PRIVATE' };

const FINAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID,
  PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND,
  PROVISION_ERROR_CODES.OWN_ORGANIZATION_REPOSITORY_INACCESSIBLE,
]);

/**
 * 지원서 제출 시점의 OWN repo URL 사전 검증(#9 — QA econovation 배치).
 *
 * 승인 시점 편입 체인(`RepositoryProvisionWorker` → `resolveOwnGithubRepository`)과
 * **같은** 판정 로직을 재사용한다 — 별도 검증 규칙을 만들면 제출 시점엔 통과하고
 * 승인 시점엔 막히는(또는 그 반대) 괴리가 생긴다. 새 enrollment 경로가 아니라
 * 기존 판정을 제출 시점에 한 번 더 물어보는 읽기 전용 사전 확인이다.
 */
@Injectable()
export class OwnRepositoryUrlValidationService {
  private readonly logger = new Logger(OwnRepositoryUrlValidationService.name);

  constructor(
    private readonly github: Pick<
      GithubAppClient,
      'organization' | 'findRepository' | 'findPublicRepository'
    >,
  ) {}

  async validate(
    repositoryUrl: string,
  ): Promise<OwnRepositoryUrlValidationResult> {
    try {
      await resolveOwnGithubRepository(this.github, repositoryUrl);
      return { kind: 'VALID' };
    } catch (error) {
      if (
        error instanceof RepositoryProvisionFailure &&
        FINAL_FAILURE_CODES.has(error.code)
      ) {
        return error.code === PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID
          ? { kind: 'INVALID_FORMAT' }
          : { kind: 'NOT_FOUND_OR_PRIVATE' };
      }
      // 일시적 GitHub 장애(rate limit·network·인증 등)는 제출을 막지 않는다 —
      // 학생이 잘못한 게 아니고, 승인 시점 worker가 같은 경로로 다시 확인·재시도한다.
      this.logger.warn({
        event: 'applications.own-repository-url-validation.skipped',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'VALID' };
    }
  }
}
