import type {
  ProgramNoticePreview,
  ProgramNoticeWarning,
} from '../program-notice.policy';

export class ProgramNoticePreviewResponseDto implements ProgramNoticePreview {
  readonly sourceUrl: string;
  readonly name: string;
  readonly description: string;
  readonly coverImages: string[];
  readonly warnings: ProgramNoticeWarning[];

  constructor(preview: ProgramNoticePreview) {
    this.sourceUrl = preview.sourceUrl;
    this.name = preview.name;
    this.description = preview.description;
    this.coverImages = preview.coverImages;
    this.warnings = preview.warnings;
  }
}
