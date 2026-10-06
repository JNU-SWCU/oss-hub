import type {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';
import type { GithubRepositoryMetadata } from './github-app.client';

export interface ProvisionedRepository {
  readonly id: string;
  readonly applicationId: string;
  readonly githubRepositoryId: bigint;
  readonly name: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
}

export interface RepositoryProvisionContext {
  readonly requestId: string;
  readonly requestedConnectionMode: RepositoryConnectionMode;
  readonly requestedRepositoryUrl: string | null;
  readonly requestedByGithubId: bigint | null;
  readonly currentConnectionMode: RepositoryConnectionMode;
  readonly currentRepositoryUrl: string | null;
  readonly applicationId: string;
  readonly applicantGithubId: bigint;
  readonly applicationStatus: ApplicationStatus;
  readonly programId: string;
  readonly programName: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly teamId: string | null;
  readonly subjectName: string;
  readonly repository: ProvisionedRepository | null;

  readonly currentRepositorySource: RepositorySource | null;

  readonly currentMemberGithubLogins: readonly string[];
  readonly membershipFingerprint: string;
}

export interface RepositoryInvitationWork {
  readonly id: string;
  readonly githubLogin: string;
  readonly status: RepositoryInvitationStatus;
  readonly intent: 'GRANT' | 'REVOKE';
}

export interface RecordProvisionedRepositoryInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly connectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly currentConnectionMode: RepositoryConnectionMode;
  readonly currentRepositoryUrl: string | null;
  readonly auditActorGithubId?: bigint;

  readonly source: RepositorySource;
  readonly metadata: GithubRepositoryMetadata;
}

export interface CompleteRepositoryInvitationInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly invitationId: string;
  readonly repositoryId: string;
  readonly expectedStatus: RepositoryInvitationStatus;
  readonly status: Extract<
    RepositoryInvitationStatus,
    'PENDING' | 'SUCCEEDED' | 'REVOKED'
  >;
  readonly now: Date;
}

export interface FailRepositoryInvitationInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly invitationId: string;
  readonly repositoryId: string;
  readonly expectedStatus: RepositoryInvitationStatus;
  readonly intent: 'GRANT' | 'REVOKE';
  readonly final: boolean;
  readonly errorCode: string;
  readonly now: Date;
}

export interface FailRepositoryProvisionJobInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly requestId: string;
  readonly final: boolean;
  readonly errorCode: string;
  readonly nextAttemptAt: Date;
  readonly now: Date;

  readonly expectedMembershipFingerprint?: string;
}

export interface RepositoryProvisionStateStore {
  loadContext(
    jobId: string,
    workerId: string,
    requestId: string,
  ): Promise<RepositoryProvisionContext>;
  recordRepository(
    input: RecordProvisionedRepositoryInput,
  ): Promise<ProvisionedRepository>;
  prepareInvitations(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    githubLogins: readonly string[],
  ): Promise<void>;
  findInvitationWork(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationWork[]>;
  completeInvitation(input: CompleteRepositoryInvitationInput): Promise<void>;
  failInvitation(input: FailRepositoryInvitationInput): Promise<void>;
  recordSupersededRequest(
    applicationId: string,
    requestId: string,
    now: Date,
  ): Promise<void>;
  completeJob(
    jobId: string,
    workerId: string,
    requestId: string,
    repositoryId: string,
    now: Date,
    nextReconciliationAt?: Date,

    expectedMembershipFingerprint?: string,
  ): Promise<void>;
  failJob(input: FailRepositoryProvisionJobInput): Promise<void>;
}
