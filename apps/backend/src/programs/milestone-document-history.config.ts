export function nextMilestoneDocumentHistoryCreatedAt(
  requested: Date,
  latest: Date | null,
): Date {
  return latest === null || requested.getTime() > latest.getTime()
    ? requested
    : new Date(latest.getTime() + 1);
}
