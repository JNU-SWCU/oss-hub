import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ReviewContext, SubmissionRevision } from '../types';
import { RevisionCard } from './revision-history';

interface ReviewRevisionComparisonProps {
  readonly context: ReviewContext;
  readonly original: SubmissionRevision | null;
  readonly needsAcknowledgement: boolean;
  readonly isRefreshing: boolean;
  readonly disabled: boolean;
  readonly refreshError: string | null;
  readonly onRefresh?: () => void;
  readonly onAcknowledge?: () => void;
}

export function ReviewRevisionComparison(props: ReviewRevisionComparisonProps) {
  const latest = props.context.currentRevision;
  const changed =
    props.original !== null && props.original.number !== latest.number;
  const original = props.original;
  const availableOriginal = props.context.history.find(
    (revision) => revision.number === original?.number,
  );
  const originalFiles =
    original?.files.flatMap((file) => {
      const available = availableOriginal?.files.find(
        (candidate) => candidate.fileId === file.fileId,
      );
      return available ? [available] : [];
    }) ?? [];
  const unavailableFiles =
    original?.files.filter(
      (file) =>
        !originalFiles.some((available) => available.fileId === file.fileId),
    ) ?? [];
  return (
    <section className="grid min-w-0 gap-4" aria-label="검토 대상 제출본">
      {props.onRefresh ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-muted-foreground">
            화면이 보일 때 30초마다, 화면으로 돌아올 때 최신 제출본을
            확인합니다.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={props.isRefreshing || props.disabled}
            onClick={props.onRefresh}
          >
            {props.isRefreshing ? '확인 중' : '최신 제출본 확인'}
          </Button>
        </div>
      ) : null}
      {props.refreshError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {props.refreshError} 작성 중인 코멘트는 남아 있습니다. 최신 제출본
            확인을 다시 시도해 주세요.
          </AlertDescription>
        </Alert>
      ) : null}
      {changed && props.original ? (
        <>
          <div className="grid gap-2">
            <h2 className="font-heading text-section font-semibold">
              제출본 변경 확인
            </h2>
            <p role="status" className="text-small text-muted-foreground">
              새 제출본이 확인되어 이전 판정 선택을 해제했습니다. 제출 글,
              파일과 제출 시각을 비교해 주세요.
            </p>
          </div>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div
              aria-label="검토를 시작한 제출본"
              className="grid min-w-0 content-start gap-3"
            >
              <h3 className="font-medium">검토를 시작한 제출본</h3>
              <RevisionCard
                revision={{ ...props.original, files: originalFiles }}
              />
              {unavailableFiles.length > 0 ? (
                <ul className="grid gap-2 text-small text-muted-foreground">
                  {unavailableFiles.map((file) => (
                    <li key={file.fileId} className="min-w-0 break-all">
                      <span className="font-medium text-foreground">
                        {file.fileName}
                      </span>
                      <p>
                        현재 제출 이력에서 내려받을 수 없는 파일입니다. 보존
                        기간이 지났거나 삭제되었을 수 있습니다.
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div
              aria-label="최신 제출본"
              className="grid min-w-0 content-start gap-3"
            >
              <h3 className="font-medium">최신 제출본</h3>
              <RevisionCard revision={latest} current />
            </div>
          </div>
          <p className="text-small text-muted-foreground">
            파일 내부의 변경 내용은 각 파일을 열어 확인해 주세요.
          </p>
          {props.needsAcknowledgement ? (
            <Button
              type="button"
              className="w-fit max-w-full"
              disabled={
                props.isRefreshing ||
                props.disabled ||
                Boolean(props.refreshError)
              }
              onClick={props.onAcknowledge}
            >
              제출본 {latest.number}번 확인 완료
            </Button>
          ) : (
            <p role="status" className="text-small text-muted-foreground">
              제출본 {latest.number}번 확인을 마쳤습니다. 결과를 다시 선택해
              주세요.
            </p>
          )}
        </>
      ) : (
        <RevisionCard revision={latest} current />
      )}
    </section>
  );
}
