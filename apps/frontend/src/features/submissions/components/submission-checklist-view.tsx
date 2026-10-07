import {
  EmptyState,
  ListPanel,
  ParticipantOnlyNotice,
  SectionHeading,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
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

  readonly now: Date;
  readonly input: SubmissionFormInput;
  readonly comment: string;
  readonly errors: SubmissionFormErrors;
  readonly fileError: string | null;

  readonly fileChecking?: boolean;
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
      <SelectedMilestonePanel
        {...props}
        item={selected}
        fileUpload={props.checklist.fileUpload}
      />
    )
  ) : null;
  const count = checklistSubmittedCount(items);
  const content = (
    <>
      <SectionHeading
        title="제출 현황"
        meta={
          count.revisionNeeded > 0
            ? `보완 요청 ${count.revisionNeeded}건`
            : undefined
        }
      />
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
        <ListPanel role="list" className="min-w-0" data-testid="checklist">
          {items.map((item) => (
            <ChecklistRow
              key={item.milestoneId}
              programId={props.programId}
              item={item}
              now={props.now}
              onSelectMilestone={props.onSelectMilestone}
            />
          ))}
        </ListPanel>
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
    <Skeleton label="체크리스트 불러오는 중" className="grid gap-4">
      <SkeletonBlock className="h-16 rounded-xl" />
      <SkeletonBlock className="h-28 rounded-xl" />
      <SkeletonBlock className="h-28 rounded-xl" />
      <SkeletonBlock className="h-28 rounded-xl" />
    </Skeleton>
  );
}

export function ChecklistParticipationRequired({
  programId,
}: {
  readonly programId: string;
}) {
  return (
    <section aria-label="마일스톤 및 제출">
      <ParticipantOnlyNotice
        description="신청이 승인되면 서류를 제출할 수 있습니다."
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
