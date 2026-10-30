import type { ProgramDocumentChangeRequestPreview } from '../milestone-document.policy';

export class ProgramDocumentChangeRequestTargetsResponseDto {
  declare readonly submitted: number;
  declare readonly changesRequested: number;
  declare readonly approved: number;
  declare readonly rejected: number;
  declare readonly version: string;

  static from(
    preview: ProgramDocumentChangeRequestPreview,
  ): ProgramDocumentChangeRequestTargetsResponseDto {
    return {
      submitted: preview.counts.SUBMITTED,
      changesRequested: preview.counts.CHANGES_REQUESTED,
      approved: preview.counts.APPROVED,
      rejected: preview.counts.REJECTED,
      version: preview.version,
    };
  }
}
