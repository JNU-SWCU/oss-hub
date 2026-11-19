const DEADLINE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

export function formatDeadlineDate(dueAt: string): string {
  const parts = DEADLINE_FORMAT.formatToParts(new Date(dueAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${part('month')}.${part('day')} (${part('weekday')}) 마감`;
}

export function DeadlineDate({ dueAt }: { readonly dueAt: string }) {
  return (
    <time
      dateTime={dueAt}
      className="text-small font-normal text-muted-foreground"
    >
      {formatDeadlineDate(dueAt)}
    </time>
  );
}
