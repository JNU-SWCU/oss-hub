import { Injectable } from '@nestjs/common';
import {
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositorySource,
} from '@prisma/client';
import { InvalidRepositoryProvisionEventError } from './repositories.error';
import {
  REPOSITORY_PROVISION_EVENT_TYPE,
  type RepositoryProvisionEventPayload,
} from './repository-provision-event.config';
import { RepositoryProvisionEventService } from './repository-provision-event.service';
import {
  PROVISION_ERROR_CODES,
  PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
  REVOCATION_INVITATION_STATUSES,
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
import {
  RepositoryProvisionStateRepository,
  type MembershipCurrencyCheck,
} from './repository-provision-state.repository';
import { RepositoryUrlService } from './repository-url.service';

@Injectable()
export class RepositoryProvisionStateService implements RepositoryProvisionStateStore {
  constructor(
    private readonly repository: RepositoryProvisionStateRepository,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly repositoryProvisionEventService: RepositoryProvisionEventService,
    private readonly repositoryProvisionStateHelpersRepository: RepositoryProvisionStateHelpersRepository,
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
      team === null ? [] : this.loginsFromTeamMembers(team.members);
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
      membershipFingerprint: this.membershipFingerprint(
        currentMemberGithubLogins,
      ),
      currentRepositorySource: application.repository?.source ?? null,
      repository:
        application.repository === null ||
        job.repositoryId !== application.repository.id
          ? null
          : this.toProvisionedRepository(
              this.repositoryProvisionStateHelpersRepository.assertOwnedRepository(
                application.repository,
              ),
            ),
    };
  }

  async recordRepository(
    input: RecordProvisionedRepositoryInput,
  ): Promise<ProvisionedRepository> {
    const metadataMatchesRepositoryIdentity =
      this.repositoryUrlService.repositoryNameFromNameWithOwner(
        input.metadata.nameWithOwner,
      ) === input.metadata.name &&
      this.repositoryUrlService.repositoryUrlFromNameWithOwner(
        input.metadata.nameWithOwner,
      ) === input.metadata.url;
    return this.toProvisionedRepository(
      await this.repository.recordRepository(
        input,
        metadataMatchesRepositoryIdentity,
      ),
    );
  }

  prepareInvitations(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    githubLogins: readonly string[],
  ): Promise<void> {
    const desired = this.canonicalGithubLogins(githubLogins);
    const desiredSet = new Set(desired);
    return this.repository.prepareInvitations(
      jobId,
      workerId,
      requestId,
      repositoryId,
      (rows) => {
        const known = new Set(
          rows.map((row) => this.canonicalGithubLogin(row.githubLogin)),
        );
        const isRevocation = (status: RepositoryInvitationStatus): boolean =>
          this.invitationIntent(status) === 'REVOKE';
        return {
          createLogins: desired.filter(
            (githubLogin) => !known.has(githubLogin),
          ),
          revokeIds: rows
            .filter(
              (row) =>
                !desiredSet.has(this.canonicalGithubLogin(row.githubLogin)) &&
                !isRevocation(row.status),
            )
            .map((row) => row.id),
          rejoinIds: rows
            .filter(
              (row) =>
                desiredSet.has(this.canonicalGithubLogin(row.githubLogin)) &&
                isRevocation(row.status),
            )
            .map((row) => row.id),
        };
      },
    );
  }

  async findInvitationWork(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationWork[]> {
    const rows = await this.repository.findInvitationWork(
      jobId,
      workerId,
      requestId,
      repositoryId,
    );
    const work = rows.map((row) => ({
      id: row.id,
      githubLogin: row.githubLogin,
      status: row.status,
      intent: this.invitationIntent(row.status),
    }));
    return [
      ...work.filter((item) => item.intent === 'REVOKE'),
      ...work.filter((item) => item.intent === 'GRANT'),
    ];
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
      this.parseHistoryPayload,
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
      this.membershipCurrencyCheck(expectedMembershipFingerprint),
      this.parseHistoryPayload,
    );
  }

  failJob(input: FailRepositoryProvisionJobInput): Promise<void> {
    return this.repository.failJob(
      input,
      this.membershipCurrencyCheck(input.expectedMembershipFingerprint),
      this.parseHistoryPayload,
    );
  }

  private membershipCurrencyCheck(
    expectedMembershipFingerprint: string | undefined,
  ): MembershipCurrencyCheck | undefined {
    return expectedMembershipFingerprint === undefined
      ? undefined
      : (memberLogins) =>
          this.membershipFingerprint(
            this.canonicalGithubLogins(memberLogins),
          ) === expectedMembershipFingerprint;
  }

  private canonicalGithubLogin(login: string | null | undefined): string {
    return (login ?? '').trim().toLowerCase();
  }

  private canonicalGithubLogins(
    logins: readonly (string | null | undefined)[],
  ): readonly string[] {
    return [
      ...new Set(
        logins
          .map((login) => this.canonicalGithubLogin(login))
          .filter((login) => login.length > 0),
      ),
    ].sort();
  }

  private invitationIntent(
    status: RepositoryInvitationStatus,
  ): 'GRANT' | 'REVOKE' {
    return (
      REVOCATION_INVITATION_STATUSES as readonly RepositoryInvitationStatus[]
    ).includes(status)
      ? 'REVOKE'
      : 'GRANT';
  }

  private membershipFingerprint(logins: readonly string[]): string {
    return JSON.stringify(logins);
  }

  private loginsFromTeamMembers(
    members: readonly { readonly user: { readonly nickname: string } }[],
  ): readonly string[] {
    return this.canonicalGithubLogins(
      members.map((member) => member.user.nickname),
    );
  }

  private readonly parseHistoryPayload = (payload: unknown) =>
    this.repositoryProvisionEventService.parseRepositoryProvisionEvent(payload);

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
