export type ProgramMailApplicationStatus =
  'SUBMITTED' | 'APPROVED' | 'REJECTED';

type ProgramMailApplicant = {
  readonly id: string;
  readonly displayName: string;
  readonly nickname: string;
  readonly mailAvailable: boolean;
};

export type ProgramMailTeam = {
  readonly id: string;
  readonly name: string;
  readonly status: ProgramMailApplicationStatus;
  readonly deadlineEligible: boolean;
  readonly applicants: readonly ProgramMailApplicant[];
};

export type ProgramMailRecipients = {
  readonly programId: string;
  readonly programName: string;
  readonly recipientLimit: number;
  readonly teams: readonly ProgramMailTeam[];
};

export type ProgramMailDraft = {
  readonly subject: string;
  readonly body: string;
  readonly applicantIds: readonly string[];
};

export type ProgramMailPreview = ProgramMailDraft & {
  readonly programName: string;
  readonly senderName: string;
  readonly recipientNames: readonly string[];
  readonly recipientCount: number;
  readonly renderedSubject: string;
  readonly footer: string;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
};

export type ProgramMailSendResult = {
  readonly status: 'IN_PROGRESS' | 'COMPLETED';
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
  readonly unknownCount?: number;
  readonly previewVersion: string;
};
