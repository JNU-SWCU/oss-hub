import { isJsonObject } from './audit-metadata-validation';

export const COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION = 1 as const;
export const COLLECTION_TRIGGER_AUDIT_ACTIONS = {
  COLLECTION_SYNC_TRIGGERED: 'COLLECTION_SYNC_TRIGGERED',
} as const;
export type CollectionTriggerAuditMetadata = {
  readonly schemaVersion: typeof COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION;
  readonly runId: string;
};
export type CollectionTriggerAuditMetadataView = Omit<
  CollectionTriggerAuditMetadata,
  'runId'
>;
export function createCollectionTriggerAuditMetadata(
  input: Omit<CollectionTriggerAuditMetadata, 'schemaVersion'>,
): CollectionTriggerAuditMetadata {
  return { schemaVersion: COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION, ...input };
}
export function parseCollectionTriggerAuditMetadata(
  value: unknown,
): CollectionTriggerAuditMetadataView | null {
  return isJsonObject(value) &&
    value.schemaVersion === COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION &&
    typeof value.runId === 'string'
    ? { schemaVersion: COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION }
    : null;
}

export const SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION = 1 as const;
export const SUBMISSION_FILE_CLEANUP_AUDIT_ACTIONS = {
  SUBMISSION_FILE_CLEANUP_RETRY_RESET: 'SUBMISSION_FILE_CLEANUP_RETRY_RESET',
} as const;
export type SubmissionFileCleanupAuditMetadata = {
  readonly schemaVersion: typeof SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION;
  readonly fileId: string;
};
export function createSubmissionFileCleanupAuditMetadata(
  input: Omit<SubmissionFileCleanupAuditMetadata, 'schemaVersion'>,
): SubmissionFileCleanupAuditMetadata {
  return {
    schemaVersion: SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}
export function parseSubmissionFileCleanupAuditMetadata(
  value: unknown,
): SubmissionFileCleanupAuditMetadata | null {
  return isJsonObject(value) &&
    value.schemaVersion === SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION &&
    typeof value.fileId === 'string'
    ? {
        schemaVersion: SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION,
        fileId: value.fileId,
      }
    : null;
}
