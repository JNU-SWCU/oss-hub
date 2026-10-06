import type { AuditLogSentenceSegment } from './describe';

export function AuditLogSentence({
  segments,
}: {
  readonly segments: readonly AuditLogSentenceSegment[];
}) {
  return (
    <>
      {segments.map((segment, index) => {
        const key = `${segment.kind}-${index}`;
        if (segment.kind === 'text') {
          return <span key={key}>{segment.value}</span>;
        }
        if (segment.kind === 'actor') {
          return (
            <span key={key} className="font-medium">
              {segment.value}
            </span>
          );
        }
        if (segment.kind === 'target') {
          if (segment.variant === 'handle') {
            return (
              <span key={key} className="font-medium">
                @{segment.value}
              </span>
            );
          }
          if (segment.variant === 'name') {
            return (
              <span key={key} className="font-medium">
                {segment.value}
              </span>
            );
          }
          return (
            <code
              key={key}
              className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
            >
              {segment.value}
            </code>
          );
        }
        return (
          <code
            key={key}
            className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
          >
            {segment.value}
          </code>
        );
      })}
    </>
  );
}
