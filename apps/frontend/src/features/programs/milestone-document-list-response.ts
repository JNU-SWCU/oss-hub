import type { MilestoneDocument } from './milestone-document-api';

export function requireMilestoneDocumentList(
  value: unknown,
): readonly MilestoneDocument[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid milestone document list response');
  }
  return value as readonly MilestoneDocument[];
}
