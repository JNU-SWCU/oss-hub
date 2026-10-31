import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { DomainException } from './error-code.error';
import {
  AUDIT_LOG_ERROR_CODES,
  AuditLogErrorCode,
} from './audit-log-error-code.error';
import {
  AuditLogRepository,
  type AuditLogPage,
  type AuditLogRecord,
  type AuditLogRecordInput,
} from './audit-log.repository';
import type { AuditLogListQuery } from './audit-log-query.types';
import {
  COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION,
  type CollectionTriggerAuditMetadata,
  SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
  type SubmissionFileCleanupAuditMetadata,
  ACCESS_AUDIT_SCHEMA_VERSION,
  ACCESS_AUDIT_EVENT_KINDS,
  type AccessAuditMetadataV2,
  APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
  type ApplicationDecisionAuditMetadataV2,
  type IndependentAuthorityAuditMetadata,
  REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION,
  type RepositoryPublishAuditMetadataV2,
  PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION,
  type ProgramLifecycleAuditMetadataV2,
  PROGRAM_DELETION_AUDIT_SCHEMA_VERSION,
  type ProgramDeletionAuditMetadata,
  USER_PROFILE_AUDIT_SCHEMA_VERSION,
  type UserProfileAuditMetadata,
  type UserPhoneAuditMetadata,
  PROGRAM_CREATED_AUDIT_SCHEMA_VERSION,
  type ProgramCreatedAuditMetadata,
  TEAM_CREATED_AUDIT_SCHEMA_VERSION,
  type TeamCreatedAuditMetadata,
  TEAM_JOINED_AUDIT_SCHEMA_VERSION,
  type TeamJoinedAuditMetadata,
  APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
  type ApplicationSubmittedAuditMetadata,
  TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION,
  type TeamMembershipAuditMetadata,
  TEAM_RENAMED_AUDIT_SCHEMA_VERSION,
  type TeamRenamedAuditMetadata,
  TEAM_DELETED_AUDIT_SCHEMA_VERSION,
  type TeamDeletedAuditMetadata,
} from './audit-log-metadata.config';
import type {
  AccessAuditMetadataInput,
  ApplicationDecisionAuditMetadataInput,
  IndependentAuthorityAuditMetadataInput,
  RepositoryPublishAuditMetadataInput,
  ProgramLifecycleAuditMetadataInput,
} from './audit-log.repository';

type AuditLogRecordWriter = Parameters<AuditLogRepository['record']>[1];

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(AuditLogRepository)
    private readonly repository: Pick<
      AuditLogRepository,
      'findActorByGithubId' | 'list' | 'record'
    >,
  ) {}

  async list(
    actorGithubId: bigint,
    query: AuditLogListQuery,
  ): Promise<AuditLogPage> {
    const actor = await this.repository.findActorByGithubId(actorGithubId);
    if (
      actor?.hasAdminAccess !== true ||
      actor.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new DomainException(
        AUDIT_LOG_ERROR_CODES[AuditLogErrorCode.ADMIN_ONLY],
      );
    }
    if (query.from && query.to && query.from > query.to) {
      throw new DomainException(
        AUDIT_LOG_ERROR_CODES[AuditLogErrorCode.INVALID_DATE_RANGE],
      );
    }
    const result = await this.repository.list(query);
    return { ...result, page: query.page, limit: query.limit };
  }

  record(
    input: AuditLogRecordInput,
    writer?: AuditLogRecordWriter,
  ): Promise<AuditLogRecord> {
    return this.repository.record(input, writer);
  }
}

export function createCollectionTriggerAuditMetadata(
  input: Omit<CollectionTriggerAuditMetadata, 'schemaVersion'>,
): CollectionTriggerAuditMetadata {
  return { schemaVersion: COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION, ...input };
}

export function createSubmissionFileCleanupAuditMetadata(
  input: Omit<SubmissionFileCleanupAuditMetadata, 'schemaVersion'>,
): SubmissionFileCleanupAuditMetadata {
  return {
    schemaVersion: SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export function createAccessAuditMetadata(
  input: AccessAuditMetadataInput,
): AccessAuditMetadataV2 {
  return { schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION, ...input };
}

export function createApplicationDecisionAuditMetadata(
  input: ApplicationDecisionAuditMetadataInput,
): ApplicationDecisionAuditMetadataV2 {
  return {
    schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export function createIndependentAuthorityAuditMetadata(
  input: IndependentAuthorityAuditMetadataInput,
): IndependentAuthorityAuditMetadata {
  return {
    schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
    eventKind: ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED,
    ...input,
  };
}

export function createRepositoryPublishAuditMetadata(
  input: RepositoryPublishAuditMetadataInput,
): RepositoryPublishAuditMetadataV2 {
  return { schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION, ...input };
}

const GITHUB_REPOSITORY_URL_PATTERN =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/;

export function deriveRepositoryFullName(name: string, url: string): string {
  const match = GITHUB_REPOSITORY_URL_PATTERN.exec(url);
  return match ? `${match[1]}/${match[2]}` : name;
}

export function createProgramLifecycleAuditMetadata(
  input: ProgramLifecycleAuditMetadataInput,
): ProgramLifecycleAuditMetadataV2 {
  return { schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION, ...input };
}

export function createProgramDeletionAuditMetadata(
  input: Omit<ProgramDeletionAuditMetadata, 'schemaVersion'>,
): ProgramDeletionAuditMetadata {
  return { schemaVersion: PROGRAM_DELETION_AUDIT_SCHEMA_VERSION, ...input };
}

export function createUserProfileAuditMetadata(
  input: Omit<UserProfileAuditMetadata, 'schemaVersion'>,
): UserProfileAuditMetadata {
  return { schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION, ...input };
}

export function createUserPhoneAuditMetadata(
  input: Omit<UserPhoneAuditMetadata, 'schemaVersion'>,
): UserPhoneAuditMetadata {
  return { schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION, ...input };
}

export function createProgramCreatedAuditMetadata(
  input: Omit<ProgramCreatedAuditMetadata, 'schemaVersion'>,
): ProgramCreatedAuditMetadata {
  return { schemaVersion: PROGRAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
}

export function createTeamCreatedAuditMetadata(
  input: Omit<TeamCreatedAuditMetadata, 'schemaVersion'>,
): TeamCreatedAuditMetadata {
  return { schemaVersion: TEAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
}

export function createTeamJoinedAuditMetadata(
  input: Omit<TeamJoinedAuditMetadata, 'schemaVersion'>,
): TeamJoinedAuditMetadata {
  return { schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION, ...input };
}

export function createApplicationSubmittedAuditMetadata(
  input: Omit<ApplicationSubmittedAuditMetadata, 'schemaVersion'>,
): ApplicationSubmittedAuditMetadata {
  return {
    schemaVersion: APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export function createTeamMembershipAuditMetadata(
  input: Omit<TeamMembershipAuditMetadata, 'schemaVersion'>,
): TeamMembershipAuditMetadata {
  return { schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION, ...input };
}

export function createTeamRenamedAuditMetadata(
  input: Omit<TeamRenamedAuditMetadata, 'schemaVersion'>,
): TeamRenamedAuditMetadata {
  return { schemaVersion: TEAM_RENAMED_AUDIT_SCHEMA_VERSION, ...input };
}

export function createTeamDeletedAuditMetadata(
  input: Omit<TeamDeletedAuditMetadata, 'schemaVersion'>,
): TeamDeletedAuditMetadata {
  return { schemaVersion: TEAM_DELETED_AUDIT_SCHEMA_VERSION, ...input };
}
