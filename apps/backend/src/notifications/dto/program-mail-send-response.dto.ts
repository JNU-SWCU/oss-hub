export class ProgramMailSendResponseDto {
  declare readonly status: 'IN_PROGRESS' | 'COMPLETED';
  declare readonly sentCount: number;
  declare readonly duplicateCount: number;
  declare readonly failedCount: number;
  declare readonly unknownCount?: number;
  declare readonly previewVersion: string;

  static from(value: ProgramMailSendResponseDto): ProgramMailSendResponseDto {
    return {
      status: value.status,
      sentCount: value.sentCount,
      duplicateCount: value.duplicateCount,
      failedCount: value.failedCount,
      unknownCount: value.unknownCount,
      previewVersion: value.previewVersion,
    };
  }
}
