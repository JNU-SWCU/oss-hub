import {
  CollectionRun,
  CollectionRunStatus,
} from '../domain/collection-run';

export class CollectionRunResponseDto {
  runId: string;
  status: CollectionRunStatus;
  profileCount: number;
  repoCount: number;
  eventCount: number;

  private constructor(run: CollectionRun) {
    this.runId = run.id;
    this.status = run.status;
    this.profileCount = run.profileCount;
    this.repoCount = run.repoCount;
    this.eventCount = run.eventCount;
  }

  static from(run: CollectionRun): CollectionRunResponseDto {
    return new CollectionRunResponseDto(run);
  }
}
