import Link from 'next/link';
import { ListRow, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { studentProgramSubmissionHref } from '@/lib/program-route';
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
  const submitHref = studentProgramSubmissionHref(programId, milestone.id);
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
        {/*
          역할이 없는 사람에는 비로그인 방문자와 프로필을 아직 못 채운 가입 미완자가
          함께 들어온다. 후자는 이미 로그인해 있으므로 "로그인"이라고 하면 틀린 말이
          되고, 두 경우 모두에 참인 조건은 "가입"이다(상세 화면 주 버튼과 같은 기준,
          program-detail-page.tsx의 `ProgramActions`). 줄마다 반복되는 자리라 주
          버튼보다 짧게 적는다.
        */}
        {viewerRole === null ? (
          <p className="text-small font-semibold text-muted-foreground">
            가입 후 확인
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
