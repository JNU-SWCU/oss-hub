import {
  RepositoryConnectionMode,
  AccountStatus,
  StaffAccessRequestStatus,
  ApplicationStatus,
  MemberKind,
  RepositoryVisibility,
  ProgramLifecycle,
} from '@prisma/client';
import {
  ApplicationRepositoryUrlAuditMetadataView,
  RepositoryConnectionAuditMetadata,
  REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION,
  RepositoryConnectionAuditMetadataView,
  RepositoryConnectionAuditState,
} from './repository-audit-metadata.config';
import type { AuthorityLabel } from '../users/authority-label.types';
import { InvalidAuditLogMetadataError } from './audit-log-error-code.error';
import {
  CollectionTriggerAuditMetadataView,
  COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION,
  SubmissionFileCleanupAuditMetadata,
  SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
  AccessAuditMetadataView,
  ACCESS_AUDIT_SCHEMA_VERSION,
  ACCESS_AUDIT_SCHEMA_VERSION_V1,
  AccessAuditMetadata,
  ACCESS_AUDIT_EVENT_KINDS,
  AuditPersonSnapshot,
  AccessAuditState,
  ApplicationDecisionAuditMetadataView,
  APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
  APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1,
  IndependentAuthorityAuditMetadataView,
  IndependentAuthorityAuditMetadata,
  IndependentAuthorityAuditCommand,
  INDEPENDENT_AUTHORITY_AUDIT_COMMANDS,
  IndependentAuthorityAuditState,
  RepositoryPublishAuditMetadataView,
  REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION,
  REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1,
  RepositoryPublishAuditVisibilityState,
  ProgramLifecycleAuditMetadataView,
  PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION,
  PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1,
  ProgramDeletionAuditMetadataView,
  PROGRAM_DELETION_AUDIT_SCHEMA_VERSION,
  ProgramDeletionAuditBlockingCounts,
  UserProfileAuditMetadataView,
  USER_PROFILE_AUDIT_SCHEMA_VERSION,
  AuditActorSnapshot,
  UserProfileAuditFieldChange,
  USER_PROFILE_AUDIT_FIELDS,
  UserPhoneAuditTransition,
  USER_PHONE_AUDIT_TRANSITIONS,
  TeamDeletedAuditMetadataView,
  TEAM_DELETED_AUDIT_SCHEMA_VERSION,
  TeamDeletedAuditCounts,
  TeamRenamedAuditMetadataView,
  TEAM_RENAMED_AUDIT_SCHEMA_VERSION,
  TeamMembershipAuditMetadataView,
  TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION,
  ProgramCreatedAuditMetadataView,
  PROGRAM_CREATED_AUDIT_SCHEMA_VERSION,
  TeamCreatedAuditMetadataView,
  TEAM_CREATED_AUDIT_SCHEMA_VERSION,
  TeamJoinedAuditMetadataView,
  TEAM_JOINED_AUDIT_SCHEMA_VERSION,
  ApplicationSubmittedAuditMetadataView,
  APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
  TeamMembershipAuditOperation,
  TEAM_MEMBERSHIP_AUDIT_OPERATIONS,
  AuditLogMetadataEvidence,
  AuditLogMetadataView,
  type CollectionTriggerAuditMetadata,
  type AccessAuditMetadataV2,
  type ApplicationDecisionAuditMetadataV2,
  type RepositoryPublishAuditMetadataV2,
  type ProgramLifecycleAuditMetadataV2,
  type ProgramDeletionAuditMetadata,
  type UserProfileAuditMetadata,
  type UserPhoneAuditMetadata,
  type ProgramCreatedAuditMetadata,
  type TeamCreatedAuditMetadata,
  type TeamJoinedAuditMetadata,
  type ApplicationSubmittedAuditMetadata,
  type TeamMembershipAuditMetadata,
  type TeamRenamedAuditMetadata,
  type TeamDeletedAuditMetadata,
} from './audit-log-metadata.config';
import { Injectable } from '@nestjs/common';
import {
  type AccessAuditMetadataInput,
  type ApplicationDecisionAuditMetadataInput,
  type IndependentAuthorityAuditMetadataInput,
  type RepositoryPublishAuditMetadataInput,
  type ProgramLifecycleAuditMetadataInput,
} from './audit-log.repository';

