import type {
  ApplicationStatus,
  Prisma,
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
  readonly eventId: string;
  readonly eventPayload: Prisma.JsonValue;
  readonly applicationId: string;
  readonly applicantGithubId: bigint;
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
  // OWN 연결이 조직 밖 저장소(EXTERNAL)로 판명되면 반드시 EXTERNAL_PUBLIC을 넘겨야
  // 한다 — 그래야 이 행이 이미 있다고 보고 종료하는 enrollExternalRepository의
  // updateMany(where: { source: 'EXTERNAL_PUBLIC' })가 같은 행을 잡는다(#617 단계 D).
  readonly source: RepositorySource;
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
    nextReconciliationAt?: Date,
  ): Promise<void>;
  failJob(input: FailRepositoryProvisionJobInput): Promise<void>;
}
