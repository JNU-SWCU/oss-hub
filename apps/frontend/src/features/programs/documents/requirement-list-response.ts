import type {
  Requirement,
  RequirementList,
  RequirementUploadPolicy,
} from './requirement-dto';

function isUploadPolicy(value: unknown): value is RequirementUploadPolicy {
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

export function requireRequirementList(value: unknown): RequirementList {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Invalid milestone document list response');
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.documents) || !isUploadPolicy(body.fileUpload)) {
    throw new TypeError('Invalid milestone document list response');
  }
  for (const value of body.documents) {
    if (typeof value !== 'object' || value === null)
      throw new TypeError('Invalid milestone document response');
    const document = value as Record<string, unknown>;
    if (
      document.submissionType !== 'FILE' &&
      document.submissionType !== 'TEXT' &&
      document.submissionType !== 'FILE_OR_TEXT'
    ) {
      throw new TypeError('Invalid requirement submission type');
    }
    if (
      document.graceDueAt != null &&
      (typeof document.graceDueAt !== 'string' ||
        !Number.isFinite(Date.parse(document.graceDueAt)))
    )
      throw new TypeError('Invalid document grace deadline');
  }
  return {
    documents: body.documents as readonly Requirement[],
    fileUpload: body.fileUpload,
  };
}
