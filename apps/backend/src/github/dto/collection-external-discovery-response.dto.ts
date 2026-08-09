/** `POST /admin/collection/discover-external` 공개 응답 계약 — 집계 수치만 노출한다. */
export class CollectionExternalDiscoveryResponseDto {
  readonly status = 'COMPLETED' as const;

  constructor(
    readonly githubLogin: string,
    readonly discoveredCount: number,
    readonly upsertedCount: number,
    readonly skippedOrgProvisionedCount: number,
  ) {}
}
