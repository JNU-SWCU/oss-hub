import { ApiProperty } from '@nestjs/swagger';

class ProgramMailReceiptResponseDto {
  declare readonly jobId: string;
  declare readonly acceptedAt: string;
  static from(
    value: ProgramMailReceiptResponseDto,
  ): ProgramMailReceiptResponseDto {
    return { jobId: value.jobId, acceptedAt: value.acceptedAt };
  }
}

export class ProgramMailJobListResponseDto {
  @ApiProperty({ type: () => ProgramMailReceiptResponseDto, isArray: true })
  declare readonly items: readonly ProgramMailReceiptResponseDto[];
  declare readonly nextCursor?: string;
  static from(
    value: ProgramMailJobListResponseDto,
  ): ProgramMailJobListResponseDto {
    return {
      items: value.items.map((item) =>
        ProgramMailReceiptResponseDto.from(item),
      ),
      nextCursor: value.nextCursor,
    };
  }
}

class MailAudienceCountsResponseDto {
  @ApiProperty({ enum: ['STUDENT', 'STAFF'] })
  declare readonly audience: 'STUDENT' | 'STAFF';
  declare readonly sentCount: number;
  declare readonly failedCount: number;
  declare readonly unknownCount: number;
  declare readonly cancelledCount: number;
  static from(
    row: MailAudienceCountsResponseDto,
  ): MailAudienceCountsResponseDto {
    return {
      audience: row.audience,
      sentCount: row.sentCount,
      failedCount: row.failedCount,
      unknownCount: row.unknownCount,
      cancelledCount: row.cancelledCount,
      duplicateCount: row.duplicateCount,
    };
  }
  declare readonly duplicateCount: number;
}
export class ProgramMailJobResponseDto extends ProgramMailReceiptResponseDto {
  @ApiProperty({
    type: () => MailAudienceCountsResponseDto,
    isArray: true,
    required: false,
  })
  declare readonly audiences?: readonly MailAudienceCountsResponseDto[];
  declare readonly source?: string;
  @ApiProperty({ enum: ['QUEUED', 'IN_PROGRESS', 'COMPLETED'] })
  declare readonly status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
  declare readonly finishedAt?: string;
  declare readonly sentCount?: number;
  declare readonly duplicateCount?: number;
  declare readonly failedCount?: number;
  declare readonly unknownCount?: number;
  static override from(
    value: ProgramMailJobResponseDto,
  ): ProgramMailJobResponseDto {
    return {
      jobId: value.jobId,
      source: value.source,
      audiences: value.audiences?.map((row) =>
        MailAudienceCountsResponseDto.from(row),
      ),
      acceptedAt: value.acceptedAt,
      status: value.status,
      finishedAt: value.finishedAt,
      sentCount: value.sentCount,
      duplicateCount: value.duplicateCount,
      failedCount: value.failedCount,
      unknownCount: value.unknownCount,
    };
  }
}
