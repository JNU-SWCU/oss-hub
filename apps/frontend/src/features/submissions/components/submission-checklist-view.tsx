import Link from 'next/link';
import { EmptyState, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUS_VARIANTS,
  checklistItemStatus,
  deadlineVariant,
  milestoneDeadline,
  sortChecklistItems,
} from '../submission-checklist';
import type {
  SubmissionFormErrors,
  SubmissionFormInput,
} from '../submission-form';
import type {
  ChecklistSubmission,
  SubmissionChecklist,
  SubmissionChecklistItem,
} from '../types';
import { formatDeadline, TYPE_LABELS } from './submission-form-view';
import { SubmissionInput } from './submission-input';

function checklistHref(programId: string, milestoneId?: string): string {
  const base = `/programs/${encodeURIComponent(programId)}/submissions`;
  return milestoneId
    ? `${base}?milestoneId=${encodeURIComponent(milestoneId)}`
    : base;
}

function submitHref(programId: string, milestoneId: string): string {
  return `/programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(milestoneId)}/submit`;
}

export interface SubmissionChecklistViewProps {
  readonly programId: string;
  readonly checklist: SubmissionChecklist;
  readonly selectedMilestoneId: string | null;
  /** D-day 계산 기준 시각 — 테스트에서 고정할 수 있도록 주입한다. */
  readonly now: Date;
  readonly input: SubmissionFormInput;
  readonly comment: string;
  readonly errors: SubmissionFormErrors;
  readonly serverError: string | null;
  readonly staleNotice: string | null;
  readonly toastMessage: string | null;
  readonly submitting: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onReleaseUrlChange: (value: string) => void;
  readonly onCommentChange: (value: string) => void;
  readonly onResubmit: () => void;
}

export function SubmissionChecklistView(props: SubmissionChecklistViewProps) {
  const items = sortChecklistItems(props.checklist.items);
  const selected =
    items.find((item) => item.milestoneId === props.selectedMilestoneId) ??
    null;
  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">제출 체크리스트</h1>
        <p className="text-sm text-muted-foreground">
          마일스톤별 제출 상태를 확인하고, 보완 요청을 받은 제출을 재제출할 수
          있습니다.
        </p>
      </header>
      {props.toastMessage ? (
        <div
          role="status"
          className="rounded-lg border border-status-approved-bg bg-status-approved-bg px-3 py-2 text-sm text-status-approved-fg"
        >
          {props.toastMessage}
        </div>
      ) : null}
      {props.staleNotice ? (
        <Alert>
          <AlertTitle>제출 상태가 변경되었습니다</AlertTitle>
          <AlertDescription>{props.staleNotice}</AlertDescription>
        </Alert>
      ) : null}
      {props.serverError ? (
        <Alert variant="destructive">
          <AlertTitle>재제출 실패</AlertTitle>
          <AlertDescription>{props.serverError}</AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title="표시할 마일스톤이 없습니다"
          description="프로그램에 마일스톤이 아직 등록되지 않았습니다."
        />
      ) : (
        <ul className="grid list-none gap-3 p-0" data-testid="checklist">
          {items.map((item) => (
            <ChecklistRow
              key={item.milestoneId}
              programId={props.programId}
              item={item}
              now={props.now}
            />
          ))}
        </ul>
      )}
      {selected ? <SelectedMilestonePanel {...props} item={selected} /> : null}
    </main>
  );
}

