export const COLLECTION_HEALTH_VALUES = [
  'NORMAL',
  'DELAYED',
  'FAILED',
] as const;
export type CollectionHealthResponseDto =
  (typeof COLLECTION_HEALTH_VALUES)[number];

export const CURRENT_RUN_STATUS_VALUES = [
  'IDLE',
  'PENDING',
  'PROCESSING',
] as const;
export type CurrentRunStatusResponseDto =
  (typeof CURRENT_RUN_STATUS_VALUES)[number];

export const SYSTEM_STATUS_SAFE_REASONS = [
  'NO_COMPLETE_DATA',
  'INSTALLATION_INVALID',
  'PERMISSION_INVALID',
  'STALE_DATA',
  'RUN_INCOMPLETE',
  'UPSTREAM_RATE_LIMITED',
  'RUN_FAILED',
] as const;
export type SystemStatusSafeReasonResponseDto =
  (typeof SYSTEM_STATUS_SAFE_REASONS)[number];

export class CollectionSystemStatusResponseDto {
  constructor(
    readonly health: CollectionHealthResponseDto,
    readonly lastCompleteSuccessAt: string | null,
    readonly dataAsOf: string | null,
    readonly currentRunStatus: CurrentRunStatusResponseDto,
    readonly safeReason: SystemStatusSafeReasonResponseDto | null,
  ) {}
}

export class SystemStatusResponseDto {
  constructor(readonly collection: CollectionSystemStatusResponseDto) {}
}
