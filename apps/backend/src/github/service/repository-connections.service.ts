import { Injectable } from '@nestjs/common';
import { RepositoryConnectionMode, RepositorySource } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import type { RepositoryConnectionResultResponseDto } from '../dto/change-repository-connection.dto';
import type { GithubAppClient } from '../github-app.client';
import {
  REPOSITORY_CONNECTIONS_ERROR_CODES,
  RepositoryConnectionsErrorCode,
} from '../repository-connections-error-code';
import {
  RepositoryConnectionIdentityError,
  type RepositoryConnectionTarget,
  RepositoryConnectionsRepository,
} from '../repository/repository-connections.repository';
import { GithubRepositoryClaimConflictError } from '../repository-provision-state.helpers';
import { RepositoryProvisionFailure } from '../repository-provision.failure';
import { resolveOwnGithubRepository } from '../repository-provision.github';
import type { RepositoryOwnEnrollmentService } from './repository-own-enrollment.service';

export interface ChangeRepositoryConnectionInput {
  readonly applicationId: string;
  readonly actorGithubId: bigint;
  readonly mode: RepositoryConnectionMode;
  readonly url: string | null;
}

@Injectable()
export class RepositoryConnectionsService {
  constructor(
    private readonly repository: Pick<
      RepositoryConnectionsRepository,
      | 'findActorAuthorityByGithubId'
      | 'checkConnectionAccess'
      | 'changeConnection'
    >,
    private readonly github: Pick<
      GithubAppClient,
      'organization' | 'findRepository' | 'findPublicRepository'
    >,
    private readonly collectionEnrollment: Pick<
      RepositoryOwnEnrollmentService,
      'enrollExternalRepository'
    >,
  ) {}

  async changeConnection(
    input: ChangeRepositoryConnectionInput,
    now = new Date(),
  ): Promise<RepositoryConnectionResultResponseDto> {
    const actor = await this.repository.findActorAuthorityByGithubId(
      input.actorGithubId,
    );
    if (actor === null) {
      throw this.error(RepositoryConnectionsErrorCode.FORBIDDEN);
    }
    const access = await this.repository.checkConnectionAccess(
      input.applicationId,
      actor,
    );
    if (access === 'NOT_FOUND') {
      throw this.error(RepositoryConnectionsErrorCode.NOT_FOUND);
    }
    if (access === 'FORBIDDEN') {
      throw this.error(RepositoryConnectionsErrorCode.FORBIDDEN);
    }

    let target: RepositoryConnectionTarget;
    if (input.mode === RepositoryConnectionMode.NEW) {
      target = { mode: RepositoryConnectionMode.NEW };
    } else {
      if (input.url === null) {
        throw this.error(RepositoryConnectionsErrorCode.INVALID_TARGET);
      }
      try {
        const resolved = await resolveOwnGithubRepository(
          this.github,
          input.url,
        );
        target = {
          mode: RepositoryConnectionMode.OWN,
          url: input.url,
          metadata: resolved.repository,
          source:
            resolved.kind === 'EXTERNAL'
              ? RepositorySource.EXTERNAL_PUBLIC
              : RepositorySource.ORG_PROVISIONED,
          externalObservation:
            resolved.kind === 'EXTERNAL'
              ? {
                  defaultBranch: resolved.repository.defaultBranch,
                  archived: resolved.repository.archived,
                }
              : null,
        };
      } catch (error) {
        if (error instanceof RepositoryProvisionFailure) {
          throw this.error(RepositoryConnectionsErrorCode.INVALID_TARGET);
        }
        throw error;
      }
    }

    try {
      const result = await this.repository.changeConnection(
        input.applicationId,
        actor,
        target,
        now,
      );
      switch (result.status) {
        case 'NOT_FOUND':
          throw this.error(RepositoryConnectionsErrorCode.NOT_FOUND);
        case 'FORBIDDEN':
          throw this.error(RepositoryConnectionsErrorCode.FORBIDDEN);
        case 'INVALID_STATE':
          throw this.error(RepositoryConnectionsErrorCode.INVALID_STATE);
        case 'CONNECTED':
        case 'PENDING':
          if (
            target.mode === RepositoryConnectionMode.OWN &&
            target.externalObservation != null
          ) {
            await this.collectionEnrollment.enrollExternalRepository({
              applicantGithubId: result.applicantGithubId,
              githubRepositoryId: target.metadata.githubRepositoryId,
              nameWithOwner: target.metadata.nameWithOwner,
              defaultBranch: target.externalObservation.defaultBranch,
              archived: target.externalObservation.archived,
              observedAt: now,
            });
          }
          return result;
      }
    } catch (error) {
      if (error instanceof RepositoryConnectionIdentityError) {
        throw this.error(RepositoryConnectionsErrorCode.INVALID_TARGET);
      }
      if (error instanceof GithubRepositoryClaimConflictError) {
        throw this.error(RepositoryConnectionsErrorCode.CLAIM_CONFLICT);
      }
      throw error;
    }
  }

  private error(code: RepositoryConnectionsErrorCode): DomainException {
    return new DomainException(REPOSITORY_CONNECTIONS_ERROR_CODES[code]);
  }
}
