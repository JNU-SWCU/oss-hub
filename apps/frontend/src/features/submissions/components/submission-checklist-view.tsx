import { EmptyState, ParticipantOnlyNotice } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { programApplyHref, programOverviewHref } from '@/lib/program-route';
import {
  checklistSubmittedCount,
  sortChecklistItems,
} from '../submission-checklist';
import type {
  SubmissionFormErrors,
  SubmissionFormInput,
} from '../submission-form';
import type { SubmissionChecklist } from '../types';
import { ChecklistRow, submissionTriggerId } from './submission-checklist-row';
import { SelectedMilestonePanel } from './submission-checklist-selected-panel';
import { SubmissionDialog } from './submission-dialog';

export interface SubmissionChecklistViewProps {
  readonly programId: string;
  readonly onCloseSelected?: () => void;
  readonly onSelectMilestone?: (milestoneId: string) => void;
  readonly initialSubmission?: React.ReactNode;
  readonly checklist: SubmissionChecklist;
  readonly selectedMilestoneId: string | null;
  /** D-day 계산 기준 시각 — 테스트에서 고정할 수 있도록 주입한다. */
  readonly now: Date;
  readonly input: SubmissionFormInput;
  readonly comment: string;
  readonly errors: SubmissionFormErrors;
  readonly fileError: string | null;
  readonly serverError: string | null;
  readonly staleNotice: string | null;
  readonly toastMessage: string | null;
  readonly refreshError?: string | null;
  readonly submitting: boolean;
  readonly submissionPhase: 'uploading' | 'creating' | null;
  readonly onTextChange: (value: string) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onCommentChange: (value: string) => void;
  readonly onResubmit: () => void;
  readonly onRefresh?: () => void;
}

export function SubmissionChecklistView(props: SubmissionChecklistViewProps) {
  const items = sortChecklistItems(props.checklist.items);
  const selected =
    items.find((item) => item.milestoneId === props.selectedMilestoneId) ??
    null;
  const selectedContent = selected ? (
    selected.submission === null && props.initialSubmission ? (
      props.initialSubmission
    ) : (
      <SelectedMilestonePanel {...props} item={selected} />
    )
  ) : null;
  const count = checklistSubmittedCount(items);
  const content = (
    <>
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="font-heading text-xl font-semibold">내 제출물</h2>
          <span className="text-sm font-semibold text-muted-foreground">
            {count.submitted}/{count.total}
          </span>
        </div>
        <p className="text-sm text-muted-foreground [word-break:keep-all]">
          낼 서류 {count.total}건 중 {count.submitted}건 제출
          {count.revisionNeeded > 0
            ? ` · 보완 필요 ${count.revisionNeeded}건`
            : ''}{' '}
          — 단계별 제출물을 확인하고 여기에서 바로 냅니다.
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
      {props.refreshError ? (
        <Alert variant="destructive">
          <AlertTitle>제출 상태 갱신 실패</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{props.refreshError}</p>
            {props.onRefresh ? (
              <Button type="button" onClick={props.onRefresh}>
                다시 시도
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title="표시할 마일스톤이 없습니다"
          description="프로그램에 마일스톤이 아직 등록되지 않았습니다."
        />
      ) : (
        <ul
          className="grid min-w-0 list-none grid-cols-[minmax(0,1fr)] gap-3 p-0"
          data-testid="checklist"
        >
          {items.map((item) => (
            <ChecklistRow
              key={item.milestoneId}
              programId={props.programId}
              item={item}
              now={props.now}
              onSelectMilestone={props.onSelectMilestone}
            />
          ))}
        </ul>
      )}
      {props.selectedMilestoneId && !selected ? (
        <Alert>
          <AlertTitle>마일스톤을 찾을 수 없습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>목록에서 제출할 마일스톤을 다시 선택해 주세요.</span>
            {props.onCloseSelected ? (
              <Button
                type="button"
                variant="outline"
                onClick={props.onCloseSelected}
              >
                선택 해제
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {selected && selectedContent ? (
        props.onCloseSelected ? (
          <SubmissionDialog
            title={selected.name}
            description="마일스톤 제출 내용과 상태를 확인합니다."
            onClose={props.onCloseSelected}
            returnFocusId={submissionTriggerId(selected.milestoneId)}
            busy={props.submitting}
          >
            {selectedContent}
          </SubmissionDialog>
        ) : (
          selectedContent
        )
      ) : null}
    </>
  );

  return (
    <section
      id="milestones"
      className="grid min-w-0 scroll-mt-24 grid-cols-[minmax(0,1fr)] gap-4"
      aria-label="마일스톤 및 제출"
    >
      {content}
    </section>
  );
}

export function ChecklistSkeleton() {
  return (
    <section className="grid gap-4" aria-label="체크리스트 불러오는 중">
      <div className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </section>
  );
}

/**
 * 승인된 신청이 없는 학생이 `/programs/:id/documents`에 **주소로 직접** 들어왔을 때(#1099).
 *
 * 서버는 `SUB_003`·`SUB_004` 403으로 「참여자가 아니다」를 정확히 말하는데 예전에는 그
 * 답이 `ChecklistLoadFailure`(빨간 상자 + 「다시 시도」)로 접혔다. 그 버튼은 몇 번을 눌러도
 * 같은 403을 되풀이한다 — 재시도로 풀릴 수 있는 실패가 아니기 때문이다.
 */
export function ChecklistParticipationRequired({
  programId,
}: {
  readonly programId: string;
}) {
  return (
    <section aria-label="마일스톤 및 제출">
      <ParticipantOnlyNotice
        description="승인된 신청이 있는 참여자만 제출물을 볼 수 있습니다. 이 프로그램에 신청하고 승인을 받으면 여기에서 서류를 제출할 수 있습니다."
        applyHref={programApplyHref(programId)}
        overviewHref={programOverviewHref(programId)}
      />
    </section>
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
    <section aria-label="마일스톤 및 제출">
      <Alert variant="destructive">
        <AlertTitle>체크리스트 불러오기 실패</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{message}</p>
          <Button type="button" onClick={onRetry}>
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </section>
  );
}
