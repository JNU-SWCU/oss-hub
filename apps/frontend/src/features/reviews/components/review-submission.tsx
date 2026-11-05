import { useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ReviewContext } from '../types';
import { RevisionCard } from './revision-history';

interface ReviewSubmissionProps {
  readonly context: ReviewContext;
  readonly needsLatestRevision: boolean;
  readonly isRefreshing: boolean;
  readonly disabled: boolean;
  readonly refreshError: string | null;
  readonly onRefresh?: () => void;
  readonly onOpenLatestRevision?: () => void;
}

export function ReviewSubmission(props: ReviewSubmissionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const latest = props.context.currentRevision;
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="grid min-w-0 gap-4"
      aria-label="검토 대상 제출본"
    >
      {props.refreshError ? (
        <Alert variant="destructive">
          <AlertDescription className="break-keep">
            {props.refreshError} 작성 중인 코멘트는 남아 있습니다. 최신 제출본
            확인을 다시 시도해 주세요.
          </AlertDescription>
        </Alert>
      ) : null}
      {props.needsLatestRevision && !props.refreshError ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-small text-muted-foreground">
            제출본 또는 검토 결과가 변경되었습니다.
          </p>
          <Button
            type="button"
            disabled={props.isRefreshing || props.disabled}
            onClick={() => {
              props.onOpenLatestRevision?.();
              sectionRef.current?.focus();
            }}
          >
            최신 제출본 {latest.number}번 열기
          </Button>
        </div>
      ) : props.onRefresh ? (
        <Button
          type="button"
          variant="outline"
          className="justify-self-end"
          disabled={props.isRefreshing || props.disabled}
          onClick={props.onRefresh}
        >
          {props.isRefreshing ? '확인 중' : '최신 제출본 확인'}
        </Button>
      ) : null}
      {props.needsLatestRevision ? null : (
        <RevisionCard
          revision={latest}
          current
          hasUnversionedReview={Boolean(
            props.context.unversionedReviews?.length,
          )}
        />
      )}
    </section>
  );
}
