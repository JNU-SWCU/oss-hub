'use client';

import Link from 'next/link';
import type { ReactNode, RefObject } from 'react';
import { PageBody, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { programApplyHref } from '@/lib/program-route';
import type { ProgramTeam } from './api';
import { ApplicationTeamDeparture } from './application-team-departure';
import { formatSeoulDate } from './program-detail-format';
import type { StudentApplication } from './student-application-api';
import { updateRepositoryUrl } from './repository-url-api';
import { TeamInvitePanel } from './team-invite-panel';
import { TeamMembersPanel } from './team-members-panel';
import { TeamRepositoryPanel } from './team-repository-panel';
import type { ProgramDetail } from './types';
import type { TeamInvitationManagement } from './use-team-invitation-management';

export type MyTeamApplicationStage =
  'draft' | 'submitted' | 'approved' | 'rejected';

function myTeamApplicationStage(
  application: StudentApplication | null,
): MyTeamApplicationStage {
  if (application === null) return 'draft';
  switch (application.status) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'SUBMITTED':
      return 'submitted';
    default: {
      const exhaustive: never = application.status;
      return exhaustive;
    }
  }
}

interface StageBadge {
  readonly label: string;
  readonly variant: 'pending' | 'approved' | 'rejected';
}

const STAGE_BADGES: Readonly<
  Record<MyTeamApplicationStage, StageBadge | null>
> = {
  draft: null,
  submitted: { label: '신청', variant: 'pending' },
  approved: { label: '신청', variant: 'approved' },
  rejected: { label: '반려', variant: 'rejected' },
};

export interface ProgramMyTeamViewProps {
  readonly programId: string;
  readonly program: ProgramDetail;
  readonly team: ProgramTeam;
  readonly application: StudentApplication | null;
  readonly sessionNickname: string;
  readonly invitation: TeamInvitationManagement;

  readonly inviteOpen: boolean;
  readonly onOpenInvite: () => void;
  readonly onCloseInvite: () => void;

  readonly inviteTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly refreshError: string | null;
  readonly onRefresh: () => void;
  readonly submissionContent: ReactNode;
  readonly onMembersChanged: () => void;
  readonly onDeparted: () => void;
}

function stageBody({
  programId,
  stage,
  team,
  application,
}: {
  readonly programId: string;
  readonly stage: MyTeamApplicationStage;
  readonly team: ProgramTeam;
  readonly application: StudentApplication | null;
}): ReactNode {
  if (stage === 'draft') {
    if (!team.isLeader) {
      return (
        <p className="text-body break-keep">
          신청서는 팀장이 작성해 제출합니다. 제출되면 이 화면에서 검토 상태를
          함께 확인할 수 있습니다.
        </p>
      );
    }
    return (
      <>
        <p className="text-body break-keep">
          신청서는 팀장이 작성해 제출합니다. 제출 전 내용은 저장되지 않습니다.
        </p>
        <div className="flex justify-end">
          <Button asChild>
            <Link href={programApplyHref(programId)}>신청서 작성</Link>
          </Button>
        </div>
      </>
    );
  }

  if (stage === 'submitted' && application !== null) {
    return (
      <>
        <p className="text-body break-keep">
          교직원 검토를 기다리는 중입니다. 결과는 이 화면과 알림으로 전해집니다.
        </p>
        {application.canManage ? (
          <div className="flex justify-end">
            <Button asChild variant="outline">
              <Link href={programApplyHref(programId)}>신청서 확인·수정</Link>
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  if (stage === 'rejected' && application !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>반려 사유</AlertTitle>
        <AlertDescription className="break-keep">
          {application.rejectionReason?.trim() ||
            '교직원이 남긴 사유가 없습니다. 자세한 내용은 주관 부서에 문의해 주세요.'}
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

function ApplicationStageCard({
  programId,
  stage,
  team,
  application,
}: {
  readonly programId: string;
  readonly stage: MyTeamApplicationStage;
  readonly team: ProgramTeam;
  readonly application: StudentApplication | null;
}) {
  const body = stageBody({ programId, stage, team, application });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2 className="contents">신청 상태</h2>
        </CardTitle>
        <CardDescription>
          {application === null
            ? '아직 제출된 신청서가 없습니다.'
            : `${application.answers.title} · ${formatSeoulDate(application.submittedAt)} 제출`}
        </CardDescription>
      </CardHeader>
      {body === null ? null : (
        <CardContent className="flex flex-col gap-3">{body}</CardContent>
      )}
    </Card>
  );
}

export function ProgramMyTeamView({
  programId,
  program,
  team,
  application,
  sessionNickname,
  invitation,
  inviteOpen,
  onOpenInvite,
  onCloseInvite,
  inviteTriggerRef,
  refreshError,
  onRefresh,
  submissionContent,
  onMembersChanged,
  onDeparted,
}: ProgramMyTeamViewProps) {
  const stage = myTeamApplicationStage(application);
  const badge = STAGE_BADGES[stage];

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={team.name}
        description={program.name}
        actions={
          badge === null ? undefined : (
            <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
          )
        }
      />

      {refreshError ? (
        <Alert variant="destructive">
          <AlertTitle>최신 상태 확인 실패</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span className="break-keep">{refreshError}</span>
            <Button type="button" variant="outline" onClick={onRefresh}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <ApplicationStageCard
        programId={programId}
        stage={stage}
        team={team}
        application={application}
      />

      <TeamMembersPanel
        programId={programId}
        team={team}
        sessionNickname={sessionNickname}
        onChanged={onMembersChanged}
        mode="manage"
        invitation={invitation}
        onOpenInvite={onOpenInvite}
        inviteTriggerRef={inviteTriggerRef}
      />

      {team.canInvite ? (
        <TeamInvitePanel
          invitation={invitation}
          open={inviteOpen}
          onClose={onCloseInvite}
          returnFocusRef={inviteTriggerRef}
        />
      ) : null}

      {application !== null && stage === 'approved' ? (
        <TeamRepositoryPanel
          key={[
            sessionNickname,
            team.isLeader,
            application.id,
            application.status,
            program.operatingPeriod?.endsAt,
            team.members.map((member) => member.userId).join(','),
          ].join('|')}
          programId={programId}
          teamId={team.id}
          activityTitle="우리 팀 활동"
          lockedHint="승인된 팀의 팀장만 프로그램 종료 전까지 변경할 수 있습니다."
          saveRepositoryUrl={(repositoryUrl) =>
            updateRepositoryUrl(programId, { repositoryUrl })
          }
        />
      ) : null}

      {stage === 'approved' ? submissionContent : null}

      <ApplicationTeamDeparture
        programId={programId}
        team={team}
        sessionNickname={sessionNickname}
        onDeparted={onDeparted}
      />
    </PageBody>
  );
}
