export class CollectionTriggerResponseDto {
  readonly status = 'STARTED' as const;

  constructor(readonly runId: string) {}
}
