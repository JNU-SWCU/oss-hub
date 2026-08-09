export class CollectionTriggerResponseDto {
  readonly status = 'PENDING' as const;

  constructor(readonly runId: string) {}
}
