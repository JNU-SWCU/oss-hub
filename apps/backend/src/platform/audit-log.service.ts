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
export {
  COLLECTION_TRIGGER_AUDIT_ACTIONS,
  createCollectionTriggerAuditMetadata,
  REPOSITORY_PUBLISH_AUDIT_ACTIONS,
  createRepositoryPublishAuditMetadata,
  deriveRepositoryFullName,
  APPLICATION_DECISION_AUDIT_ACTIONS,
  APPLICATION_SUBMITTED_AUDIT_ACTIONS,
  createApplicationDecisionAuditMetadata,
  createApplicationSubmittedAuditMetadata,
  createTeamCreatedAuditMetadata,
  TEAM_CREATED_AUDIT_ACTIONS,
  createProgramCreatedAuditMetadata,
  PROGRAM_CREATED_AUDIT_ACTIONS,
  createProgramDeletionAuditMetadata,
  PROGRAM_DELETION_AUDIT_ACTIONS,
  createTeamDeletedAuditMetadata,
  createTeamMembershipAuditMetadata,
  createTeamRenamedAuditMetadata,
  TEAM_DELETED_AUDIT_ACTIONS,
  TEAM_MEMBERSHIP_AUDIT_ACTIONS,
  TEAM_RENAMED_AUDIT_ACTIONS,
  APPLICATION_REPOSITORY_URL_CHANGED,
  SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS,
  createSubmissionFileCleanupAuditMetadata,
  createTeamJoinedAuditMetadata,
  TEAM_JOINED_AUDIT_ACTIONS,
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
  type AccessAuditAction,
  type AccessAuditMetadata,
  type UserProfileAuditAction,
  type UserProfileAuditMetadata,
  USER_PROFILE_AUDIT_ACTIONS,
  createUserProfileAuditMetadata,
  type UserProfileAuditFieldChange,
  USER_PROFILE_AUDIT_FIELDS,
  type AuditLogRecordInput,
  type IndependentAuthorityAuditAction,
  type IndependentAuthorityAuditMetadata,
  createIndependentAuthorityAuditMetadata,
  type AuditPersonSnapshot,
  type IndependentAuthorityAuditState,
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  INDEPENDENT_AUTHORITY_AUDIT_COMMANDS,
  USER_PHONE_AUDIT_TRANSITIONS,
  createUserPhoneAuditMetadata,
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
