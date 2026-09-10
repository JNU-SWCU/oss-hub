import {
  parseAccessAuditMetadata,
  type AccessAuditMetadata,
  type AccessAuditMetadataView,
} from './access-audit-metadata';
import {
  parseIndependentAuthorityAuditMetadata,
  type IndependentAuthorityAuditMetadata,
  type IndependentAuthorityAuditMetadataView,
} from './independent-authority-audit-metadata';
import {
  parseApplicationDecisionAuditMetadata,
  type ApplicationDecisionAuditMetadata,
  type ApplicationDecisionAuditMetadataView,
} from './application-decision-audit-metadata';
import { isJsonObject } from './audit-metadata-validation';
import {
  parseCollectionTriggerAuditMetadata,
  parseSubmissionFileCleanupAuditMetadata,
  type CollectionTriggerAuditMetadata,
  type CollectionTriggerAuditMetadataView,
  type SubmissionFileCleanupAuditMetadata,
} from './operations-audit-metadata';
import {
  parseProgramDeletionAuditMetadata,
  parseProgramLifecycleAuditMetadata,
  parseRepositoryPublishAuditMetadata,
  type ProgramDeletionAuditMetadata,
  type ProgramDeletionAuditMetadataView,
  type ProgramLifecycleAuditMetadata,
  type ProgramLifecycleAuditMetadataView,
  type RepositoryPublishAuditMetadata,
  type RepositoryPublishAuditMetadataView,
} from './repository-program-audit-metadata';
import {
  parseUserProfileAuditMetadata,
  type UserProfileAuditMetadata,
  type UserProfileAuditMetadataView,
} from './user-profile-audit-metadata';
import {
  parseApplicationSubmittedAuditMetadata,
  parseProgramCreatedAuditMetadata,
  parseTeamCreatedAuditMetadata,
  parseTeamJoinedAuditMetadata,
  parseTeamMembershipAuditMetadata,
  type ApplicationSubmittedAuditMetadata,
  type ApplicationSubmittedAuditMetadataView,
  type ProgramCreatedAuditMetadata,
  type ProgramCreatedAuditMetadataView,
  type TeamCreatedAuditMetadata,
  type TeamCreatedAuditMetadataView,
  type TeamJoinedAuditMetadata,
  type TeamJoinedAuditMetadataView,
  type TeamMembershipAuditMetadata,
  type TeamMembershipAuditMetadataView,
} from './web-state-audit-metadata';

export * from './access-audit-metadata';
export * from './application-decision-audit-metadata';
export * from './independent-authority-audit-metadata';
export * from './operations-audit-metadata';
export * from './repository-program-audit-metadata';
export * from './user-profile-audit-metadata';
export * from './web-state-audit-metadata';

export type AuditLogMetadata =
  | AccessAuditMetadata
  | IndependentAuthorityAuditMetadata
  | RepositoryPublishAuditMetadata
  | ProgramLifecycleAuditMetadata
  | ProgramDeletionAuditMetadata
  | ProgramCreatedAuditMetadata
  | TeamCreatedAuditMetadata
  | TeamJoinedAuditMetadata
  | TeamMembershipAuditMetadata
  | ApplicationSubmittedAuditMetadata
  | CollectionTriggerAuditMetadata
  | SubmissionFileCleanupAuditMetadata
  | ApplicationDecisionAuditMetadata
  | UserProfileAuditMetadata;

export type AuditLogMetadataView =
  | AccessAuditMetadataView
  | IndependentAuthorityAuditMetadataView
  | RepositoryPublishAuditMetadataView
  | ProgramLifecycleAuditMetadataView
  | ProgramDeletionAuditMetadataView
  | ProgramCreatedAuditMetadataView
  | TeamCreatedAuditMetadataView
  | TeamJoinedAuditMetadataView
  | TeamMembershipAuditMetadataView
  | ApplicationSubmittedAuditMetadataView
  | CollectionTriggerAuditMetadataView
  | SubmissionFileCleanupAuditMetadata
  | ApplicationDecisionAuditMetadataView
  | UserProfileAuditMetadataView;

export type AuditLogMetadataEvidence =
  | { readonly legacy: true; readonly metadata: null }
  | { readonly legacy: false; readonly metadata: AuditLogMetadataView };

export class InvalidAuditLogMetadataError extends Error {
  constructor() {
    super('Audit log metadata does not match a known audit schema version.');
    this.name = 'InvalidAuditLogMetadataError';
  }
}

export function parseAuditLogMetadata(
  value: unknown,
): AuditLogMetadataEvidence {
  if (isJsonObject(value) && Object.keys(value).length === 0) {
    return { legacy: true, metadata: null };
  }
  const metadata = parseKnownAuditLogMetadata(value);

  if (!metadata) {
    throw new InvalidAuditLogMetadataError();
  }

  return { legacy: false, metadata };
}

function parseKnownAuditLogMetadata(
  value: unknown,
): AuditLogMetadataView | null {
  return (
    parseIndependentAuthorityAuditMetadata(value) ??
    parseAccessAuditMetadata(value) ??
    parseRepositoryPublishAuditMetadata(value) ??
    parseProgramLifecycleAuditMetadata(value) ??
    parseProgramDeletionAuditMetadata(value) ??
    // 팀 구성 변경은 TEAM_CREATED/TEAM_JOINED보다 먼저 본다 — 세 계약 모두
    // programName·teamName을 공유하므로 뒤에 두면 탈퇴·승계 필드가 통째로 잘려나간다.
    parseTeamMembershipAuditMetadata(value) ??
    parseTeamCreatedAuditMetadata(value) ??
    parseTeamJoinedAuditMetadata(value) ??
    parseApplicationSubmittedAuditMetadata(value) ??
    parseProgramCreatedAuditMetadata(value) ??
    parseCollectionTriggerAuditMetadata(value) ??
    parseSubmissionFileCleanupAuditMetadata(value) ??
    parseApplicationDecisionAuditMetadata(value) ??
    parseUserProfileAuditMetadata(value)
  );
}
