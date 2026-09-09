export type DocumentDeliveryStatus =
  'MISSING' | 'LATE' | 'COMPLETE' | 'NO_REQUIRED_ITEMS';

/** Review decisions and later revisions do not change the first-success delivery axis. */
export function documentDeliveryStatus(input: {
  readonly requiredFirstSubmissions: readonly (Date | null)[];
  readonly dueAt: Date | null;
}): DocumentDeliveryStatus {
  if (input.requiredFirstSubmissions.length === 0) return 'NO_REQUIRED_ITEMS';
  if (
    input.requiredFirstSubmissions.some((submittedAt) => submittedAt === null)
  )
    return 'MISSING';
  const dueAt = input.dueAt;
  if (
    dueAt !== null &&
    input.requiredFirstSubmissions.some(
      (submittedAt) => submittedAt !== null && submittedAt > dueAt,
    )
  )
    return 'LATE';
  return 'COMPLETE';
}
