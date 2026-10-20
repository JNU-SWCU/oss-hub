import type { MilestoneDocumentUploadPolicy } from '@/features/programs/documents/milestone-document-dto';

export function milestoneDocumentUploadPolicy(
  overrides: Partial<MilestoneDocumentUploadPolicy> = {},
): MilestoneDocumentUploadPolicy {
  return {
    maxBytes: 5 * 1024 * 1024,
    maxLabel: '5 MB',
    accept: '.pdf,.hwp,.zip',
    formatLabel: 'PDF, HWP, ZIP',
    ...overrides,
  };
}
