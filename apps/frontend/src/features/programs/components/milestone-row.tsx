import Link from 'next/link';
import { ListRow, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import {
  programDocumentsHref,
  programMilestoneDocumentsHref,
} from '@/lib/program-route';
import {
  formatSeoulDate,
  isPastDue,
  submissionLabel,
} from '../program-detail-format';
import type {
  BlockedMilestoneSubmissionAccess,
  MilestoneSubmissionAccess,
} from '../milestone-submission-access';
import type { ProgramMilestone, SubmissionStatus, ViewerRole } from '../types';

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
  /**
   * 신청 상태를 읽어 낸 결과 — 이 줄과 바로 아래 「제출 항목」 블록이 **같은 값**을 받는다.
   * 여기서 신청 상태를 다시 해석하지 않는 것이 요점이다(#1098).
   */
  readonly submissionAccess: MilestoneSubmissionAccess;
}

/**
 * 못 내는 이유와 지금 할 수 있는 일. 아래 제출 항목의 흐려진 버튼 옆 문구와 **같은 판정**
 * (`milestoneSubmissionAccess`)에서 나오므로 위아래가 어긋날 수 없다.
 */
function BlockedState({
  access,
}: {
  readonly access: BlockedMilestoneSubmissionAccess;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-small break-keep text-muted-foreground">
        {access.notice}
      </p>
      {access.nextStep === null ? null : (
        <Button asChild size="sm" variant="outline">
          <Link href={access.nextStep.href}>{access.nextStep.label}</Link>
        </Button>
      )}
    </div>
  );
}

function StudentState({
  programId,
  milestone,
  submissionAccess,
}: Omit<MilestoneRowProps, 'viewerRole'>) {
  if (milestone.submissionType === null) {
    if (milestone.submissionItemCount === 0) {
      return (
        <p className="text-small font-semibold text-muted-foreground">
          제출 없음 · 안내용
        </p>
      );
    }
    return submissionAccess.kind === 'blocked' ? (
      <BlockedState access={submissionAccess} />
    ) : (
      <p className="text-small font-semibold text-muted-foreground">
        아래 제출 항목에서 내용이나 파일을 제출하세요
      </p>
    );
  }
  if (submissionAccess.kind === 'blocked') {
    return <BlockedState access={submissionAccess} />;
  }
  const status = milestone.viewerSubmissionStatus;
  if (!status) {
    /*
     * 신청이 승인됐는데 제출 상태만 비어 온 응답. 계약상 오지 않는 값이라(백엔드는 승인
     * 여부와 무관하게 신청이 있으면 상태를 채운다) 여기서 할 수 있는 말은 모른다는 말뿐이다.
     * 옛 문구(「신청 승인 후…」)를 남기면 이미 승인된 학생에게 거짓말이 된다.
     */
    return (
      <p className="text-small text-muted-foreground">
        제출 상태를 확인할 수 없습니다.
      </p>
    );
  }
  const isResubmission = status === 'CHANGES_REQUESTED';
  const canSubmit =
    isResubmission ||
    (status === 'NOT_SUBMITTED' && !isPastDue(milestone.dueAt));
  const submitHref = programDocumentsHref(programId, milestone.id);
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
  submissionAccess,
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
          {formatSeoulDate(milestone.dueAt)}
        </p>
        {milestone.description ? (
          <p className="text-small leading-normal break-keep text-muted-foreground">
            {milestone.description}
          </p>
        ) : null}
        {viewerRole === 'STAFF' || viewerRole === 'ADMIN' ? (
          <>
            {milestone.submissionType === null ? (
              <p className="text-small font-semibold text-muted-foreground">
                {milestone.submissionItemCount === 0
                  ? '제출 없음 · 안내용'
                  : `제출 항목 ${milestone.submissionItemCount}개`}
              </p>
            ) : summary ? (
              <p className="text-small">
                <strong>
                  {submitted}/{summary.total}
                </strong>{' '}
                신청 제출 · 미제출 {summary.notSubmitted} · 승인{' '}
                {summary.approved} · 보완 {summary.changesRequested} · 반려{' '}
                {summary.rejected}
              </p>
            ) : null}
            {/*
              서류 수합 표로 들어가는 유일한 입구다 — 좌측 패널이 아니라 이 줄에
              둔다. 그 표는 마일스톤 하나를 놓고 보는 화면이라, 어느 마일스톤인지
              고르는 자리가 곧 진입 지점이다.
            */}
            {milestone.submissionItemCount > 0 ? (
              <Link
                href={programMilestoneDocumentsHref(programId, milestone.id)}
                className="text-small w-fit font-semibold underline underline-offset-2 hover:opacity-80"
              >
                서류 수합
              </Link>
            ) : null}
          </>
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
            submissionAccess={submissionAccess}
          />
        ) : null}
      </div>
    </ListRow>
  );
}
