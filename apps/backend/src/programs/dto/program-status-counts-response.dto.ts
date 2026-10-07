import type { ProgramStatusCounts } from '../program-list-status-filter';

export class ProgramStatusCountsResponseDto {
  readonly all: number;
  readonly recruiting: number;
  readonly in_progress: number;
  readonly upcoming: number;
  readonly ended: number;

  private constructor(counts: ProgramStatusCounts) {
    this.all = counts.all;
    this.recruiting = counts.recruiting;
    this.in_progress = counts.in_progress;
    this.upcoming = counts.upcoming;
    this.ended = counts.ended;
  }

  static from(counts: ProgramStatusCounts): ProgramStatusCountsResponseDto {
    return new ProgramStatusCountsResponseDto(counts);
  }
}
