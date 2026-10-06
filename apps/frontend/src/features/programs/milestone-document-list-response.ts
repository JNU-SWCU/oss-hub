import type {
  MilestoneDocument,
  MilestoneDocumentList,
  MilestoneDocumentUploadPolicy,
} from './milestone-document-api';

function isUploadPolicy(
  value: unknown,
): value is MilestoneDocumentUploadPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.maxBytes === 'number' &&
    Number.isFinite(policy.maxBytes) &&
    policy.maxBytes > 0 &&
    typeof policy.maxLabel === 'string' &&
    policy.maxLabel.length > 0 &&
    typeof policy.accept === 'string' &&
    policy.accept.length > 0 &&
    typeof policy.formatLabel === 'string' &&
    policy.formatLabel.length > 0
  );
}

export function requireMilestoneDocumentList(
  value: unknown,
): MilestoneDocumentList {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Invalid milestone document list response');
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.documents) || !isUploadPolicy(body.fileUpload)) {
    throw new TypeError('Invalid milestone document list response');
  }
  return {
    documents: body.documents as readonly MilestoneDocument[],
    fileUpload: body.fileUpload,
  };
}
