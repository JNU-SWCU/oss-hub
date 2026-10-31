export class MilestoneDocumentArchiveEntryError extends Error {
  override readonly name = 'MilestoneDocumentArchiveEntryError';

  constructor(
    readonly storageKey: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
