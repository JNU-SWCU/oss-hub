import type {
  CollectionSyncRunRow,
  CollectionSyncRunStatusProjection,
  CollectionSyncRunTrigger,
} from '../collection-incremental.types';

export class CollectionRunResponseDto {
  constructor(
    readonly runId: string,
    readonly scope: string,
    readonly trigger: CollectionSyncRunTrigger,
    readonly status: CollectionSyncRunStatusProjection,
    readonly startedAt: string | null,
    readonly lastObservedAt: string,
    readonly cycleCompletedAt: string | null,
    readonly streams: {
      readonly ready: number;
      readonly backfilling: number;
      readonly pending: number;
      readonly verifying: number;
      readonly failed: number;
    },
    readonly errorCodes: readonly string[],
  ) {}

  static from(row: CollectionSyncRunRow): CollectionRunResponseDto {
    return new CollectionRunResponseDto(
      row.runId,
      row.scope,
      row.trigger,
      row.status,
      row.startedAt?.toISOString() ?? null,
      row.lastObservedAt.toISOString(),
      row.cycleCompletedAt?.toISOString() ?? null,
      {
        ready: row.streams.readyCount,
        backfilling: row.streams.backfillingCount,
        pending: row.streams.pendingCount,
        verifying: row.streams.verifyingCount,
        failed: row.streams.failedCount,
      },
      row.errorCodes,
    );
  }
}

export class CollectionRunListResponseDto {
  constructor(readonly runs: readonly CollectionRunResponseDto[]) {}

  static from(
    rows: readonly CollectionSyncRunRow[],
  ): CollectionRunListResponseDto {
    return new CollectionRunListResponseDto(
      rows.map((row) => CollectionRunResponseDto.from(row)),
    );
  }
}
