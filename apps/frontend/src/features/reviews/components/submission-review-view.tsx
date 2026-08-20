import type { FormEvent } from 'react';

import { PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';

import { applicationModeLabel } from '../review-format';
import type { ReviewDecisionInput } from '../review-form';
import type { ReviewContext, ReviewDecision } from '../types';
import { RepositoryPublishCard } from './repository-publish-card';
import { RevisionCard } from './revision-history';

/** submission-review-screen과 같은 폭을 쓴다. */
const REVIEW_WIDTH = 'max-w-5xl';

const DECISION_OPTIONS = [
  {
    value: 'APPROVED',
    label: '승인',
    description: '현재 제출본을 승인합니다.',
  },
  {
    value: 'CHANGES_REQUESTED',
    label: '보완 요청',
    description: '코멘트를 반영한 재제출을 허용합니다.',
  },
  {
    value: 'REJECTED',
    label: '최종 반려',
    description: '현재 제출을 최종 반려하고 재제출을 막습니다.',
  },
] as const satisfies readonly {
  readonly value: ReviewDecision;
  readonly label: string;
  readonly description: string;
}[];

export interface SubmissionReviewViewProps {
  readonly context: ReviewContext;
  readonly decision: ReviewDecisionInput;
  readonly comment: string;
  readonly isSaving: boolean;
  readonly isPublishing: boolean;
  readonly formError: string | null;
  readonly notice: string | null;
  readonly publishError: string | null;
  readonly onDecisionChange: (decision: ReviewDecision) => void;
  readonly onCommentChange: (comment: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onPublish: () => void;
}

function ReviewForm(props: SubmissionReviewViewProps) {
  const decisionError = props.decision === '' ? props.formError : null;
  const commentError = props.decision === '' ? null : props.formError;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSave();
  };
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle>검토</CardTitle>
        <CardDescription>
          보완 요청과 최종 반려에는 코멘트가 필요합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={submit}>
          <FieldSet
            aria-invalid={decisionError ? true : undefined}
            aria-describedby={
              decisionError ? 'review-decision-error' : undefined
            }
          >
            <FieldLegend>결과 선택</FieldLegend>
            <div className="grid gap-2 lg:grid-cols-3">
              {DECISION_OPTIONS.map((option) => (
                <FieldLabel key={option.value}>
                  <Field orientation="horizontal">
                    <input
                      type="radio"
                      name="review-decision"
                      value={option.value}
                      checked={props.decision === option.value}
                      disabled={props.isSaving}
                      aria-invalid={decisionError ? true : undefined}
                      onChange={() => props.onDecisionChange(option.value)}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span className="grid gap-0.5">
                      <span>{option.label}</span>
                      <span className="text-small font-normal text-muted-foreground [word-break:keep-all]">
                        {option.description}
                      </span>
                    </span>
                  </Field>
                </FieldLabel>
              ))}
            </div>
            {decisionError ? (
              <FieldError id="review-decision-error">
                {decisionError}
              </FieldError>
            ) : null}
          </FieldSet>
          <Field data-invalid={commentError ? 'true' : undefined}>
            <FieldLabel htmlFor="review-comment">코멘트</FieldLabel>
            <textarea
              id="review-comment"
              rows={5}
              value={props.comment}
              disabled={props.isSaving}
              aria-invalid={commentError ? true : undefined}
              aria-describedby={
                commentError
                  ? 'review-comment-description review-comment-error'
                  : 'review-comment-description'
              }
              onChange={(event) => props.onCommentChange(event.target.value)}
              className="min-h-28 w-full resize-y rounded-control border border-input bg-transparent p-4 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              placeholder="검토 근거와 필요한 보완 내용을 입력하세요."
            />
            <FieldDescription id="review-comment-description">
              승인 코멘트는 선택 사항입니다.
            </FieldDescription>
            {commentError ? (
              <FieldError id="review-comment-error">{commentError}</FieldError>
            ) : null}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={props.isSaving}
              onClick={props.onCancel}
            >
              취소
            </Button>
            <Button type="submit" disabled={props.isSaving}>
              {props.isSaving ? '저장 중' : '저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * 이력이 비어 있는 것과 실제로 첫 제출인 것은 다르다. 회차 값이 근거이고,
 * 이력 유무는 근거가 아니다. 2회차 이상인데 이력이 비면 조회가 실패했거나
 * 잘린 것이므로 최초 제출로 안내하면 교직원이 재제출본을 오인한다.
 */
function EmptyHistoryNotice({
  currentNumber,
}: {
  readonly currentNumber: number;
}) {
  return (
    <p className="rounded-card border border-border p-card text-small text-muted-foreground [word-break:keep-all]">
      {currentNumber > 1
        ? `지금 화면의 제출본은 ${currentNumber}번째라 이전 제출본이 있어야 하지만, 이력을 불러오지 못했습니다. 최초 제출로 보지 말고 화면을 새로고침한 뒤, 그래도 비어 있으면 담당자에게 알려 주세요.`
        : '이전 제출본이 없습니다. 지금 화면의 제출본이 최초 제출입니다.'}
    </p>
  );
}

export function SubmissionReviewView(props: SubmissionReviewViewProps) {
  const reviewContext = props.context;
  return (
    <PageBody className={REVIEW_WIDTH}>
      <PageHeader
        title="최종 제출 검토"
        description={`${reviewContext.application.displayName}, ${applicationModeLabel(reviewContext.application.applicationMode)}, ${reviewContext.milestone.name}`}
      />
      {/* 섹션 사이 64 — 검토 대상 / 판정 / 이력 / 공개 전환 */}
      <div className="flex min-w-0 flex-col gap-16">
        {props.notice ? (
          <Alert>
            <AlertDescription>{props.notice}</AlertDescription>
          </Alert>
        ) : null}
        <RevisionCard revision={reviewContext.currentRevision} current />
        {reviewContext.currentRevision.review ? null : (
          <ReviewForm {...props} />
        )}
        <section
          className="grid gap-4"
          aria-labelledby="revision-history-title"
        >
          <h2
            id="revision-history-title"
            className="font-heading text-section font-semibold tracking-[-0.02em]"
          >
            이전 제출본과 검토 이력
          </h2>
          {reviewContext.history.length > 0 ? (
            reviewContext.history.map((revision) => (
              <RevisionCard key={revision.number} revision={revision} />
            ))
          ) : (
            <EmptyHistoryNotice
              currentNumber={reviewContext.currentRevision.number}
            />
          )}
        </section>
        <RepositoryPublishCard
          repository={reviewContext.repository}
          isPublishing={props.isPublishing}
          errorMessage={props.publishError}
          onPublish={props.onPublish}
        />
      </div>
    </PageBody>
  );
}
