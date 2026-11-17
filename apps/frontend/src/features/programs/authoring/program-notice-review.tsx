import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ProgramCover } from '@/components/program/program-cover';
import type { ProgramNoticePreview } from './program-notice-dto';
import type { NoticeReviewRow } from './program-notice-review-model';

export function ProgramNoticeReview({
  preview,
  rows,
  checked,
  onCheck,
  cover,
  onCover,
}: {
  readonly preview: ProgramNoticePreview;
  readonly rows: readonly NoticeReviewRow[];
  readonly checked: ReadonlySet<string>;
  readonly onCheck: (key: string, value: boolean) => void;
  readonly cover: string | null;
  readonly onCover: (cover: string | null) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[auto_5.5rem_minmax(0,1fr)] items-start gap-x-3 text-small">
        {rows.map((row) => {
          const equal = row.current.trim() === row.next?.trim();
          return (
            <label
              key={row.key}
              className={cn(
                'col-span-3 grid grid-cols-subgrid items-start border-b border-border py-2.5',
                !row.next || equal
                  ? 'cursor-default text-muted-foreground'
                  : 'cursor-pointer',
              )}
            >
              <input
                type="checkbox"
                name={`notice-${row.key}`}
                className="mt-0.5 size-4 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
                disabled={!row.next || equal}
                checked={Boolean(row.next && !equal && checked.has(row.key))}
                onChange={(event) => onCheck(row.key, event.target.checked)}
              />
              <span className="font-semibold">{row.label}</span>
              {!row.next ? (
                <span>공고에서 찾지 못함</span>
              ) : equal ? (
                <span className="grid gap-0.5">
                  <span>변경 없음</span>
                  <span className="line-clamp-2 break-words whitespace-pre-line">
                    {row.next}
                  </span>
                </span>
              ) : (
                <span className="grid min-w-0 gap-0.5">
                  {row.current.trim() ? (
                    <s className="line-clamp-1 break-words text-muted-foreground">
                      {row.current}
                    </s>
                  ) : (
                    <span className="text-muted-foreground">비어 있음</span>
                  )}
                  <span
                    data-slot={
                      row.key === 'description'
                        ? 'notice-description-preview'
                        : undefined
                    }
                    className="line-clamp-2 break-words whitespace-pre-line"
                  >
                    {row.next}
                  </span>
                </span>
              )}
            </label>
          );
        })}
      </div>
      {preview.coverImages.length ? (
        <div className="grid grid-cols-[auto_5.5rem_minmax(0,1fr)] items-start gap-x-3 text-small">
          <input
            type="checkbox"
            aria-label="대표 이미지"
            className="mt-0.5 size-4 accent-primary"
            checked={cover !== null}
            onChange={(event) =>
              onCover(
                event.target.checked ? (preview.coverImages[0] ?? null) : null,
              )
            }
          />
          <span className="font-semibold">대표 이미지</span>
          <div className="flex flex-wrap gap-2">
            {preview.coverImages.map((image, index) => (
              <Button
                key={image}
                type="button"
                variant="bare"
                size="content"
                aria-label={`이미지 ${index + 1}`}
                aria-pressed={cover === image}
                onClick={() => onCover(image)}
                className={cn(
                  'w-16 overflow-hidden rounded-md border-2 focus-visible:outline-2 focus-visible:outline-ring',
                  cover === image
                    ? 'border-primary'
                    : 'border-transparent opacity-60',
                )}
              >
                <ProgramCover src={image} sizes="60px" />
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-small text-muted-foreground">
          대표 이미지: 공고에서 찾지 못함
        </p>
      )}
      {preview.warnings.includes('EXTERNAL_APPLICATION_LINK') ? (
        <p className="text-small text-muted-foreground">
          원문의 신청 안내를 사이트의 신청·제출 방식에 맞게 확인하세요.
        </p>
      ) : null}
    </div>
  );
}