@Injectable()
export class AuditLogMetadataService {
  createCollectionTriggerAuditMetadata(
    input: Omit<CollectionTriggerAuditMetadata, 'schemaVersion'>,
  ): CollectionTriggerAuditMetadata {
    return { schemaVersion: COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION, ...input };
  }

  createSubmissionFileCleanupAuditMetadata(
    input: Omit<SubmissionFileCleanupAuditMetadata, 'schemaVersion'>,
  ): SubmissionFileCleanupAuditMetadata {
    return {
      schemaVersion: SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
      ...input,
    };
  }

  createAccessAuditMetadata(
    input: AccessAuditMetadataInput,
  ): AccessAuditMetadataV2 {
    return { schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION, ...input };
  }

  createApplicationDecisionAuditMetadata(
    input: ApplicationDecisionAuditMetadataInput,
  ): ApplicationDecisionAuditMetadataV2 {
    return {
      schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
      ...input,
    };
  }

  createIndependentAuthorityAuditMetadata(
    input: IndependentAuthorityAuditMetadataInput,
  ): IndependentAuthorityAuditMetadata {
    return {
      schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
      eventKind: ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED,
      ...input,
    };
  }

  createRepositoryPublishAuditMetadata(
    input: RepositoryPublishAuditMetadataInput,
  ): RepositoryPublishAuditMetadataV2 {
    return { schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION, ...input };
  }

  deriveRepositoryFullName(name: string, url: string): string {
    const match = GITHUB_REPOSITORY_URL_PATTERN.exec(url);
    return match ? `${match[1]}/${match[2]}` : name;
  }

  createProgramLifecycleAuditMetadata(
    input: ProgramLifecycleAuditMetadataInput,
  ): ProgramLifecycleAuditMetadataV2 {
    return { schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION, ...input };
  }

  createProgramDeletionAuditMetadata(
    input: Omit<ProgramDeletionAuditMetadata, 'schemaVersion'>,
  ): ProgramDeletionAuditMetadata {
    return { schemaVersion: PROGRAM_DELETION_AUDIT_SCHEMA_VERSION, ...input };
  }

  createUserProfileAuditMetadata(
    input: Omit<UserProfileAuditMetadata, 'schemaVersion'>,
  ): UserProfileAuditMetadata {
    return { schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION, ...input };
  }

  createUserPhoneAuditMetadata(
    input: Omit<UserPhoneAuditMetadata, 'schemaVersion'>,
  ): UserPhoneAuditMetadata {
    return { schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION, ...input };
  }

