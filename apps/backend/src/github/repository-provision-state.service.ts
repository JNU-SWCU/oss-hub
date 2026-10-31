import { Injectable } from '@nestjs/common';
import { RepositoryConnectionMode, RepositorySource } from '@prisma/client';
import { InvalidRepositoryProvisionEventError } from './repositories.error';
import {
  REPOSITORY_PROVISION_EVENT_TYPE,
  type RepositoryProvisionEventPayload,
} from './repository-provision-event.config';
import { RepositoryProvisionEventService } from './repository-provision-event.service';
import {
  PROVISION_ERROR_CODES,
  PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
} from './repository-provision-state.config';
import { RepositoryProvisionFailure } from './repository-provision-state.error';
import {
  RepositoryProvisionStateHelpersRepository,
  type CompleteRepositoryInvitationInput,
  type FailRepositoryInvitationInput,
  type FailRepositoryProvisionJobInput,
  type OwnedProvisionedRepositoryRow,
  type ProvisionedRepository,
  type RecordProvisionedRepositoryInput,
  type RepositoryInvitationWork,
  type RepositoryProvisionContext,
  type RepositoryProvisionStateStore,
} from './repository-provision-state-helpers.repository';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryUrlService } from './repository-url.service';

@Injectable()
export class RepositoryProvisionStateService implements RepositoryProvisionStateStore {
  constructor(
    private readonly repository: RepositoryProvisionStateRepository,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly repositoryProvisionEventService: RepositoryProvisionEventService,
  ) {}

  async loadContext(
    jobId: string,
    workerId: string,
    requestId: string,
  ): Promise<RepositoryProvisionContext> {
    const { job, event } = await this.repository.loadContext(
      jobId,
      workerId,
      requestId,
    );
    const application = job.application;
    if (event === null) {
      throw RepositoryProvisionFailure.final(
        PROVISION_ERROR_CODES.INVALID_EVENT,
      );
    }
    let requested: RepositoryProvisionEventPayload;
    try {
      if (
        event.type !== REPOSITORY_PROVISION_EVENT_TYPE ||
        event.aggregateType !== 'Application' ||
        event.aggregateId !== application.id
      ) {
        throw new InvalidRepositoryProvisionEventError();
      }
      requested =
        this.repositoryProvisionEventService.parseRepositoryProvisionEvent(
          event.payload,
        );
      if (
        requested.applicationId !== application.id ||
        requested.programId !== application.programId ||
        (requested.teamId !== null && requested.teamId !== application.teamId)
      ) {
        throw new InvalidRepositoryProvisionEventError();
      }
    } catch (error) {
      if (error instanceof InvalidRepositoryProvisionEventError) {
        throw RepositoryProvisionFailure.final(
          PROVISION_ERROR_CODES.INVALID_EVENT,
        );
      }
      throw error;
    }
    const team = application.team;
    const requiresManagedMembership =
      application.repository === null
        ? requested.repositoryConnectionMode === RepositoryConnectionMode.NEW
        : application.repository.source === RepositorySource.ORG_PROVISIONED;
    if (team === null && requiresManagedMembership) {
      throw RepositoryProvisionFailure.final(
        PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
      );
    }

    const currentMemberGithubLogins =
      team === null
        ? []
        : RepositoryProvisionStateHelpersRepository.loginsFromTeamMembers(
            team.members,
          );
    return {
      requestId: event.id,
      requestedConnectionMode: requested.repositoryConnectionMode,
      requestedRepositoryUrl: requested.repositoryUrl,
      requestedByGithubId:
        requested.requestedByGithubId == null
          ? null
          : BigInt(requested.requestedByGithubId),
      currentConnectionMode: application.repositoryConnectionMode,
      currentRepositoryUrl: application.repositoryUrl,
      applicationId: application.id,
      applicantGithubId: application.applicant.githubId,
      applicationStatus: application.status,
      programId: application.programId,
      programName: application.program.name,
      repositoryProvisioningEnabled:
        application.program.repositoryProvisioningEnabled,
      teamId: application.teamId,
      subjectName: team?.name ?? application.applicant.nickname,
      currentMemberGithubLogins,
      membershipFingerprint:
        RepositoryProvisionStateHelpersRepository.membershipFingerprint(
          currentMemberGithubLogins,
        ),
      currentRepositorySource: application.repository?.source ?? null,
      repository:
        application.repository === null ||
        job.repositoryId !== application.repository.id
          ? null
          : this.toProvisionedRepository(
              RepositoryProvisionStateHelpersRepository.assertOwnedRepository(
                application.repository,
              ),
            ),
    };
  }

  async recordRepository(
    input: RecordProvisionedRepositoryInput,
  ): Promise<ProvisionedRepository> {
    return this.toProvisionedRepository(
      await this.repository.recordRepository(input),
    );
  }

  prepareInvitations(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    githubLogins: readonly string[],
  ): Promise<void> {
    return this.repository.prepareInvitations(
      jobId,
      workerId,
      requestId,
      repositoryId,
      githubLogins,
    );
  }

  findInvitationWork(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationWork[]> {
    return this.repository.findInvitationWork(
      jobId,
      workerId,
      requestId,
      repositoryId,
    );
  }

  completeInvitation(input: CompleteRepositoryInvitationInput): Promise<void> {
    return this.repository.completeInvitation(input);
  }

  failInvitation(input: FailRepositoryInvitationInput): Promise<void> {
    return this.repository.failInvitation(input);
  }

  recordSupersededRequest(
    applicationId: string,
    requestId: string,
    now: Date,
  ): Promise<void> {
    return this.repository.recordSupersededRequest(
      applicationId,
      requestId,
      now,
    );
  }

  completeJob(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    now: Date,
    nextReconciliationAt?: Date,
    expectedMembershipFingerprint?: string,
  ): Promise<void> {
    return this.repository.completeJob(
      jobId,
      workerId,
      requestId,
      repositoryId,
      now,
      nextReconciliationAt,
      expectedMembershipFingerprint,
    );
  }

  failJob(input: FailRepositoryProvisionJobInput): Promise<void> {
    return this.repository.failJob(input);
  }

  private toProvisionedRepository(
    row: OwnedProvisionedRepositoryRow,
  ): ProvisionedRepository {
    return {
      id: row.id,
      applicationId: row.applicationId,
      githubRepositoryId: row.githubRepositoryId,
      name: this.repositoryUrlService.repositoryNameFromNameWithOwner(
        row.nameWithOwner,
      ),
      url: this.repositoryUrlService.repositoryUrlFromNameWithOwner(
        row.nameWithOwner,
      ),
      visibility: row.visibility,
    };
  }
}
