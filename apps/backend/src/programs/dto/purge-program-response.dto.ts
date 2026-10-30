import type {
  ProgramPurgeDeletedCounts,
  ProgramPurgeResult,
} from '../programs.types';

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
