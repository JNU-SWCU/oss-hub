import type { FormEvent } from 'react';

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

import type { ReviewDecision } from '../types';
import type { SubmissionReviewViewProps } from './submission-review-view';

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

export function ReviewForm(props: SubmissionReviewViewProps) {
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
          {props.needsAcknowledgement ? (
            <p role="status" className="text-small text-muted-foreground">
              최신 제출본 확인을 마친 뒤 결과를 다시 선택해 주세요. 작성 중인
              코멘트는 유지됩니다.
            </p>
          ) : null}
          <FieldSet
            disabled={props.needsAcknowledgement}
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
                      disabled={props.isSaving || props.needsAcknowledgement}
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
            <Button
              type="submit"
              disabled={
                props.isSaving ||
                props.isRefreshing ||
                props.needsAcknowledgement
              }
            >
              {props.isSaving ? '저장 중' : '저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
