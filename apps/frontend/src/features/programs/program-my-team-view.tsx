'use client';

import Link from 'next/link';
import type { ReactNode, RefObject } from 'react';
import {
  PageBody,
  PageHeader,
  SectionHeading,
  StatusBadge,
} from '@/components';
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
import { ActivityGraphContent } from './components/activity-graph-panel';
import { formatSeoulDate } from './program-detail-format';
import type { StudentApplication } from './student-application-api';
import { TeamInvitePanel } from './team-invite-panel';
import { TeamMembersPanel } from './team-members-panel';
import type { ProgramDetail } from './types';
import type { TeamInvitationManagement } from './use-team-invitation-management';

/**
 * 팀이 지금 어디까지 왔는가. 서버가 준 사실(`team.hasApplication`,
 * `application.status`)만으로 정하고, 화면이 모드를 추측하지 않는다.
 *
 * `draft`는 「팀은 있는데 제출된 신청서가 없다」이다 — 신청서를 못 낸 것이
 * 아니라 아직 안 낸 것이므로 팀장에게 이어서 쓸 자리를 준다.
 */
export type MyTeamApplicationStage =
  'draft' | 'submitted' | 'approved' | 'rejected';

export function myTeamApplicationStage(
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

/** 신청이 없으면 배지를 생략한다. 실제 활동·제출 권한은 기존 stage로 판단한다. */
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
  /** 초대 다이얼로그의 열림 여부. 여는 곳은 명단의 초대 버튼 하나뿐이다. */
  readonly inviteOpen: boolean;
  readonly onOpenInvite: () => void;
  readonly onCloseInvite: () => void;
  /** 다이얼로그가 닫힐 때 초점이 돌아갈 자리 — 명단 안의 초대 버튼. */
  readonly inviteTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly refreshError: string | null;
  readonly onRefresh: () => void;
  readonly submissionContent: ReactNode;
  readonly onMembersChanged: () => void;
  readonly onDeparted: () => void;
}

/**
 * 이 단계에서 화면이 실제로 더 할 말이 있는가. 없으면 `null`이고, 그때 카드는
 * 본문 자체를 그리지 않는다 — 승인처럼 상태 배지와 제출 사실만 있는 자리에
 * 빈 본문이 카드 안쪽 간격만큼 빈 틈을 남기지 않도록.
 */
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
    // 팀원에게 「내 신청서」 동선을 다시 내밀지 않는다 — 이 팀의 신청서는
    // 하나이고 그것을 내는 사람은 팀장뿐이다.
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
        {/*
          쓰던 내용이 어딘가에 남아 있다고 말하지 않는다 — 신청서 임시 저장은
          없고, 화면을 떠나면 입력한 내용은 사라진다.
        */}
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

/**
 * 「우리 팀」 본문 — 데이터는 받기만 하고 조회하지 않는다.
 *
 * 이 화면의 h1은 팀 이름 하나뿐이다. 프로그램 이름은 설명 줄로 내려, 좌측 패널이
 * 이미 말하고 있는 문맥을 제목이 되풀이하지 않는다. 인원수는 명단 카드가 이미
 * 말하므로 머리글이 같은 숫자를 한 번 더 세지 않는다.
 */
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

      {/*
        명단이 자기 행동을 모두 가진다 — 초대 버튼도, 대기 중인 초대 행도
        팀원 목록 안에 있다. 화면 머리에는 상태만 남는다.
      */}
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

      {stage === 'approved' ? (
        <section
          className="flex flex-col gap-3"
          aria-labelledby="my-team-activity"
        >
          <SectionHeading id="my-team-activity" title="우리 팀 활동" />
          {/* 프로그램이 바뀌면 이전 프로그램의 활동을 그대로 두지 않는다. */}
          <ActivityGraphContent key={programId} programId={programId} />
        </section>
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
