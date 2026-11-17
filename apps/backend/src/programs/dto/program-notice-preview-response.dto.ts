import type {
  ProgramNoticePreview,
  ProgramNoticeWarning,
} from '../program-notice-fetch.client';

export class ProgramNoticePreviewResponseDto implements ProgramNoticePreview {
  declare readonly sourceUrl: string;
  declare readonly name: string;
  declare readonly description: string;
  declare readonly coverImages: string[];
  declare readonly warnings: ProgramNoticeWarning[];
  declare readonly candidates: ProgramNoticePreview['candidates'];

  static from(preview: ProgramNoticePreview): ProgramNoticePreviewResponseDto {
    return {
      sourceUrl: preview.sourceUrl,
      name: preview.name,
      description: preview.description,
      coverImages: preview.coverImages,
      warnings: preview.warnings,
      candidates: preview.candidates,
    };
  }
}
