import { ExternalLink, Megaphone } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useClampedText } from '@/lib/use-clamped-text';
import { cn } from '@/lib/utils';

const URL_PATTERN = /https?:\/\/[\w.~:/?#[\]@!$&'()*+,;=%-]+/g;
const LINK_CLASS = cn(
  'inline-flex max-w-full items-center gap-1 rounded-full border border-border',
  'bg-background px-2 align-middle text-xs font-medium text-foreground',
  'hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
  'focus-visible:outline-none',
);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function linkTarget(match: string): string {
  return match.replace(
    match.includes('(') ? /[.,;:!?'"]+$/ : /[.,;:!?'")\]]+$/,
    '',
  );
}

function linkLabel(url: URL): string {
  return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`;
}

function noticeContent(description: string): readonly ReactNode[] {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const match of description.matchAll(URL_PATTERN)) {
    const target = linkTarget(match[0]);
    const url = parseUrl(target);
    if (url === null) continue;
    const label = linkLabel(url);
    content.push(
      description.slice(cursor, match.index),
      <a
        key={match.index}
        href={url.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${label} (새 탭에서 열림)`}
        className={LINK_CLASS}
      >
        <span className="truncate">{label}</span>
        <ExternalLink aria-hidden className="size-3 shrink-0" />
      </a>,
    );
    cursor = match.index + target.length;
  }
  content.push(description.slice(cursor));
  return content;
}

export function MilestoneNotice({
  description,
  milestoneNameId,
}: {
  readonly description: string;
  readonly milestoneNameId: string;
}) {
  const contentId = useId();
  const { ref, expanded, overflowing, toggle } =
    useClampedText<HTMLParagraphElement>(description);
  return (
    <div
      role="note"
      aria-label="운영자 공지"
      data-slot="milestone-notice"
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2"
    >
      <Megaphone aria-hidden className="mt-0.5 size-4 text-primary" />
      <div className="grid min-w-0 justify-items-start gap-1 border-l-2 border-primary/30 pl-3">
        <p
          id={contentId}
          ref={ref}
          className={cn(
            'text-small leading-normal break-keep whitespace-pre-wrap',
            '[overflow-wrap:anywhere]',
            !expanded && 'line-clamp-3',
          )}
          onFocus={overflowing && !expanded ? toggle : undefined}
        >
          {noticeContent(description)}
        </p>
        {overflowing || expanded ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0 text-foreground underline underline-offset-2"
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-describedby={milestoneNameId}
            onClick={toggle}
          >
            {expanded ? '접기' : '더 보기'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
