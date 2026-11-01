import { Injectable, Logger } from '@nestjs/common';
import { GithubAppClient } from './github-app.client';
import { RepositoryProvisionGithubService } from './repository-provision-github.service';
import { PROVISION_ERROR_CODES } from './repository-provision-state.config';
import { RepositoryProvisionFailure } from './repository-provision-state.error';

export type OwnRepositoryUrlValidationResult =
  | { readonly kind: 'VALID' }
  | { readonly kind: 'INVALID_FORMAT' }
  | { readonly kind: 'NOT_FOUND_OR_PRIVATE' };

const FINAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID,
  PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND,
  PROVISION_ERROR_CODES.OWN_ORGANIZATION_REPOSITORY_INACCESSIBLE,
]);

@Injectable()
export class OwnRepositoryUrlValidationService {
  private readonly logger = new Logger(OwnRepositoryUrlValidationService.name);

  constructor(
    private readonly github: GithubAppClient,
    private readonly repositoryProvisionGithubService: RepositoryProvisionGithubService,
  ) {}

  async validate(
    repositoryUrl: string,
  ): Promise<OwnRepositoryUrlValidationResult> {
    try {
      await this.repositoryProvisionGithubService.resolveOwnGithubRepository(
        this.github,
        repositoryUrl,
      );
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

      this.logger.warn({
        event: 'applications.own-repository-url-validation.skipped',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'VALID' };
    }
  }

  resolve(repositoryUrl: string) {
    return this.repositoryProvisionGithubService.resolveOwnGithubRepository(
      this.github,
      repositoryUrl,
    );
  }
}
