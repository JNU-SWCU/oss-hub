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
  type ApplicationSubmittedAuditMetadata,
  type ApplicationSubmittedAuditMetadataView,
  type ProgramCreatedAuditMetadata,
  type ProgramCreatedAuditMetadataView,
  type TeamCreatedAuditMetadata,
  type TeamCreatedAuditMetadataView,
  type TeamJoinedAuditMetadata,
  type TeamJoinedAuditMetadataView,
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
