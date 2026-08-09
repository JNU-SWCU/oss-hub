import type {
  CollectionSyncRunRow,
  CollectionSyncRunStatusProjection,
  CollectionSyncRunTrigger,
} from '../collection-incremental.types';

/**
 * #511 — `GET /admin/collection/runs`의 공개 응답 계약(ADMIN 전용).
 *
 * 담지 않는 것: lease `ownerId`, App/installation 자격증명, 저장소 이름·visibility.
 * ownerId는 `trigger` 분류로만 환원해 노출한다 — 시크릿·토큰 값이 응답에 실리지 않아야
 * 한다는 것이 이 이슈의 수용 기준이다.
 */
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
