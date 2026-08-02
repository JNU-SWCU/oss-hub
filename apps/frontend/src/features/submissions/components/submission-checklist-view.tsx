import { EmptyState } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { sortChecklistItems } from '../submission-checklist';
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
  readonly embedded?: boolean;
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
  readonly onReleaseUrlChange: (value: string) => void;
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
  const content = (
    <>
      <header className="grid gap-1">
        {props.embedded ? (
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-xl font-semibold">
              마일스톤 및 제출
            </h2>
            <span className="text-sm text-muted-foreground">
              {items.length}개
            </span>
          </div>
        ) : (
          <h1 className="text-2xl font-bold tracking-tight">제출 체크리스트</h1>
        )}
        <p className="text-sm text-muted-foreground [word-break:keep-all]">
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
        <ul className="grid list-none gap-3 p-0" data-testid="checklist">
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

  return props.embedded ? (
    <section
      id="milestones"
      className="grid scroll-mt-24 gap-4"
      aria-label="마일스톤 및 제출"
    >
      {content}
    </section>
  ) : (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">{content}</main>
  );
}

export function ChecklistSkeleton({
  embedded = false,
}: {
  readonly embedded?: boolean;
}) {
  const content = (
    <>
      <div className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </>
  );
  if (embedded) {
    return (
      <section className="grid gap-4" aria-label="체크리스트 불러오는 중">
        {content}
      </section>
    );
  }
  return (
    <main
      className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8"
      aria-label="체크리스트 불러오는 중"
    >
      {content}
    </main>
  );
}

export function ChecklistLoadFailure({
  message,
  onRetry,
  embedded = false,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly embedded?: boolean;
}) {
  const alert = (
    <Alert variant="destructive">
      <AlertTitle>체크리스트 불러오기 실패</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message}</p>
        <Button type="button" onClick={onRetry}>
          다시 시도
        </Button>
      </AlertDescription>
    </Alert>
  );
  if (embedded) return <section aria-label="마일스톤 및 제출">{alert}</section>;
  return <main className="mx-auto w-full max-w-3xl px-4 py-8">{alert}</main>;
}
