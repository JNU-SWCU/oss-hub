import Link from 'next/link';
import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      <p className="text-sm text-muted-foreground">
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
    <div className="flex flex-wrap items-center gap-2">
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
    <Card className="gap-3" data-testid="milestone-row">
      <CardHeader className="gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-1">
          <CardTitle>{milestone.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {formatSeoulDate(milestone.dueAt)} ·{' '}
            {submissionTypeLabel(milestone.submissionType)}
          </p>
        </div>
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
      </CardHeader>
      <CardContent className="grid gap-3">
        {milestone.description ? (
          <p className="text-sm leading-normal break-keep">
            {milestone.description}
          </p>
        ) : null}
        {viewerRole === null ? (
          <p className="text-sm font-medium text-muted-foreground">
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
        {(viewerRole === 'STAFF' || viewerRole === 'ADMIN') && summary ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <strong>
                {submitted}/{summary.total}
              </strong>{' '}
              신청 제출 · 미제출 {summary.notSubmitted} · 승인{' '}
              {summary.approved} · 보완 {summary.changesRequested} · 반려{' '}
              {summary.rejected}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href={`/staff/programs/${programId}/submissions`}>
                전체 현황
              </Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
