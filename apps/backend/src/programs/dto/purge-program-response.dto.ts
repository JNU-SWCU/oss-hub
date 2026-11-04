import type { ProgramPurgeDeletedCounts } from '../programs.repository';
import type { ProgramPurgeResult } from '../programs.service';

export class PurgeProgramResponseDto {
  declare readonly id: string;
  declare readonly deleted: true;
  declare readonly deletedCounts: ProgramPurgeDeletedCounts;

  static from(result: ProgramPurgeResult): PurgeProgramResponseDto {
    return {
      id: result.id,
      deleted: result.deleted,
      deletedCounts: result.deletedCounts,
    };
  }
}
