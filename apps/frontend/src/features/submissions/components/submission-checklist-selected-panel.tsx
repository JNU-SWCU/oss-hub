import Link from 'next/link';
import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { studentProgramSubmissionHref } from '@/lib/program-route';
import {
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUS_VARIANTS,
} from '../submission-checklist';
import type {
  SubmissionFormErrors,
  SubmissionFormInput,
} from '../submission-form';
import type { ChecklistSubmission, SubmissionChecklistItem } from '../types';
import { SubmissionInput } from './submission-input';
import { SubmissionReviewMeta } from './submission-review-meta';

export interface SelectedMilestonePanelProps {
  readonly programId: string;
  readonly item: SubmissionChecklistItem;
  readonly input: SubmissionFormInput;
  readonly comment: string;
  readonly errors: SubmissionFormErrors;
  readonly fileError: string | null;
  readonly submitting: boolean;
  readonly submissionPhase: 'uploading' | 'creating' | null;
  readonly onCloseSelected?: () => void;
  readonly onTextChange: (value: string) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onCommentChange: (value: string) => void;
  readonly onResubmit: () => void;
}

export function SelectedMilestonePanel(props: SelectedMilestonePanelProps) {
  const { item } = props;
  if (!item.submission) {
    return (
      <PanelCard item={item} status="NOT_SUBMITTED">
        <p className="text-sm text-muted-foreground">
          아직 제출 전입니다. 제출 화면에서 최초 제출을 진행해 주세요.
        </p>
        <Button asChild className="w-fit">
          <Link
            href={studentProgramSubmissionHref(
              props.programId,
              item.milestoneId,
            )}
          >
            제출하기
          </Link>
        </Button>
      </PanelCard>
    );
  }
  const submission = item.submission;
  if (submission.canResubmit) {
    return <ResubmissionForm {...props} submission={submission} />;
  }
  switch (submission.status) {
    case 'APPROVED':
      return (
        <PanelCard item={item} status="APPROVED">
          <p className="text-sm text-muted-foreground">
            제출본 {submission.currentRevision}번이 승인되었습니다.
          </p>
          <SubmissionReviewMeta submission={submission} />
        </PanelCard>
      );
    case 'REJECTED':
      return (
        <PanelCard item={item} status="REJECTED">
          <SubmissionReviewMeta submission={submission} />
          <p className="text-sm text-muted-foreground">
            최종 반려된 제출은 재제출할 수 없습니다.
          </p>
        </PanelCard>
      );
    case 'SUBMITTED':
      return (
        <PanelCard item={item} status="SUBMITTED">
          <p className="text-sm text-muted-foreground">
            제출본 {submission.currentRevision}번이 검토 대기 중입니다. 검토가
            끝날 때까지 입력이 비활성화됩니다.
          </p>
          <SubmissionReviewMeta submission={submission} />
          <SubmissionInput
            submissionType={item.submissionType}
            input={props.input}
            errors={{}}
            disabled
            onTextChange={props.onTextChange}
          />
          <Button type="button" disabled className="w-fit">
            검토 대기 중
          </Button>
        </PanelCard>
      );
    case 'CHANGES_REQUESTED':
      return <ResubmissionForm {...props} submission={submission} />;
    default: {
      const exhaustiveStatus: never = submission.status;
      return exhaustiveStatus;
    }
  }
}

function ResubmissionForm(
  props: SelectedMilestonePanelProps & {
    readonly submission: ChecklistSubmission;
  },
) {
  const { item, submission } = props;
  return (
    <PanelCard item={item} status="CHANGES_REQUESTED" testId="resubmission">
      <p className="text-sm text-muted-foreground">
        {submission.status === 'CHANGES_REQUESTED'
          ? '보완 요청에 따라 수정한 뒤 재제출할 수 있습니다.'
          : '마감 전에는 제출물을 교체할 수 있습니다.'}
      </p>
      <SubmissionReviewMeta submission={submission} />
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">현재 제출본</dt>
          <dd className="text-muted-foreground">
            {submission.currentRevision}번
          </dd>
        </div>
      </dl>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          props.onResubmit();
        }}
      >
        <SubmissionInput
          submissionType={item.submissionType}
          input={props.input}
          errors={props.errors}
          disabled={props.submitting}
          file={props.input.file}
          fileError={props.fileError}
          onTextChange={props.onTextChange}
          onFileChange={props.onFileChange}
        />
        <Field>
          <FieldLabel htmlFor="resubmission-comment">제출 코멘트</FieldLabel>
          <textarea
            id="resubmission-comment"
            value={props.comment}
            maxLength={2000}
            disabled={props.submitting}
            aria-describedby="resubmission-comment-description"
            onChange={(event) => props.onCommentChange(event.target.value)}
            className="min-h-28 w-full resize-y rounded-lg border border-input bg-transparent p-3 text-sm leading-6 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <FieldDescription id="resubmission-comment-description">
            선택 입력 · 최대 2,000자
          </FieldDescription>
        </Field>
        {props.submissionPhase ? (
          <p role="status" aria-live="polite" className="text-sm">
            {props.submissionPhase === 'uploading'
              ? '파일 업로드 중…'
              : '제출 정보 저장 중…'}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={props.onCloseSelected}
          >
            취소
          </Button>
          <Button type="submit" disabled={props.submitting}>
            {props.submitting
              ? props.submissionPhase === 'uploading'
                ? '업로드 중…'
                : '제출 중…'
              : `제출본 ${submission.currentRevision + 1}번 제출`}
          </Button>
        </div>
      </form>
    </PanelCard>
  );
}

function PanelCard({
  item,
  status,
  testId,
  children,
}: {
  readonly item: SubmissionChecklistItem;
  readonly status: keyof typeof CHECKLIST_STATUS_LABELS;
  readonly testId?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Card data-testid={testId ?? 'milestone-panel'}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl">
            <h2>{item.name}</h2>
          </CardTitle>
          <StatusBadge variant={CHECKLIST_STATUS_VARIANTS[status]}>
            {CHECKLIST_STATUS_LABELS[status]}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 break-keep">{children}</CardContent>
    </Card>
  );
}
