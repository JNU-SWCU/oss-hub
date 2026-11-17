import { ApiProperty } from '@nestjs/swagger';
import type { ProgramNoticePreview } from '../program-notice-fetch.client';
import {
  PROGRAM_NOTICE_WARNINGS,
  type ProgramNoticeWarning,
} from '../program-notice.config';

export class ProgramNoticePreviewResponseDto implements ProgramNoticePreview {
  declare readonly sourceUrl: string;
  declare readonly name: string;
  declare readonly description: string;
  declare readonly coverImages: string[];
  @ApiProperty({ enum: PROGRAM_NOTICE_WARNINGS, isArray: true })
  declare readonly warnings: ProgramNoticeWarning[];

  static from(preview: ProgramNoticePreview): ProgramNoticePreviewResponseDto {
    return {
      sourceUrl: preview.sourceUrl,
      name: preview.name,
      description: preview.description,
      coverImages: preview.coverImages,
      warnings: preview.warnings,
    };
  }
}
