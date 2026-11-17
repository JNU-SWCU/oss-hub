import { Button } from '@/components/ui/button';
import { ProgramCover } from '@/components/program/program-cover';
import { cn } from '@/lib/utils';
import type { ProgramNoticeList } from './program-notice-dto';

export function ProgramNoticeCards({
  items,
  page,
  onPage,
  onPick,
}: {
  readonly items: ProgramNoticeList['items'];
  readonly page: number;
  readonly onPage: (page: number) => void;
  readonly onPick: (url: string) => void;
}) {
  const limited = items.slice(0, 10);
  return (
    <div className="grid gap-3">
      {limited.length === 0 ? (
        <p className="text-small text-muted-foreground">
          불러올 공고가 없습니다. 닫은 후 직접 입력하세요.
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {limited.slice(page * 5, page * 5 + 5).map((notice) => (
          <li key={notice.url}>
            <Button
              type="button"
              variant="bare"
              size="content"
              aria-label={notice.title}
              onClick={() => onPick(notice.url)}
              className={cn(
                'grid w-full gap-2 rounded-card border border-border p-2 text-left',
                'hover:border-primary hover:bg-muted/40',
              )}
            >
              {notice.thumbnailUrl ? (
                <ProgramCover
                  src={notice.thumbnailUrl}
                  sizes="(min-width: 640px) 96px, 50vw"
                />
              ) : (
                <span
                  className={cn(
                    'flex aspect-[1/1.414] w-full items-end overflow-hidden rounded-md bg-muted p-2',
                    'text-small font-bold leading-snug break-keep',
                  )}
                >
                  <span className="line-clamp-5">{notice.title}</span>
                </span>
              )}
              {notice.thumbnailUrl ? (
                <span className="line-clamp-2 h-[2.6em] text-small font-semibold break-keep">
                  {notice.title}
                </span>
              ) : (
                <span className="h-[2.6em]" aria-hidden="true" />
              )}
              <span className="text-xs text-muted-foreground">
                {notice.postedAt.replaceAll('-', '.')}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {limited.length > 5 ? (
        <nav
          aria-label="공고 페이지"
          className="flex items-center justify-center gap-1"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="이전"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            ‹
          </Button>
          {[0, 1].map((index) => (
            <Button
              key={index}
              type="button"
              size="sm"
              variant={index === page ? 'default' : 'ghost'}
              aria-current={index === page ? 'page' : undefined}
              onClick={() => onPage(index)}
            >
              {index + 1}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="다음"
            disabled={(page + 1) * 5 >= limited.length}
            onClick={() => onPage(page + 1)}
          >
            ›
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
