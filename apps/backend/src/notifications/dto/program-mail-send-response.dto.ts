export class ProgramMailSendResponseDto {
  declare readonly sentCount: number;
  declare readonly duplicateCount: number;
  declare readonly failedCount: number;
  declare readonly previewVersion: string;

  static from(value: ProgramMailSendResponseDto): ProgramMailSendResponseDto {
    return {
      sentCount: value.sentCount,
      duplicateCount: value.duplicateCount,
      failedCount: value.failedCount,
      previewVersion: value.previewVersion,
    };
  }
}
