export class ProgramDocumentChangeRequestCountResponseDto {
  declare readonly requestedCount: number;

  static from(result: {
    readonly requestedCount: number;
  }): ProgramDocumentChangeRequestCountResponseDto {
    return { ...result };
  }
}
