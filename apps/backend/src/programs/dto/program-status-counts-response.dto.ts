import type { ProgramStatusCounts } from '../programs.policy';

export class ProgramStatusCountsResponseDto {
  declare readonly all: number;
  declare readonly recruiting: number;
  declare readonly in_progress: number;
  declare readonly upcoming: number;
  declare readonly ended: number;

  static from(counts: ProgramStatusCounts): ProgramStatusCountsResponseDto {
    return {
      all: counts.all,
      recruiting: counts.recruiting,
      in_progress: counts.in_progress,
      upcoming: counts.upcoming,
      ended: counts.ended,
    };
  }
}
