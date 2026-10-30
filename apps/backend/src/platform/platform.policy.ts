export interface ActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export function activityTotal(activity: ActivityCounts): number {
  return (
    activity.commitCount +
    activity.pullRequestCount +
    activity.issueCount +
    activity.repositoryCount +
    activity.starCount
  );
}

export function addOneCalendarYear(value: Date): Date {
  const result = new Date(value);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (month === 1 && result.getUTCMonth() !== month) {
    result.setUTCDate(0);
  }
  return result;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function compareStringsByCodeUnit(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

const LATIN1_MAX_CODE_POINT = 0xff;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function normalizeMultipartFileName(fileName: string): string {
  if (
    [...fileName].some(
      (character) => character.codePointAt(0)! > LATIN1_MAX_CODE_POINT,
    )
  ) {
    return fileName.normalize('NFC');
  }

  try {
    return UTF8_DECODER.decode(Buffer.from(fileName, 'latin1')).normalize(
      'NFC',
    );
  } catch {
    return fileName.normalize('NFC');
  }
}

const COLLECTION_TRIGGER_AUDIT_SCHEMA_VERSION = 1 as const;
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

const SUBMISSION_FILE_CLEANUP_AUDIT_SCHEMA_VERSION = 1 as const;
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
