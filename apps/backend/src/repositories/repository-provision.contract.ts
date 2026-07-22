import type {
  ApplicationStatus,
  Prisma,
  RepositoryInvitationStatus,
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
  readonly eventId: string;
  readonly eventPayload: Prisma.JsonValue;
  readonly applicationId: string;
  readonly applicationStatus: ApplicationStatus;
  readonly programId: string;
  readonly programName: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly teamId: string | null;
  readonly subjectName: string;
  readonly repository: ProvisionedRepository | null;
}

export interface RepositoryInvitationWork {
  readonly id: string;
  readonly githubLogin: string;
}

export interface RecordProvisionedRepositoryInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly metadata: GithubRepositoryMetadata;
}

export interface CompleteRepositoryInvitationInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly invitationId: string;
  readonly status: Extract<RepositoryInvitationStatus, 'PENDING' | 'SUCCEEDED'>;
  readonly now: Date;
}

export interface FailRepositoryInvitationInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly invitationId: string;
  readonly final: boolean;
  readonly errorCode: string;
  readonly now: Date;
}

export interface FailRepositoryProvisionJobInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly final: boolean;
  readonly errorCode: string;
  readonly nextAttemptAt: Date;
  readonly now: Date;
}

export interface RepositoryProvisionStateStore {
  loadContext(
    jobId: string,
    workerId: string,
  ): Promise<RepositoryProvisionContext>;
  recordRepository(
    input: RecordProvisionedRepositoryInput,
  ): Promise<ProvisionedRepository>;
  prepareInvitations(
    jobId: string,
    workerId: string,
    repositoryId: string,
    githubLogins: readonly string[],
  ): Promise<void>;
  findInvitationWork(
    jobId: string,
    workerId: string,
    repositoryId: string,
  ): Promise<readonly RepositoryInvitationWork[]>;
  completeInvitation(input: CompleteRepositoryInvitationInput): Promise<void>;
  failInvitation(input: FailRepositoryInvitationInput): Promise<void>;
  completeJob(
    jobId: string,
    workerId: string,
    repositoryId: string,
    now: Date,
  ): Promise<void>;
  failJob(input: FailRepositoryProvisionJobInput): Promise<void>;
}
