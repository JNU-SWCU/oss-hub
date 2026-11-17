import { ApiProperty } from '@nestjs/swagger';
import type { ProgramNoticePreview } from '../program-notice-fetch.client';
import {
  PROGRAM_NOTICE_WARNINGS,
  type ProgramNoticeWarning,
} from '../program-notice.config';

class ProgramNoticeCandidatesResponseDto {
  declare readonly organizers?: string[];
  declare readonly applicationPeriod?: {
    readonly startsAt?: string;
    readonly endsAt?: string;
  };
  declare readonly operationPeriod?: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  declare readonly teamSize?: {
    readonly min: number;
    readonly max: number;
  };

  static from(
    candidates: ProgramNoticePreview['candidates'],
  ): ProgramNoticeCandidatesResponseDto {
    return {
      organizers: candidates.organizers?.slice(),
      applicationPeriod: candidates.applicationPeriod,
      operationPeriod: candidates.operationPeriod,
      teamSize: candidates.teamSize,
    };
  }
}

export class ProgramNoticePreviewResponseDto implements ProgramNoticePreview {
  declare readonly sourceUrl: string;
  declare readonly name: string;
  declare readonly description: string;
  declare readonly coverImages: string[];
  @ApiProperty({ enum: PROGRAM_NOTICE_WARNINGS, isArray: true })
  declare readonly warnings: ProgramNoticeWarning[];
  declare readonly candidates: ProgramNoticeCandidatesResponseDto;

  static from(preview: ProgramNoticePreview): ProgramNoticePreviewResponseDto {
    return {
      sourceUrl: preview.sourceUrl,
      name: preview.name,
      description: preview.description,
      coverImages: preview.coverImages,
      warnings: preview.warnings,
      candidates: ProgramNoticeCandidatesResponseDto.from(preview.candidates),
    };
  }
}
