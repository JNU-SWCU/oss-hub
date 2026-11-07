import { Injectable } from '@nestjs/common';
import { ApplicationRepositoryUrlAuditMetadataView } from './repository-audit-metadata.config';
import {
  ACCESS_AUDIT_SCHEMA_VERSION,
  ACCESS_AUDIT_EVENT_KINDS,
  IndependentAuthorityAuditMetadata,
  REPOSITORY_PUBLISH_AUDIT_SCHEMA_VERSION,
  PROGRAM_DELETION_AUDIT_SCHEMA_VERSION,
  USER_PROFILE_AUDIT_SCHEMA_VERSION,
  PROGRAM_CREATED_AUDIT_SCHEMA_VERSION,
  TEAM_JOINED_AUDIT_SCHEMA_VERSION,
  type AccessAuditMetadataInput,
  type AccessAuditMetadataV2,
  type IndependentAuthorityAuditMetadataInput,
  type RepositoryPublishAuditMetadataInput,
  type RepositoryPublishAuditMetadataV2,
  type ProgramDeletionAuditMetadata,
  type UserProfileAuditMetadata,
  type UserPhoneAuditMetadata,
  type ProgramCreatedAuditMetadata,
  type TeamJoinedAuditMetadata,
} from './history-metadata.config';

@Injectable()
export class HistoryMetadataService {
  createAccessAuditMetadata(
    input: AccessAuditMetadataInput,
  ): AccessAuditMetadataV2 {
    return { schemaVersion: ACCESS_AUDIT_SCHEMA_VERSION, ...input };
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

  createTeamJoinedAuditMetadata(
    input: Omit<TeamJoinedAuditMetadata, 'schemaVersion'>,
  ): TeamJoinedAuditMetadata {
    return { schemaVersion: TEAM_JOINED_AUDIT_SCHEMA_VERSION, ...input };
  }

  parseApplicationRepositoryUrlAuditMetadata(
    value: unknown,
  ): ApplicationRepositoryUrlAuditMetadataView | null {
    if (
      !isJsonObject(value) ||
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
      !isJsonObject(value.before) ||
      !isJsonObject(value.after) ||
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
}

const GITHUB_REPOSITORY_URL_PATTERN =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
