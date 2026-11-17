import type { ProgramPurgeResult } from '../programs.service';

export class PurgeProgramResponseDto {
  declare readonly id: string;
  declare readonly deleted: true;
  declare readonly deletedCounts: {
    readonly files: number;
  };

  static from(result: ProgramPurgeResult): PurgeProgramResponseDto {
    return {
      id: result.id,
      deleted: result.deleted,
      deletedCounts: result.deletedCounts,
    };
  }
}
