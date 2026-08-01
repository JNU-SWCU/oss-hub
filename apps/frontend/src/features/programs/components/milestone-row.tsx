import Link from 'next/link';
import { ListRow, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import {
  formatSeoulDate,
  submissionLabel,
  submissionTypeLabel,
} from '../program-detail-format';
import type {
  ApplicationStatus,
  ProgramMilestone,
  SubmissionStatus,
  ViewerRole,
} from '../types';

const STATUS_VARIANTS = {
  NOT_SUBMITTED: 'pending',
  SUBMITTED: 'pending',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'rejected',
  REJECTED: 'rejected',
} as const satisfies Readonly<
  Record<SubmissionStatus, 'pending' | 'approved' | 'rejected'>
>;

interface MilestoneRowProps {
  readonly programId: string;
  readonly milestone: ProgramMilestone;
  readonly viewerRole: ViewerRole;
  readonly applicationStatus: ApplicationStatus | null;
}

function StudentState({
  programId,
  milestone,
  applicationStatus,
}: Omit<MilestoneRowProps, 'viewerRole'>) {
  const status = milestone.viewerSubmissionStatus;
  if (applicationStatus !== 'APPROVED' || !status) {
    return (
      <p className="text-small text-muted-foreground">
        신청 승인 후 제출 상태를 확인할 수 있습니다.
      </p>
    );
  }
  const isResubmission = status === 'CHANGES_REQUESTED';
  const canSubmit =
    isResubmission || (status === 'NOT_SUBMITTED' && milestone.dDay >= 0);
  const submitHref = isResubmission
    ? `/programs/${programId}/submissions?milestoneId=${milestone.id}`
    : `/programs/${programId}/milestones/${milestone.id}/submit`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge variant={STATUS_VARIANTS[status]}>
        {submissionLabel(status)}
      </StatusBadge>
      {canSubmit ? (
        <Button asChild size="sm" variant="outline">
          <Link href={submitHref}>
            {isResubmission ? '다시 제출' : '제출하기'}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

export function MilestoneRow({
  programId,
  milestone,
  viewerRole,
  applicationStatus,
}: MilestoneRowProps) {
  const summary = milestone.applicationSubmissionSummary;
  const submitted = summary
    ? summary.submitted +
      summary.approved +
      summary.changesRequested +
      summary.rejected
    : 0;
  return (
    // 마일스톤은 서로 독립된 대상이 아니라 순서대로 이어지는 항목이다 — 카드를
    // 항목마다 두지 않고 목록 한 줄로 둔다(시안의 `.list-item`).
    <ListRow data-testid="milestone-row">
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="font-heading text-body font-semibold tracking-tight">
          {milestone.name}
        </p>
        <p className="text-small text-muted-foreground">
          {formatSeoulDate(milestone.dueAt)} ·{' '}
          {submissionTypeLabel(milestone.submissionType)}
        </p>
        {milestone.description ? (
          <p className="text-small leading-normal break-keep text-muted-foreground">
            {milestone.description}
          </p>
        ) : null}
        {(viewerRole === 'STAFF' || viewerRole === 'ADMIN') && summary ? (
          <p className="text-small">
            <strong>
              {submitted}/{summary.total}
            </strong>{' '}
            신청 제출 · 미제출 {summary.notSubmitted} · 승인 {summary.approved}{' '}
            · 보완 {summary.changesRequested} · 반려 {summary.rejected}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge
          variant={
            milestone.dDay < 0
              ? 'rejected'
              : milestone.dDay === 0
                ? 'pending'
                : 'recruiting'
          }
        >
          {milestone.deadlineLabel}
        </StatusBadge>
        {viewerRole === null ? (
          <p className="text-small font-semibold text-muted-foreground">
            로그인 후 확인
          </p>
        ) : null}
        {viewerRole === 'STUDENT' ? (
          <StudentState
            programId={programId}
            milestone={milestone}
            applicationStatus={applicationStatus}
          />
        ) : null}
      </div>
    </ListRow>
  );
}
