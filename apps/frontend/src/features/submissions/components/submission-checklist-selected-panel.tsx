import Link from 'next/link';
import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { programDocumentsHref } from '@/lib/program-route';
import type { SubmissionUploadLimit } from '@/lib/submission-upload-policy';
import { MilestoneDocumentCurrentFiles } from '../milestone-document-current-files';
import {
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUS_VARIANTS,
  isRevisionNeeded,
} from '../submission-checklist';
import type {
  SubmissionFormErrors,
  SubmissionFormInput,
} from '../submission-form';
import type { ChecklistSubmission, SubmissionChecklistItem } from '../types';
import { SubmissionFormActions } from './submission-form-actions';
import { SubmissionInput } from './submission-input';
import { SubmissionReviewMeta } from './submission-review-meta';

export interface SelectedMilestonePanelProps {
  readonly fileUpload: SubmissionUploadLimit;
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
  // 닫기 핸들러가 있으면 뷰(submission-checklist-view)가 이 패널을
  // SubmissionDialog 안에 넣은 것이고, 창 제목이 이미 마일스톤 이름을 말한다.
  // 닫기가 없는 단독 사용처에서는 이 패널이 유일한 제목이라 카드를 그대로 둔다.
  const embedded = props.onCloseSelected !== undefined;
  if (!item.submission) {
    return (
      <PanelCard item={item} status="NOT_SUBMITTED" embedded={embedded}>
        <p className="text-sm text-muted-foreground">
          아직 제출 전입니다. 제출 화면에서 최초 제출을 진행해 주세요.
        </p>
        <Button asChild className="w-fit">
          <Link href={programDocumentsHref(props.programId, item.milestoneId)}>
            제출하기
          </Link>
        </Button>
      </PanelCard>
    );
  }
  const submission = item.submission;
  if (isRevisionNeeded(submission)) {
    return <ResubmissionForm {...props} submission={submission} />;
  }
  switch (submission.status) {
    case 'APPROVED':
      // 승인은 배지와 검토 결과로 이미 두 번 적혔다 — 거기에 "승인되었습니다"를
      // 더하면 같은 말을 세 번 읽힌다. 제출본 번호는 검토 메타가 한 번 말한다.
      return (
        <PanelCard item={item} status="APPROVED" embedded={embedded}>
          <SubmissionReviewMeta submission={submission} />
        </PanelCard>
      );
    case 'REJECTED':
      return (
        <PanelCard item={item} status="REJECTED" embedded={embedded}>
          <SubmissionReviewMeta submission={submission} />
          <p className="text-sm text-muted-foreground">
            최종 반려된 제출은 재제출할 수 없습니다.
          </p>
        </PanelCard>
      );
    case 'SUBMITTED':
      // 상태는 배지가 말하고, 글은 그 상태가 무엇을 막는지만 덧붙인다.
      // 누를 수 없는 「검토 대기 중」 버튼은 없앴다 — 누르는 자리처럼 생겼지만
      // 아무 일도 하지 않고, 세 번째로 같은 상태를 다시 적을 뿐이다.
      return (
        <PanelCard item={item} status="SUBMITTED" embedded={embedded}>
          <p className="text-sm text-muted-foreground">
            교직원 검토가 끝날 때까지는 제출 내용을 바꿀 수 없습니다.
          </p>
          <SubmissionReviewMeta submission={submission} />
          <SubmissionInput
            fileUpload={props.fileUpload}
            submissionType={item.submissionType}
            input={props.input}
            errors={{}}
            disabled
            onTextChange={props.onTextChange}
          />
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
  // form이 카드를 감싼다 — 마지막 줄(취소·재제출)은 카드 밖에 있어야 스크롤 상자
  // 바닥에 붙는다. 카드는 `overflow-hidden`이라 그 안에서는 sticky가 걸리지 않는다.
  return (
    <form
      className="grid min-w-0 gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        props.onResubmit();
      }}
    >
      <PanelCard
        item={item}
        status="CHANGES_REQUESTED"
        embedded={props.onCloseSelected !== undefined}
        testId="resubmission"
      >
        <p className="text-sm text-muted-foreground">
          {submission.status === 'CHANGES_REQUESTED'
            ? '보완 요청에 따라 수정한 뒤 재제출할 수 있습니다.'
            : '마감 전에는 제출물을 교체할 수 있습니다.'}
        </p>
        <SubmissionReviewMeta submission={submission} />
        <SubmissionInput
          fileUpload={props.fileUpload}
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
      </PanelCard>
      <SubmissionFormActions
        submitting={props.submitting}
        onCancel={props.onCloseSelected}
        submitLabel={
          props.submitting
            ? props.submissionPhase === 'uploading'
              ? '업로드 중…'
              : '제출 중…'
            : `제출본 ${submission.currentRevision + 1}번 제출`
        }
      />
    </form>
  );
}

function PanelCard({
  item,
  status,
  embedded,
  testId,
  children,
}: {
  readonly item: SubmissionChecklistItem;
  readonly status: keyof typeof CHECKLIST_STATUS_LABELS;
  readonly embedded: boolean;
  readonly testId?: string;
  readonly children: React.ReactNode;
}) {
  const badge = (
    <StatusBadge variant={CHECKLIST_STATUS_VARIANTS[status]}>
      {CHECKLIST_STATUS_LABELS[status]}
    </StatusBadge>
  );
  const body = (
    <>
      {children}
      <MilestoneDocumentCurrentFiles milestoneId={item.milestoneId} />
    </>
  );
  if (embedded) {
    // 창 안에 서 카드를 또 세우면 마일스톤 이름이 바로 위아래로 두 번 적히고,
    // 모바일에서는 테두리 안에 테두리가 들어 있는 모양이 된다.
    return (
      <div
        data-testid={testId ?? 'milestone-panel'}
        className="grid min-w-0 gap-5 break-keep"
      >
        <div className="flex flex-wrap items-center gap-2">{badge}</div>
        {body}
      </div>
    );
  }
  return (
    <Card data-testid={testId ?? 'milestone-panel'}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl">
            <h2>{item.name}</h2>
          </CardTitle>
          {badge}
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 break-keep">{body}</CardContent>
    </Card>
  );
}
