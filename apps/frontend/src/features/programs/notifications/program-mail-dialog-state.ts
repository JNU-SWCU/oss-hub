import { ApiError } from '@/lib/api-client';
import type { ProgramMailPreview } from './program-mail-dto';

export const PROGRAM_MAIL_SUBJECT_LIMIT = 200;
export const PROGRAM_MAIL_BODY_LIMIT = 4000;
export type ProgramMailDialogBusy = 'preview' | 'send' | null;

export type ProgramMailDialogDraft = {
  readonly selectedIds: ReadonlySet<string>;
  readonly subject: string;
  readonly body: string;
  readonly selectionRejected: boolean;
};

export const EMPTY_PROGRAM_MAIL_DRAFT: ProgramMailDialogDraft = {
  selectedIds: new Set(),
  subject: '',
  body: '',
  selectionRejected: false,
};

export function isProgramMailDraftReady(
  draft: ProgramMailDialogDraft,
  recipientLimit: number | undefined,
): boolean {
  return (
    recipientLimit !== undefined &&
    !draft.selectionRejected &&
    draft.selectedIds.size > 0 &&
    draft.selectedIds.size <= recipientLimit &&
    draft.subject.trim().length > 0 &&
    draft.subject.length <= PROGRAM_MAIL_SUBJECT_LIMIT &&
    draft.body.trim().length > 0 &&
    draft.body.length <= PROGRAM_MAIL_BODY_LIMIT
  );
}

export function canSendProgramMail(
  preview: ProgramMailPreview | null,
  recipientLimit: number | undefined,
  busy: ProgramMailDialogBusy,
): boolean {
  return (
    preview !== null &&
    recipientLimit !== undefined &&
    preview.applicantIds.length <= recipientLimit &&
    busy === null
  );
}

export function programMailErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.problem.detail
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