  createProgramCreatedAuditMetadata(
    input: Omit<ProgramCreatedAuditMetadata, 'schemaVersion'>,
  ): ProgramCreatedAuditMetadata {
    return { schemaVersion: PROGRAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
  }

  createTeamCreatedAuditMetadata(
    input: Omit<TeamCreatedAuditMetadata, 'schemaVersion'>,
  ): TeamCreatedAuditMetadata {
    return { schemaVersion: TEAM_CREATED_AUDIT_SCHEMA_VERSION, ...input };
  }

  createTeamJoinedAuditMetadata(
    input: Omit<TeamJoinedAuditMetadata, 'schemaVersion'>,
  ): TeamJoinedAuditMetadata {
    return { schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION, ...input };
  }

  createApplicationSubmittedAuditMetadata(
    input: Omit<ApplicationSubmittedAuditMetadata, 'schemaVersion'>,
  ): ApplicationSubmittedAuditMetadata {
    return {
      schemaVersion: APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
      ...input,
    };
  }

  createTeamMembershipAuditMetadata(
    input: Omit<TeamMembershipAuditMetadata, 'schemaVersion'>,
  ): TeamMembershipAuditMetadata {
    return { schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION, ...input };
  }

  createTeamRenamedAuditMetadata(
    input: Omit<TeamRenamedAuditMetadata, 'schemaVersion'>,
  ): TeamRenamedAuditMetadata {
    return { schemaVersion: TEAM_RENAMED_AUDIT_SCHEMA_VERSION, ...input };
  }

  createTeamDeletedAuditMetadata(
    input: Omit<TeamDeletedAuditMetadata, 'schemaVersion'>,
  ): TeamDeletedAuditMetadata {
    return { schemaVersion: TEAM_DELETED_AUDIT_SCHEMA_VERSION, ...input };
  }

  private parseCollectionTriggerAuditMetadata(
    value: unknown,
  ): CollectionTriggerAuditMetadataView | null {
    return this.isJsonObject(value) &&
      value.schemaVersion === COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION &&
      typeof value.runId === 'string'
      ? { schemaVersion: COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION }
      : null;
  }

  private parseSubmissionFileCleanupAuditMetadata(
    value: unknown,
  ): SubmissionFileCleanupAuditMetadata | null {
    return this.isJsonObject(value) &&
      value.schemaVersion === SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION &&
      typeof value.fileId === 'string'
      ? {
          schemaVersion: SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
          fileId: value.fileId,
        }
      : null;
  }

  private parseAccessAuditMetadata(
    value: unknown,
  ): AccessAuditMetadataView | null {
    if (!this.isAccessAuditMetadata(value)) return null;
    const base = {
      eventKind: value.eventKind,
      actor: personView(value.actor),
      before: accessStateView(value.before),
      after: accessStateView(value.after),
    };
    return value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION
      ? {
          ...base,
          schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
          target: personView(value.target),
        }
      : { ...base, schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION_V1 };
  }

  private isAccessAuditMetadata(value: unknown): value is AccessAuditMetadata {
    if (
      !this.isJsonObject(value) ||
      !this.isPerson(value.actor) ||
      !this.isAccessState(value.before) ||
      !this.isAccessState(value.after)
    )
      return false;
    if (value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION) {
      if (!this.isPerson(value.target)) return false;
    } else if (value.schemaVersion !== ACCESS_AUDIT_SCHEMA_VERSION_V1)
      return false;
    switch (value.eventKind) {
      case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED:
        return typeof value.rejectionReason === 'string';
      case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED:
      case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED:
      case ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_RESTORED:
      case ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED:
      case ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED:
        return !('rejectionReason' in value);
      default:
        return false;
    }
  }

  private isPerson(value: unknown): value is AuditPersonSnapshot {
    return (
      this.isJsonObject(value) &&
      (typeof value.displayName === 'string' || value.displayName === null) &&
      typeof value.githubLogin === 'string'
    );
  }

  private isAccessState(value: unknown): value is AccessAuditState {
    return (
      this.isJsonObject(value) &&
      isRole(value.role) &&
      isAccountStatus(value.accountStatus) &&
      isRequestStatus(value.requestStatus)
    );
  }

  private parseApplicationDecisionAuditMetadata(
    value: unknown,
  ): ApplicationDecisionAuditMetadataView | null {
    if (
      !this.isJsonObject(value) ||
      !this.isState(value.before) ||
      !this.isState(value.after) ||
      'rejectionReason' in value
    )
      return null;
    const base = {
      before: { status: value.before.status },
      after: { status: value.after.status },
    };
    if (value.schemaVersion === APPLICATION_DECISION_AUDIT_SCHEMA_VERSION) {
      return typeof value.programName === 'string' &&
        typeof value.applicantGithubLogin === 'string'
        ? {
            ...base,
            schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
            programName: value.programName,
            applicantGithubLogin: value.applicantGithubLogin,
          }
        : null;
    }
    return value.schemaVersion === APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1
      ? {
          ...base,
          schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1,
        }
      : null;
  }

  private isState(
    value: unknown,
  ): value is { readonly status: ApplicationStatus } {
    return (
      this.isJsonObject(value) &&
      Object.values(ApplicationStatus).some((status) => status === value.status)
    );
  }

  private parseIndependentAuthorityAuditMetadata(
    value: unknown,
  ): IndependentAuthorityAuditMetadataView | null {
    if (!this.isIndependentAuthorityAuditMetadata(value)) return null;
    return {
      schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION,
      eventKind: ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED,
      command: value.command,
      actor: personView(value.actor),
      target: personView(value.target),
      before: stateView(value.before),
      after: stateView(value.after),
    };
  }

  private isIndependentAuthorityAuditMetadata(
    value: unknown,
  ): value is IndependentAuthorityAuditMetadata {
    return (
      this.isJsonObject(value) &&
      hasExactKeys(value, INDEPENDENT_AUTHORITY_AUDIT_METADATA_KEYS) &&
      value.schemaVersion === ACCESS_AUDIT_SCHEMA_VERSION &&
      value.eventKind ===
        ACCESS_AUDIT_EVENT_KINDS.INDEPENDENT_AUTHORITY_CHANGED &&
      isCommand(value.command) &&
      this.isPersonForIndependentAuthorityAuditMetadata(value.actor) &&
      this.isPersonForIndependentAuthorityAuditMetadata(value.target) &&
      this.isStateForIndependentAuthorityAuditMetadata(value.before) &&
      this.isStateForIndependentAuthorityAuditMetadata(value.after)
    );
  }

  private isPersonForIndependentAuthorityAuditMetadata(
    value: unknown,
  ): value is AuditPersonSnapshot {
    return (
      this.isJsonObject(value) &&
      hasExactKeys(value, AUDIT_PERSON_KEYS) &&
      (typeof value.displayName === 'string' || value.displayName === null) &&
      typeof value.githubLogin === 'string'
    );
  }

  private isStateForIndependentAuthorityAuditMetadata(
    value: unknown,
  ): value is IndependentAuthorityAuditState {
    return (
      this.isJsonObject(value) &&
      hasExactKeys(value, INDEPENDENT_AUTHORITY_AUDIT_STATE_KEYS) &&
      (value.memberKind === null ||
        value.memberKind === MemberKind.STUDENT ||
        value.memberKind === MemberKind.STAFF) &&
      typeof value.hasStaffAccess === 'boolean' &&
      typeof value.hasAdminAccess === 'boolean' &&
      (value.role === null ||
        value.role === 'STUDENT' ||
        value.role === 'STAFF' ||
        value.role === 'ADMIN') &&
      (value.accountStatus === AccountStatus.ACTIVE ||
        value.accountStatus === AccountStatus.DEACTIVATED)
    );
  }

  private parseRepositoryPublishAuditMetadata(
    value: unknown,
  ): RepositoryPublishAuditMetadataView | null {
    if (
      !this.isJsonObject(value) ||
      typeof value.repositoryId !== 'string' ||
      !this.isVisibilityState(value.before) ||
      !this.isVisibilityState(value.after) ||
      typeof value.after.publishedAt !== 'string'
    )
      return null;
    const base = {
      repositoryId: value.repositoryId,
      before: { visibility: value.before.visibility },
      after: {
        visibility: value.after.visibility,
        publishedAt: value.after.publishedAt,
      },
    };
    if (value.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION) {
      return typeof value.repositoryFullName === 'string'
        ? {
            ...base,
            schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION,
            repositoryFullName: value.repositoryFullName,
          }
        : null;
    }
    return value.schemaVersion === REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1
      ? { ...base, schemaVersion: REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION_V1 }
      : null;
  }

  private isVisibilityState(
    value: unknown,
  ): value is RepositoryPublishAuditVisibilityState & {
    readonly publishedAt?: string;
  } {
    return (
      this.isJsonObject(value) &&
      (value.visibility === RepositoryVisibility.PRIVATE ||
        value.visibility === RepositoryVisibility.PUBLIC)
    );
  }

  private parseProgramLifecycleAuditMetadata(
    value: unknown,
  ): ProgramLifecycleAuditMetadataView | null {
    if (
      !this.isJsonObject(value) ||
      !this.isLifecycleState(value.before) ||
      !this.isLifecycleState(value.after)
    )
      return null;
    const base = {
      before: { lifecycle: value.before.lifecycle },
      after: { lifecycle: value.after.lifecycle },
    };
    if (value.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION) {
      return typeof value.programName === 'string'
        ? {
            ...base,
            schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION,
            programName: value.programName,
          }
        : null;
    }
    return value.schemaVersion === PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1
      ? { ...base, schemaVersion: PROGRAM_LIFECYCLE_AUDIT_SCHEMA_VERSION_V1 }
      : null;
  }

  private isLifecycleState(
    value: unknown,
  ): value is { readonly lifecycle: ProgramLifecycle } {
    return (
      this.isJsonObject(value) &&
      (value.lifecycle === ProgramLifecycle.PUBLISHED ||
        value.lifecycle === ProgramLifecycle.ARCHIVED)
    );
  }

  private parseProgramDeletionAuditMetadata(
    value: unknown,
  ): ProgramDeletionAuditMetadataView | null {
    if (
      !this.isJsonObject(value) ||
      value.schemaVersion !== PROGRAM_DELETION_AUDIT_SCHEMA_VERSION ||
      typeof value.programName !== 'string' ||
      !isLifecycle(value.lifecycle) ||
      !this.isBlockingCounts(value.blockingCounts)
    )
      return null;
    return {
      schemaVersion: PROGRAM_DELETION_AUDIT_SCHEMA_VERSION,
      programName: value.programName,
      lifecycle: value.lifecycle,
      blockingCounts: { ...value.blockingCounts },
    };
  }

  private isBlockingCounts(
    value: unknown,
  ): value is ProgramDeletionAuditBlockingCounts {
    return (
      this.isJsonObject(value) &&
      typeof value.applications === 'number' &&
      typeof value.teams === 'number' &&
      typeof value.submissions === 'number' &&
      typeof value.boardPosts === 'number'
    );
  }

  private parseUserProfileAuditMetadata(
    value: unknown,
  ): UserProfileAuditMetadataView | null {
    if (
      this.isJsonObject(value) &&
      hasExactKeys(value, USER_PHONE_AUDIT_METADATA_KEYS) &&
      value.schemaVersion === USER_PROFILE_AUDIT_SCHEMA_VERSION &&
      this.isPersonForUserProfileAuditMetadata(value.actor) &&
      this.isPersonForUserProfileAuditMetadata(value.target) &&
      isPhoneTransition(value.transition)
    ) {
      return {
        schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
        actor: personViewForUserProfileAuditMetadata(value.actor),
        target: personViewForUserProfileAuditMetadata(value.target),
        transition: value.transition,
      };
    }
    if (
      !this.isJsonObject(value) ||
      !hasExactKeys(value, USER_PROFILE_AUDIT_METADATA_KEYS) ||
      value.schemaVersion !== USER_PROFILE_AUDIT_SCHEMA_VERSION ||
      !this.isPersonForUserProfileAuditMetadata(value.actor) ||
      !this.isPersonForUserProfileAuditMetadata(value.target) ||
      !Array.isArray(value.changes) ||
      !value.changes.every((value) => this.isFieldChange(value))
    )
      return null;
    return {
      schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
      actor: personViewForUserProfileAuditMetadata(value.actor),
      target: personViewForUserProfileAuditMetadata(value.target),
      changes: value.changes.map((change) => ({ ...change })),
    };
  }

  private isPersonForUserProfileAuditMetadata(
    value: unknown,
  ): value is AuditActorSnapshot {
    return (
      this.isJsonObject(value) &&
      hasExactKeys(value, AUDIT_PERSON_KEYS) &&
      (typeof value.displayName === 'string' || value.displayName === null) &&
      typeof value.githubLogin === 'string'
    );
  }

  private isFieldChange(value: unknown): value is UserProfileAuditFieldChange {
    return (
      this.isJsonObject(value) &&
      hasExactKeys(value, USER_PROFILE_AUDIT_FIELD_CHANGE_KEYS) &&
      Object.values(USER_PROFILE_AUDIT_FIELDS).some(
        (field) => field === value.field,
      ) &&
      (typeof value.before === 'string' || value.before === null) &&
      (typeof value.after === 'string' || value.after === null)
    );
  }

  private parseTeamDeletedAuditMetadata(
    value: unknown,
  ): TeamDeletedAuditMetadataView | null {
    if (!this.isTeamStateShape(value, TEAM_DELETED_AUDIT_SCHEMA_VERSION)) {
      return null;
    }
    const { deletedCounts } = value;
    if (!this.isTeamDeletedCounts(deletedCounts)) return null;

    return {
      schemaVersion: TEAM_DELETED_AUDIT_SCHEMA_VERSION,
      programName: value.programName,
      teamName: value.teamName,
      deletedCounts,
    };
  }

  private isTeamDeletedCounts(value: unknown): value is TeamDeletedAuditCounts {
    if (!this.isJsonObject(value)) return false;
    const keys = Object.keys(value);
    return (
      keys.length === TEAM_DELETED_COUNT_KEYS.length &&
      TEAM_DELETED_COUNT_KEYS.every((key) => Number.isInteger(value[key]))
    );
  }

  private parseTeamRenamedAuditMetadata(
    value: unknown,
  ): TeamRenamedAuditMetadataView | null {
    if (!this.isTeamStateShape(value, TEAM_RENAMED_AUDIT_SCHEMA_VERSION)) {
      return null;
    }
    const { previousName } = value;

    return typeof previousName === 'string'
      ? {
          schemaVersion: TEAM_RENAMED_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
          teamName: value.teamName,
          previousName,
        }
      : null;
  }

  parseTeamMembershipAuditMetadata(
    value: unknown,
  ): TeamMembershipAuditMetadataView | null {
    if (!this.isTeamStateShape(value, TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION)) {
      return null;
    }
    const { operation, removedUserId, previousLeaderId, nextLeaderId } = value;

    return isTeamMembershipOperation(operation) &&
      hasValidRemovedUserId(operation, removedUserId) &&
      typeof previousLeaderId === 'string' &&
      (nextLeaderId === null || typeof nextLeaderId === 'string')
      ? {
          schemaVersion: TEAM_MEMBERSHIP_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
          teamName: value.teamName,
          operation,
          removedUserId,
          previousLeaderId,
          nextLeaderId,
        }
      : null;
  }

  private parseProgramCreatedAuditMetadata(
    value: unknown,
  ): ProgramCreatedAuditMetadataView | null {
    return this.isBase(value, PROGRAM_CREATED_AUDIT_SCHEMA_VERSION) &&
      !('teamName' in value) &&
      !('lifecycle' in value) &&
      !('blockingCounts' in value) &&
      !('before' in value) &&
      !('after' in value)
      ? {
          schemaVersion: PROGRAM_CREATED_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
        }
      : null;
  }

  parseTeamCreatedAuditMetadata(
    value: unknown,
  ): TeamCreatedAuditMetadataView | null {
    return this.isTeamState(value, TEAM_CREATED_AUDIT_SCHEMA_VERSION)
      ? {
          schemaVersion: TEAM_CREATED_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
          teamName: value.teamName,
        }
      : null;
  }

  parseTeamJoinedAuditMetadata(
    value: unknown,
  ): TeamJoinedAuditMetadataView | null {
    return this.isTeamState(value, TEAM_JOINED_AUDIT_SCHEMA_VERSION)
      ? {
          schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
          teamName: value.teamName,
        }
      : null;
  }

  parseApplicationSubmittedAuditMetadata(
    value: unknown,
  ): ApplicationSubmittedAuditMetadataView | null {
    return this.isTeamState(
      value,
      APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
    ) && !('applicantGithubLogin' in value)
      ? {
          schemaVersion: APPLICATION_SUBMITTED_AUDIT_SCHEMA_VERSION,
          programName: value.programName,
          teamName: value.teamName,
        }
      : null;
  }

  private isTeamState(
    value: unknown,
    schemaVersion: number,
  ): value is Record<string, unknown> & {
    readonly programName: string;
    readonly teamName: string;
  } {
    return (
      this.isTeamStateShape(value, schemaVersion) &&
      !TEAM_MEMBERSHIP_RESERVED_KEYS.some((key) => key in value) &&
      !TEAM_RENAMED_RESERVED_KEYS.some((key) => key in value) &&
      !TEAM_DELETED_RESERVED_KEYS.some((key) => key in value)
    );
  }

  private isTeamStateShape(
    value: unknown,
    schemaVersion: number,
  ): value is Record<string, unknown> & {
    readonly programName: string;
    readonly teamName: string;
  } {
    return (
      this.isBase(value, schemaVersion) && typeof value.teamName === 'string'
    );
  }

  private isBase(
    value: unknown,
    schemaVersion: number,
  ): value is Record<string, unknown> & { readonly programName: string } {
    return (
      this.isJsonObject(value) &&
      value.schemaVersion === schemaVersion &&
      typeof value.programName === 'string' &&
      !FORBIDDEN_KEYS.some((key) => key in value)
    );
  }

  parseAuditLogMetadata(value: unknown): AuditLogMetadataEvidence {
    if (this.isJsonObject(value) && Object.keys(value).length === 0) {
      return { legacy: true, metadata: null };
    }
    const metadata = this.parseKnownAuditLogMetadata(value);

    if (!metadata) {
      throw new InvalidAuditLogMetadataError();
    }

    return { legacy: false, metadata };
  }

  private parseKnownAuditLogMetadata(
    value: unknown,
  ): AuditLogMetadataView | null {
    return (
      this.parseApplicationRepositoryUrlAuditMetadata(value) ??
      this.parseIndependentAuthorityAuditMetadata(value) ??
      this.parseAccessAuditMetadata(value) ??
      this.parseRepositoryConnectionAuditMetadata(value) ??
      this.parseRepositoryPublishAuditMetadata(value) ??
      this.parseProgramLifecycleAuditMetadata(value) ??
      this.parseProgramDeletionAuditMetadata(value) ??
      this.parseTeamMembershipAuditMetadata(value) ??
      this.parseTeamRenamedAuditMetadata(value) ??
      this.parseTeamDeletedAuditMetadata(value) ??
      this.parseTeamCreatedAuditMetadata(value) ??
      this.parseTeamJoinedAuditMetadata(value) ??
      this.parseApplicationSubmittedAuditMetadata(value) ??
      this.parseProgramCreatedAuditMetadata(value) ??
      this.parseCollectionTriggerAuditMetadata(value) ??
      this.parseSubmissionFileCleanupAuditMetadata(value) ??
      this.parseApplicationDecisionAuditMetadata(value) ??
      this.parseUserProfileAuditMetadata(value)
    );
  }

  isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  parseApplicationRepositoryUrlAuditMetadata(
    value: unknown,
  ): ApplicationRepositoryUrlAuditMetadataView | null {
    if (
      !this.isJsonObject(value) ||
      (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
      typeof value.programId !== 'string' ||
      typeof value.teamId !== 'string' ||
      typeof value.programName !== 'string' ||
      typeof value.actorGithubLogin !== 'string' ||
      (value.schemaVersion === 1 &&
        (typeof value.reason !== 'string' ||
          value.reason.trim().length === 0 ||
          Array.from(value.reason).length > 500)) ||
      (value.schemaVersion === 2 && 'reason' in value) ||
      !this.isJsonObject(value.before) ||
      !this.isJsonObject(value.after) ||
      !(
        value.before.repositoryId === null ||
        typeof value.before.repositoryId === 'string'
      ) ||
      !(
        value.before.repositoryUrl === null ||
        typeof value.before.repositoryUrl === 'string'
      ) ||
      typeof value.after.repositoryId !== 'string' ||
      typeof value.after.repositoryUrl !== 'string'
    )
      return null;
    return {
      ...(value.schemaVersion === 1
        ? { schemaVersion: 1 as const, reason: value.reason as string }
        : { schemaVersion: 2 as const }),
      programId: value.programId,
      teamId: value.teamId,
      programName: value.programName,
      actorGithubLogin: value.actorGithubLogin,
      before: {
        repositoryId: value.before.repositoryId,
        repositoryUrl: value.before.repositoryUrl,
      },
      after: {
        repositoryId: value.after.repositoryId,
        repositoryUrl: value.after.repositoryUrl,
      },
    };
  }

  createRepositoryConnectionAuditMetadata(
    input: Omit<RepositoryConnectionAuditMetadata, 'schemaVersion'>,
  ): RepositoryConnectionAuditMetadata {
    return {
      schemaVersion: REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION,
      ...input,
    };
  }

  parseRepositoryConnectionAuditMetadata(
    value: unknown,
  ): RepositoryConnectionAuditMetadataView | null {
    if (
      !this.isJsonObject(value) ||
      value.schemaVersion !== REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION ||
      typeof value.applicationId !== 'string' ||
      !this.isRepositoryConnectionState(value.before) ||
      !this.isRepositoryConnectionState(value.after)
    ) {
      return null;
    }
    return {
      schemaVersion: REPOSITORY_CONNECTION_AUDIT_SCHEMA_VERSION,
      applicationId: value.applicationId,
      before: {
        repositoryId: value.before.repositoryId,
        nameWithOwner: value.before.nameWithOwner,
        connectionMode: value.before.connectionMode,
        repositoryUrl: value.before.repositoryUrl,
      },
      after: {
        repositoryId: value.after.repositoryId,
        nameWithOwner: value.after.nameWithOwner,
        connectionMode: value.after.connectionMode,
        repositoryUrl: value.after.repositoryUrl,
      },
    };
  }

  private isRepositoryConnectionState(
    value: unknown,
  ): value is RepositoryConnectionAuditState {
    return (
      this.isJsonObject(value) &&
      (value.repositoryId === null || typeof value.repositoryId === 'string') &&
      (value.nameWithOwner === null ||
        typeof value.nameWithOwner === 'string') &&
      (value.connectionMode === RepositoryConnectionMode.NEW ||
        value.connectionMode === RepositoryConnectionMode.OWN) &&
      (value.repositoryUrl === null || typeof value.repositoryUrl === 'string')
    );
  }
}

const GITHUB_REPOSITORY_URL_PATTERN =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/;

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isRole(value: unknown): value is AuthorityLabel | null {
  return (
    value === null ||
    value === 'STUDENT' ||
    value === 'STAFF' ||
    value === 'ADMIN'
  );
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return value === AccountStatus.ACTIVE || value === AccountStatus.DEACTIVATED;
}

function isRequestStatus(
  value: unknown,
): value is StaffAccessRequestStatus | null {
  return (
    value === null ||
    Object.values(StaffAccessRequestStatus).some((status) => status === value)
  );
}

function personView(value: AuditPersonSnapshot): AuditPersonSnapshot {
  return { displayName: value.displayName, githubLogin: value.githubLogin };
}

function accessStateView(value: AccessAuditState): AccessAuditState {
  return {
    role: value.role,
    accountStatus: value.accountStatus,
    requestStatus: value.requestStatus,
  };
}

const INDEPENDENT_AUTHORITY_AUDIT_METADATA_KEYS = [
  'schemaVersion',
  'eventKind',
  'command',
  'actor',
  'target',
  'before',
  'after',
] as const;

const AUDIT_PERSON_KEYS = ['displayName', 'githubLogin'] as const;

const INDEPENDENT_AUTHORITY_AUDIT_STATE_KEYS = [
  'memberKind',
  'hasStaffAccess',
  'hasAdminAccess',
  'role',
  'accountStatus',
] as const;

function isCommand(value: unknown): value is IndependentAuthorityAuditCommand {
  return Object.values(INDEPENDENT_AUTHORITY_AUDIT_COMMANDS).some(
    (command) => command === value,
  );
}

function stateView(
  value: IndependentAuthorityAuditState,
): IndependentAuthorityAuditState {
  return {
    memberKind: value.memberKind,
    hasStaffAccess: value.hasStaffAccess,
    hasAdminAccess: value.hasAdminAccess,
    role: value.role,
    accountStatus: value.accountStatus,
  };
}

function isLifecycle(value: unknown): value is ProgramLifecycle {
  return (
    value === ProgramLifecycle.PUBLISHED || value === ProgramLifecycle.ARCHIVED
  );
}

const USER_PROFILE_AUDIT_METADATA_KEYS = [
  'schemaVersion',
  'actor',
  'target',
  'changes',
] as const;

const USER_PHONE_AUDIT_METADATA_KEYS = [
  'schemaVersion',
  'actor',
  'target',
  'transition',
] as const;

const USER_PROFILE_AUDIT_FIELD_CHANGE_KEYS = [
  'field',
  'before',
  'after',
] as const;

function isPhoneTransition(value: unknown): value is UserPhoneAuditTransition {
  return Object.values(USER_PHONE_AUDIT_TRANSITIONS).some(
    (transition) => transition === value,
  );
}

function personViewForUserProfileAuditMetadata(
  value: AuditActorSnapshot,
): AuditActorSnapshot {
  return { displayName: value.displayName, githubLogin: value.githubLogin };
}

const TEAM_DELETED_COUNT_KEYS = [
  'applications',
  'members',
  'invitations',
  'submissions',
  'submissionEvents',
  'detachedRepositories',
] as const;

const FORBIDDEN_KEYS = [
  'answers',
  'joinCode',
  'joinCodeDigest',
  'name',
  'studentId',
  'email',
  'rejectionReason',
  'applicantGithubLogin',
  'target',
] as const;

const TEAM_MEMBERSHIP_RESERVED_KEYS = [
  'operation',
  'removedUserId',
  'previousLeaderId',
  'nextLeaderId',
] as const;

const TEAM_RENAMED_RESERVED_KEYS = ['previousName'] as const;

const TEAM_DELETED_RESERVED_KEYS = ['deletedCounts'] as const;

function hasValidRemovedUserId(
  operation: TeamMembershipAuditOperation,
  removedUserId: unknown,
): removedUserId is string | null {
  return operation === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.TRANSFER_LEADER
    ? removedUserId === null
    : typeof removedUserId === 'string';
}

function isTeamMembershipOperation(
  value: unknown,
): value is TeamMembershipAuditOperation {
  return (
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.LEAVE ||
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.REMOVE ||
    value === TEAM_MEMBERSHIP_AUDIT_OPERATIONS.TRANSFER_LEADER
  );
}
