export const MILESTONE_DOCUMENT_SUBMITTED_EVENT =
  'oss-hub:milestone-document-submitted';

export function notifyMilestoneDocumentSubmitted(milestoneId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(MILESTONE_DOCUMENT_SUBMITTED_EVENT, {
      detail: { milestoneId },
    }),
  );
}

export function submittedMilestoneId(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  return typeof detail === 'object' &&
    detail !== null &&
    'milestoneId' in detail &&
    typeof detail.milestoneId === 'string'
    ? detail.milestoneId
    : null;
}