function ChecklistRow({
  programId,
  item,
  now,
}: {
  readonly programId: string;
  readonly item: SubmissionChecklistItem;
  readonly now: Date;
}) {
  const status = checklistItemStatus(item);
  const deadline = milestoneDeadline(item.dueAt, now);
  return (
    <li>
      <Card className="gap-3" data-testid="checklist-row">
        <CardHeader className="gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-1">
            <CardTitle>{item.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {formatDeadline(item.dueAt)} · {TYPE_LABELS[item.submissionType]}
            </p>
          </div>
          <StatusBadge variant={deadlineVariant(deadline.dDay)}>
            {deadline.label}
          </StatusBadge>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge variant={CHECKLIST_STATUS_VARIANTS[status]}>
            {CHECKLIST_STATUS_LABELS[status]}
          </StatusBadge>
          <Button asChild size="sm" variant="outline">
            {status === 'NOT_SUBMITTED' ? (
              <Link href={submitHref(programId, item.milestoneId)}>
                제출하기
              </Link>
            ) : (
              <Link href={checklistHref(programId, item.milestoneId)}>
                {status === 'CHANGES_REQUESTED' ? '사유·재제출' : '보기'}
              </Link>
            )}
          </Button>
        </CardContent>
      </Card>
    </li>
  );
}

function SelectedMilestonePanel(
  props: SubmissionChecklistViewProps & {
    readonly item: SubmissionChecklistItem;
  },
) {
  const { item } = props;
  if (!item.submission) {
    return (
      <PanelCard item={item} status="NOT_SUBMITTED">
        <p className="text-sm text-muted-foreground">
          아직 제출 전입니다. 제출 화면에서 최초 제출을 진행해 주세요.
        </p>
        <Button asChild className="w-fit">
          <Link href={submitHref(props.programId, item.milestoneId)}>
            제출하기
          </Link>
        </Button>
      </PanelCard>
    );
  }
  const submission = item.submission;
  switch (submission.status) {
    case 'APPROVED':
      return (
        <PanelCard item={item} status="APPROVED">
          <p className="text-sm text-muted-foreground">
            revision {submission.currentRevision} 제출이 승인되었습니다.
          </p>
          <ReviewMeta submission={submission} />
        </PanelCard>
      );
    case 'REJECTED':
      return (
        <PanelCard item={item} status="REJECTED">
          <ReviewMeta submission={submission} />
          <p className="text-sm text-muted-foreground">
            최종 반려된 제출은 재제출할 수 없습니다.
          </p>
        </PanelCard>
      );
    case 'SUBMITTED':
      return (
        <PanelCard item={item} status="SUBMITTED">
          <p className="text-sm text-muted-foreground">
            revision {submission.currentRevision} 검토 대기 중입니다. 검토가
            끝날 때까지 입력이 비활성화됩니다.
          </p>
          <ReviewMeta submission={submission} />
          <SubmissionInput
            submissionType={item.submissionType}
            repositoryUrl={null}
            input={props.input}
            errors={{}}
            disabled
            onTextChange={props.onTextChange}
            onReleaseUrlChange={props.onReleaseUrlChange}
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
  props: SubmissionChecklistViewProps & {
    readonly item: SubmissionChecklistItem;
    readonly submission: ChecklistSubmission;
  },
) {
  const { item, submission } = props;
  return (
    <PanelCard item={item} status="CHANGES_REQUESTED" testId="resubmission">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">교직원 코멘트</dt>
          <dd className="whitespace-pre-wrap text-muted-foreground">
            {submission.reviewComment ?? '코멘트가 없습니다.'}
          </dd>
        </div>
        <div>
          <dt className="font-medium">현재 revision</dt>
          <dd className="text-muted-foreground">
            {submission.currentRevision}
          </dd>
        </div>
      </dl>
      {item.submissionType === 'FILE' ? (
        <Alert>
          <AlertTitle>지금은 재제출할 수 없습니다</AlertTitle>
          <AlertDescription>
            파일 제출은 현재 지원하지 않습니다.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            props.onResubmit();
          }}
        >
          <SubmissionInput
            submissionType={item.submissionType}
            repositoryUrl={null}
            input={props.input}
            errors={props.errors}
            onTextChange={props.onTextChange}
            onReleaseUrlChange={props.onReleaseUrlChange}
          />
          <Field>
            <FieldLabel htmlFor="resubmission-comment">제출 코멘트</FieldLabel>
            <textarea
              id="resubmission-comment"
              value={props.comment}
              maxLength={2000}
              aria-describedby="resubmission-comment-description"
              onChange={(event) => props.onCommentChange(event.target.value)}
              className="min-h-28 w-full resize-y rounded-lg border border-input bg-transparent p-3 text-sm leading-6 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <FieldDescription id="resubmission-comment-description">
              선택 입력 · 최대 2,000자
            </FieldDescription>
          </Field>
          <div className="flex flex-wrap justify-between gap-3">
            <Button asChild variant="outline">
              <Link href={checklistHref(props.programId)}>취소</Link>
            </Button>
            <Button type="submit" disabled={props.submitting}>
              {props.submitting
                ? '제출 중…'
                : `revision ${submission.currentRevision + 1} 제출`}
            </Button>
          </div>
        </form>
      )}
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

function ReviewMeta({
  submission,
}: {
  readonly submission: ChecklistSubmission;
}) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      {submission.reviewComment !== null ? (
        <div>
          <dt className="font-medium">교직원 코멘트</dt>
          <dd className="whitespace-pre-wrap text-muted-foreground">
            {submission.reviewComment}
          </dd>
        </div>
      ) : null}
      {submission.lastReviewedAt !== null ? (
        <div>
          <dt className="font-medium">검토 시각</dt>
          <dd className="text-muted-foreground">
            {formatDeadline(submission.lastReviewedAt)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function ChecklistSkeleton() {
  return (
    <main
      className="mx-auto grid max-w-3xl gap-6 px-4 py-8"
      aria-label="체크리스트 불러오는 중"
    >
      <div className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function ChecklistLoadFailure({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Alert variant="destructive">
        <AlertTitle>체크리스트 불러오기 실패</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{message}</p>
          <Button type="button" onClick={onRetry}>
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}
