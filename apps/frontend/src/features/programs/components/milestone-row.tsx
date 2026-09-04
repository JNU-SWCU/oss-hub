import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { ListRow, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { CollapsibleTrigger } from '@/components/ui/collapsible';
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
  /**
   * 목록에서 몇 번째인가(1부터). 머리줄 앞에 번호로 그린다 — 마일스톤은 순서대로
   * 이어지는 단계라, 번호가 있으면 「여기서 새 마일스톤이 시작한다」를 경계선과
   * 함께 두 번 말하게 된다. 마일스톤 타임라인 화면이 쓰는 것과 같은 표식이다.
   */
  readonly position: number;
  /** 묶음(`article`)이 `aria-labelledby` 로 가리킬 이름의 id. */
  readonly nameId: string;
  /**
   * 이 머리줄이 여닫는 영역(제출 항목 블록)의 id. 값이 있으면 이름·마감·설명이
   * 접기 트리거 안으로 들어간다. **없으면 트리거를 아예 그리지 않는다** — 열어도
   * 볼 것이 없는 마일스톤(제출 항목 0개, 비로그인)에까지 화살표를 달면 눌러도
   * 아무 일이 없는 컨트롤이 된다. 그 판단은 묶음(`MilestoneGroup`)이 한다.
   */
  readonly disclosureContentId?: string;
  readonly viewerRole: ViewerRole;
  readonly applicationStatus: ApplicationStatus | null;
}

/**
 * 머리줄의 글 부분 — 이름·마감·설명. 접히는 마일스톤에서는 이 덩어리가 통째로
 * 트리거가 된다(누를 곳이 화살표 하나가 아니라 「마일스톤」이어야 한다는 요청).
 *
 * `p` 가 아니라 `span.block` 인 것은 트리거가 `button` 이기 때문이다 — `button`
 * 안에는 문단을 넣을 수 없다. 접히지 않는 마일스톤도 같은 마크업을 쓴다: 한 줄이
 * 접힘 여부에 따라 다른 태그로 그려지면 간격·줄바꿈이 두 갈래로 갈린다.
 */
function MilestoneHeadText({
  milestone,
  nameId,
}: Pick<MilestoneRowProps, 'milestone' | 'nameId'>) {
  return (
    <span className="grid min-w-0 flex-1 gap-1 text-left">
      <span
        id={nameId}
        className="font-heading text-body font-semibold tracking-tight"
      >
        {milestone.name}
      </span>
      <span className="block text-small text-muted-foreground">
        {formatSeoulDate(milestone.dueAt)}
      </span>
      {milestone.description ? (
        <span className="block text-small leading-normal break-keep text-muted-foreground">
          {milestone.description}
        </span>
      ) : null}
    </span>
  );
}

function StudentState({
  programId,
  milestone,
  applicationStatus,
}: Pick<MilestoneRowProps, 'programId' | 'milestone' | 'applicationStatus'>) {
  if (milestone.submissionType === null) {
    if (milestone.submissionItemCount === 0) {
      return (
        <p className="text-small font-semibold text-muted-foreground">
          제출 없음 · 안내용
        </p>
      );
    }
    return (
      <p className="text-small font-semibold text-muted-foreground">
        {applicationStatus === 'APPROVED'
          ? '아래 제출 항목에서 내용이나 파일을 제출하세요'
          : '신청 승인 후 제출할 수 있습니다'}
      </p>
    );
  }
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

/**
 * 접기 트리거의 겉모습. `ProgramSummary`(프로그램 안내 카드)가 쓰는 어휘를 그대로
 * 가져왔다 — `group` + 오른쪽 끝 `ChevronDown` + `group-data-[state=open]:rotate-180`,
 * 그리고 같은 포커스 링. 이 저장소에서 「눌러서 여는 것」은 이미 이 모양이다.
 */
const DISCLOSURE_TRIGGER_CLASS = [
  'group flex w-full items-start justify-between gap-3 rounded-sm text-left',
  'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
].join(' ');

const DISCLOSURE_CHEVRON_CLASS = [
  'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
  'group-data-[state=open]:rotate-180 motion-reduce:transition-none',
].join(' ');

export function MilestoneRow({
  programId,
  milestone,
  position,
  nameId,
  disclosureContentId,
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
    //
    // 이 줄은 그 마일스톤의 **머리**다. 아래에 그 마일스톤의 제출 항목이 이어지므로
    // 「여기서부터가 새 마일스톤」을 말하는 신호가 필요한데, 그 일은 이 줄이 아니라
    // 묶음 사이에 그은 가로선이 진다(program-detail-view 의 MilestoneGroup). 여기에
    // 바탕을 깔면 선과 띠가 같은 말을 두 번 하게 되고, 항목이 늘어난 화면에서 띠가
    // 오히려 무거워진다. 그래서 이 줄은 목록의 기본 표면을 그대로 쓴다.
    <ListRow data-testid="milestone-row">
      <div className="flex w-full min-w-0 items-start gap-4 sm:w-auto sm:flex-1">
        {/*
          번호는 순서를 말하는 동시에 마일스톤이 시작하는 지점을 찍는다. 띠와 같은
          색이 되지 않도록 흰 바탕에 `ListPanel` 과 같은 링을 두른다.
        */}
        <span
          aria-hidden="true"
          className="grid size-tag shrink-0 place-items-center rounded-full bg-background text-small font-semibold text-muted-foreground ring-1 ring-foreground/10"
        >
          {position}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          {/*
            접히는 마일스톤이면 글 덩어리가 트리거 안으로 들어간다. 화살표는
            트리거의 오른쪽 끝에 서서, 접힌 줄만 봐도 여기가 열리는 자리임을
            말한다. 접히지 않으면 같은 덩어리를 그대로 두어 예전 화면과 같다.
          */}
          {disclosureContentId === undefined ? (
            <MilestoneHeadText milestone={milestone} nameId={nameId} />
          ) : (
            <CollapsibleTrigger
              aria-controls={disclosureContentId}
              className={DISCLOSURE_TRIGGER_CLASS}
            >
              <MilestoneHeadText milestone={milestone} nameId={nameId} />
              <ChevronDown aria-hidden className={DISCLOSURE_CHEVRON_CLASS} />
            </CollapsibleTrigger>
          )}
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
