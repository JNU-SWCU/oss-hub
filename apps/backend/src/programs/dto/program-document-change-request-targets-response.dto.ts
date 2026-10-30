import type { ProgramDocumentChangeRequestPreview } from '../milestone-document.policy';

export class ProgramDocumentChangeRequestTargetsResponseDto {
  private constructor(
    readonly submitted: number,
    readonly changesRequested: number,
    readonly approved: number,
    readonly rejected: number,
    readonly version: string,
  ) {}

  static from(
    preview: ProgramDocumentChangeRequestPreview,
  ): ProgramDocumentChangeRequestTargetsResponseDto {
    return new ProgramDocumentChangeRequestTargetsResponseDto(
      preview.counts.SUBMITTED,
      preview.counts.CHANGES_REQUESTED,
      preview.counts.APPROVED,
      preview.counts.REJECTED,
      preview.version,
    );
  }
}
