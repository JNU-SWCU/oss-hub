import { ApplicationStatus } from '@prisma/client';
import { isJsonObject } from './audit-metadata-validation';

export const APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1 = 1 as const;
export const APPLICATION_DECISION_AUDIT_SCHEMA_VERSION = 2 as const;
export const APPLICATION_DECISION_AUDIT_ACTIONS = {
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_REVERTED: 'APPLICATION_REVERTED',
} as const;
type ApplicationDecisionAuditMetadataBaseV1 = {
  readonly schemaVersion: typeof APPLICATION_DECISION_AUDIT_SCHEMA_VERSION_V1;
  readonly before: { readonly status: ApplicationStatus };
  readonly after: { readonly status: ApplicationStatus };
};
type ApplicationDecisionAuditMetadataBaseV2 = {
  readonly schemaVersion: typeof APPLICATION_DECISION_AUDIT_SCHEMA_VERSION;
  readonly programName: string;
  readonly applicantGithubLogin: string;
  readonly before: { readonly status: ApplicationStatus };
  readonly after: { readonly status: ApplicationStatus };
};
export type ApplicationDecisionAuditMetadataV1 =
  ApplicationDecisionAuditMetadataBaseV1;
export type ApplicationDecisionAuditMetadataV2 =
  ApplicationDecisionAuditMetadataBaseV2;
export type ApplicationDecisionAuditMetadata =
  ApplicationDecisionAuditMetadataV1 | ApplicationDecisionAuditMetadataV2;
export type ApplicationDecisionAuditMetadataInput = Omit<
  ApplicationDecisionAuditMetadataV2,
  'schemaVersion'
>;
export type ApplicationDecisionAuditMetadataView =
  ApplicationDecisionAuditMetadata;

export function createApplicationDecisionAuditMetadata(
  input: ApplicationDecisionAuditMetadataInput,
): ApplicationDecisionAuditMetadataV2 {
  return {
    schemaVersion: APPLICATION_DECISION_AUDIT_SCHEMA_VERSION,
    ...input,
  };
}

export function parseApplicationDecisionAuditMetadata(
  value: unknown,
): ApplicationDecisionAuditMetadataView | null {
  if (
    !isJsonObject(value) ||
    !isState(value.before) ||
    !isState(value.after) ||
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

function isState(
  value: unknown,
): value is { readonly status: ApplicationStatus } {
  return (
    isJsonObject(value) &&
    Object.values(ApplicationStatus).some((status) => status === value.status)
  );
}
