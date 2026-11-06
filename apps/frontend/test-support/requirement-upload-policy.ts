import type { RequirementUploadPolicy } from '@/features/programs/documents/requirement-dto';

export function requirementUploadPolicy(
  overrides: Partial<RequirementUploadPolicy> = {},
): RequirementUploadPolicy {
  return {
    maxBytes: 5 * 1024 * 1024,
    maxLabel: '5 MB',
    accept: '.pdf,.hwp,.zip',
    formatLabel: 'PDF, HWP, ZIP',
    ...overrides,
  };
}
