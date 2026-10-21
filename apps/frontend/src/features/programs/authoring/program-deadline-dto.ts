export type ProgramDeadlineGuidance = {
  readonly studentGuidance: string;
  readonly staffGuidance: string;
};

export type ProgramDeadlineMail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

export type ProgramDeadlinePreview = {
  readonly applicationCount: number;
  readonly milestoneCount: number;
  readonly recipientCount: number;
  readonly inactiveCount: number;
  readonly optedOutCount: number;
  readonly noEmailCount: number;

  readonly staffRecipientCount: number;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
  readonly studentPreviews: readonly (ProgramDeadlineMail & {
    readonly displayName: string;
  })[];
  readonly staffPreview: ProgramDeadlineMail | null;
};

export type ProgramDeadlineSendResult = Omit<
  ProgramDeadlinePreview,
  'previewedAt' | 'expiresAt' | 'studentPreviews' | 'staffPreview'
> & {
  readonly sentAt: string;
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};
