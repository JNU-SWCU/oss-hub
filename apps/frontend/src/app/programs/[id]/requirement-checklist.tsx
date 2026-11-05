'use client';
import { useCallback, useState } from 'react';
import { EmptyState, ListPanel, ListRow, SectionHeading } from '@/components';
import Link from 'next/link';
import { programDocumentsHref } from '@/lib/program-route';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components';
import { useProgramDetailQuery } from '@/features/programs/catalog/queries';
import {
  formatSeoulDate,
  isPastDue,
} from '@/features/programs/catalog/program-detail-format';
import type { ProgramMilestone } from '@/features/programs/catalog/dto';
import { milestoneSubmissionAccess } from '@/features/programs/documents/milestone-submission-access';
import { MilestoneDocumentSection } from '@/features/programs/documents/milestone-document-list';
import { useMilestoneDocumentsQuery } from '@/features/programs/documents/queries';
import {
  ChecklistLoadFailure,
  ChecklistParticipationRequired,
  ChecklistSkeleton,
} from '@/features/submissions/components/submission-checklist-view';
import { SubmissionDialog } from '@/features/submissions/components/submission-dialog';
import { submissionTriggerId } from '@/features/submissions/components/submission-checklist-row';
function RequirementRow({
  programId,
  milestone,
  onSelect,
}: {
  readonly programId: string;
  readonly milestone: ProgramMilestone;
  readonly onSelect?: () => void;
}) {
  const result = useMilestoneDocumentsQuery(
    programId,
    milestone.id,
    true,
    'all',
  );
  const documents = result.data?.documents;
  const submitted =
    documents?.filter((document) => document.viewerSubmission?.submitted)
      .length ?? 0;
  const changesRequested =
    documents?.filter(
      (document) => document.viewerSubmission?.status === 'CHANGES_REQUESTED',
    ).length ?? 0;
  const rejected =
    documents?.filter(
      (document) => document.viewerSubmission?.status === 'REJECTED',
    ).length ?? 0;
  return (
    <ListRow role="listitem" className="min-w-0">
      <div className="grid w-full min-w-0 flex-1 gap-1">
        <Link
          href={programDocumentsHref(programId, milestone.id)}
          id={submissionTriggerId(milestone.id)}
          aria-label={milestone.name + ' 제출 내역 열기'}
          className={cn(
            'w-fit min-w-0 font-semibold break-keep underline underline-offset-4',
            'focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          )}
          onClick={
            onSelect === undefined
              ? undefined
              : (event) => {
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.shiftKey
                  )
                    return;
                  event.preventDefault();
                  onSelect();
                }
          }
        >
          {milestone.name}
        </Link>
        <p className="text-small text-muted-foreground">
          마감 {formatSeoulDate(milestone.dueAt)}
        </p>
        <div className="flex flex-wrap gap-2 text-small" aria-live="polite">
          {result.isError
            ? '제출 상태를 불러오지 못했습니다.'
            : documents === undefined
              ? '제출 상태 확인 중…'
              : submitted + '/' + documents.length + '개 항목 제출'}
          {changesRequested > 0 ? (
            <StatusBadge variant="pending">
              보완 요청 {changesRequested}건
            </StatusBadge>
          ) : null}
          {rejected > 0 ? (
            <StatusBadge variant="rejected">반려 {rejected}건</StatusBadge>
          ) : null}
        </div>
      </div>
    </ListRow>
  );
}
export function RequirementChecklistPage({
  programId,
  milestoneId,
  onCloseSelected,
  onSelectMilestone,
}: {
  readonly programId: string;
  readonly milestoneId: string | null;
  readonly onCloseSelected?: () => void;
  readonly onSelectMilestone?: (milestoneId: string) => void;
}) {
  const result = useProgramDetailQuery(programId, false);
  const [busyCount, setBusyCount] = useState(0);
  const onBusyChange = useCallback(
    (busy: boolean) => setBusyCount((count) => count + (busy ? 1 : -1)),
    [],
  );
  if (result.isPending) return <ChecklistSkeleton />;
  if (result.isError)
    return (
      <ChecklistLoadFailure
        message="제출 항목을 불러오지 못했습니다."
        onRetry={() => void result.refetch()}
      />
    );
  const program = result.data;
  const access = milestoneSubmissionAccess(program.viewer);
  if (program.viewer.role !== 'STUDENT' || access.kind !== 'open') {
    return <ChecklistParticipationRequired programId={programId} />;
  }
  const milestones = program.milestones.filter(
    (milestone) => milestone.submissionItemCount > 0,
  );
  const selectedId = milestoneId;
  const selected = milestones.find((milestone) => milestone.id === selectedId);
  return (
    <>
      <SectionHeading title="제출 현황" />
      {milestones.length === 0 ? (
        <EmptyState
          title="표시할 제출 항목이 없습니다"
          description="프로그램에 제출 항목이 아직 등록되지 않았습니다."
        />
      ) : (
        <ListPanel role="list" className="min-w-0" data-testid="checklist">
          {milestones.map((milestone) => (
            <RequirementRow
              key={milestone.id}
              programId={programId}
              milestone={milestone}
              onSelect={
                onSelectMilestone === undefined
                  ? undefined
                  : () => onSelectMilestone(milestone.id)
              }
            />
          ))}
        </ListPanel>
      )}
      {selectedId !== null && selected === undefined ? (
        <p role="alert">
          마일스톤을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.
        </p>
      ) : null}
      {selected === undefined ? null : (
        <SubmissionDialog
          title={selected.name}
          description="마일스톤의 제출 항목과 상태를 확인합니다."
          busy={busyCount > 0}
          returnFocusId={submissionTriggerId(selected.id)}
          onClose={() => {
            onCloseSelected?.();
          }}
        >
          <MilestoneDocumentSection
            programId={programId}
            milestoneId={selected.id}
            viewerRole="STUDENT"
            closed={isPastDue(selected.dueAt)}
            dueAt={selected.dueAt}
            submissionAccess={access}
            onBusyChange={onBusyChange}
          />
        </SubmissionDialog>
      )}
    </>
  );
}
