import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { ListRow, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  programDocumentsHref,
  programMilestoneDocumentsHref,
} from '@/lib/program-route';
import { SUBMISSION_STATUS_BADGE } from '@/lib/status-vocabulary';
import { cn } from '@/lib/utils';
import { formatSeoulDate, submissionLabel } from '../program-detail-format';
import type {
  BlockedMilestoneSubmissionAccess,
  MilestoneSubmissionAccess,
} from '../milestone-submission-access';
import { milestoneRowSubmitGate } from '../milestone-submit-gate';
import type { ProgramMilestone, ViewerRole } from '../types';

interface MilestoneRowProps {
  readonly programId: string;
  readonly milestone: ProgramMilestone;

  readonly position: number;

  readonly nameId: string;

  readonly disclosureContentId?: string;
  readonly viewerRole: ViewerRole;

  readonly submissionAccess: MilestoneSubmissionAccess;
}

function BlockedState({
  access,
}: {
  readonly access: BlockedMilestoneSubmissionAccess;
}) {
  return (
    <p className="text-small break-keep text-muted-foreground">
      {access.notice}
    </p>
  );
}

function MilestoneHeadText({
  milestone,
  nameId,
  viewerRole,
}: Pick<MilestoneRowProps, 'milestone' | 'nameId' | 'viewerRole'>) {
  const staff = viewerRole === 'STAFF' || viewerRole === 'ADMIN';
  return (
    <span className="grid min-w-0 flex-1 gap-1 text-left">
      <span
        id={nameId}
        className="font-heading text-body font-semibold tracking-tight"
      >
        {milestone.name}
      </span>
      <span className="block text-small text-muted-foreground">
        {staff
          ? `마감 ${formatSeoulDate(milestone.dueAt)}`
          : formatSeoulDate(milestone.dueAt)}
      </span>
      {milestone.description ? (
        staff ? (
          <span
            className="grid gap-0.5 text-small leading-normal break-keep text-muted-foreground"
            role="region"
            aria-label="운영자 공지"
          >
            <span className="font-semibold text-foreground">운영자 공지</span>
            <span>{milestone.description}</span>
          </span>
        ) : (
          <span className="block text-small leading-normal break-keep text-muted-foreground">
            {milestone.description}
          </span>
        )
      ) : null}
    </span>
  );
}

function StudentState({
  programId,
  milestone,
  submissionAccess,
}: Pick<MilestoneRowProps, 'programId' | 'milestone' | 'submissionAccess'>) {
  if (milestone.submissionType === null) {
    if (milestone.submissionItemCount === 0) {
      return (
        <p className="text-small font-semibold text-muted-foreground">
          제출 없음 · 안내용
        </p>
      );
    }
    if (submissionAccess.kind === 'blocked') {
      return <BlockedState access={submissionAccess} />;
    }
    return (
      <p className="text-small font-semibold text-muted-foreground">
        {submissionAccess.kind === 'unchanged'
          ? '신청 승인 후 제출할 수 있습니다'
          : '아래 제출 항목에서 내용이나 파일을 제출하세요'}
      </p>
    );
  }

  const gate = milestoneRowSubmitGate(milestone, submissionAccess);
  if (gate.kind === 'unchanged') {
    return (
      <p className="text-small text-muted-foreground">
        신청 승인 후 제출 상태를 확인할 수 있습니다.
      </p>
    );
  }
  if (gate.kind === 'blocked') {
    return <BlockedState access={gate.access} />;
  }
  if (gate.kind === 'unknown') {
    return (
      <p className="text-small text-muted-foreground">
        제출 상태를 확인할 수 없습니다.
      </p>
    );
  }
  const submitHref = programDocumentsHref(programId, milestone.id);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge variant={SUBMISSION_STATUS_BADGE[gate.status]}>
        {submissionLabel(gate.status)}
      </StatusBadge>
      {gate.kind === 'open' ? (
        <Button asChild size="sm" variant="outline">
          <Link href={submitHref}>
            {gate.resubmission ? '다시 제출' : '제출하기'}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

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
    <ListRow data-testid="milestone-row">
      <div className="flex w-full min-w-0 items-start gap-4 sm:w-auto sm:flex-1">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-tag shrink-0 place-items-center rounded-full bg-background',
            'text-small font-semibold text-muted-foreground ring-1 ring-foreground/10',
          )}
        >
          {position}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          {disclosureContentId === undefined ? (
            <MilestoneHeadText
              milestone={milestone}
              nameId={nameId}
              viewerRole={viewerRole}
            />
          ) : (
            <CollapsibleTrigger
              aria-controls={disclosureContentId}
              className={DISCLOSURE_TRIGGER_CLASS}
            >
              <MilestoneHeadText
                milestone={milestone}
                nameId={nameId}
                viewerRole={viewerRole}
              />
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
