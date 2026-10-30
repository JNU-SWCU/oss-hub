export class CollectionSnapshotBackfillResponseDto {
  readonly accepted = true as const;

  constructor(readonly year: number) {}
}
