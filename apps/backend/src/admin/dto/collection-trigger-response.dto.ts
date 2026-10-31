export class CollectionTriggerResponseDto {
  declare readonly runId: string;
  declare readonly status: 'PENDING';

  static from(runId: string): CollectionTriggerResponseDto {
    return { runId, status: 'PENDING' };
  }
}
