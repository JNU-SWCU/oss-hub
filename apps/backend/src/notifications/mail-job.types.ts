export type JobDraft<Program, Deadline> =
  | { readonly kind: 'PROGRAM'; readonly draft: Program }
  | { readonly kind: 'DEADLINE'; readonly draft: Deadline };
export type DeadlineEligibilitySummary = {
  readonly applicationCount: number;
  readonly milestoneCount: number;
  readonly recipientCount: number;
  readonly inactiveCount: number;
  readonly optedOutCount: number;
  readonly noEmailCount: number;
};
export type DeadlineDigestSendResult = DeadlineEligibilitySummary & {
  readonly staffRecipientCount: number;
  readonly previewVersion: string;
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};
