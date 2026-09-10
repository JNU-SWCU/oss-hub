import { Injectable } from '@nestjs/common';
import { Prisma, TeamInvitationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../profiles/user-profile-read';
import {
  acceptTeamInvitationTransaction,
  type AcceptInvitationOnOk,
  type AcceptInvitationOutcome,
} from './team-invitation-acceptance.repository';
import {
  getInviteeEligibility,
  type InvitationCandidateRecord,
  type InviteeEligibility,
  searchInvitationCandidates,
} from './team-invitation-candidates.repository';

export type {
  AcceptInvitationOnOk,
  AcceptInvitationOutcome,
} from './team-invitation-acceptance.repository';
export type {
  InvitationCandidateRecord,
  InviteeEligibility,
} from './team-invitation-candidates.repository';

export interface TeamInvitationRecord {
  id: string;
  teamId: string;
  programId: string;
  inviteeId: string;
  invitedById: string;
  status: TeamInvitationStatus;
  invitedAt: Date;
  respondedAt: Date | null;
}

/** 팀장이 확인할 수 있는 초대 대상의 최소 표시 정보. */
export interface TeamInvitationInvitee {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/** 보낸 초대 목록·생성 응답에만 대상 표시 정보를 더한 모양. */
export interface SentTeamInvitationRecord extends TeamInvitationRecord {
  readonly invitee: TeamInvitationInvitee;
}

const TEAM_INVITEE_SELECT = {
  id: true,
  nickname: true,
  ...USER_PROFILE_NAME_SELECT,
  avatarUrl: true,
} as const satisfies Prisma.UserSelect;

const SENT_TEAM_INVITATION_SELECT = {
  id: true,
  teamId: true,
  programId: true,
  inviteeId: true,
  invitedById: true,
  status: true,
  invitedAt: true,
  respondedAt: true,
  invitee: { select: TEAM_INVITEE_SELECT },
} as const satisfies Prisma.TeamInvitationSelect;

type SentTeamInvitationRow = Prisma.TeamInvitationGetPayload<{
  select: typeof SENT_TEAM_INVITATION_SELECT;
}>;

function toSentTeamInvitationRecord(
  invitation: SentTeamInvitationRow,
): SentTeamInvitationRecord {
  return {
    id: invitation.id,
    teamId: invitation.teamId,
    programId: invitation.programId,
    inviteeId: invitation.inviteeId,
    invitedById: invitation.invitedById,
    status: invitation.status,
    invitedAt: invitation.invitedAt,
    respondedAt: invitation.respondedAt,
    invitee: {
      id: invitation.invitee.id,
      nickname: invitation.invitee.nickname,
      name: resolveUserProfileName(invitation.invitee),
      avatarUrl: invitation.invitee.avatarUrl,
    },
  };
}

/**
 * 받은 초대 하나 + 카드로 보여 줄 요약.
 *
 * 왜 서버가 요약까지 싣는가. 초대받은 사람은 **아직 그 프로그램에 참여하지 않았다.**
 * 그래서 팀 이름·프로그램 이름을 자기 참여 목록에서 찾을 수 없고, 프로그램별 팀
 * 디렉터리(`getProgramTeamDirectory`)로 메꾸려면 초대에 걸린 프로그램 수만큼 조회가
 * 늘어난다. 초대 행을 읽는 김에 같은 질의로 실어 보내는 편이 정확하고 싸다.
 *
 * ⚠ 초대자에 대해서는 표시용 이름 하나만 싣는다 — 학번·이메일·연락처는 select하지
 * 않는다(`InvitationCandidateRecord`와 같은 개인정보 경계).
 */
export interface ReceivedTeamInvitationRecord extends TeamInvitationRecord {
  readonly teamName: string;
  readonly programName: string;
  readonly invitedByDisplayName: string;
  readonly memberCount: number;
  readonly teamMaxSize: number;
}

/** 팀 검색·초대 권한 판단에 필요한 팀 맥락. */
export interface TeamContextRecord {
  readonly teamId: string;
  readonly programId: string;
  readonly leaderId: string;
  readonly teamMaxSize: number;
}

export interface CreateInvitationInput {
  readonly teamId: string;
  /** 초대를 보내는 사람 — 팀 잠금 뒤 팀장·소속을 다시 확인할 기준이다. */
  readonly actorId: string;
  readonly inviteeId: string;
}

/**
 * 초대 생성 결과. 잠금 전 사전 조회는 전부 낡을 수 있어 최종 판정은 트랜잭션
 * 안에서만 하고, 실패 사유를 호출부가 그대로 에러 코드로 옮길 수 있게 outcome으로
 * 돌려준다(수락 트랜잭션과 같은 모양).
 */
export type CreateInvitationOutcome =
  | { readonly kind: 'team-not-found' }
  | { readonly kind: 'not-team-leader' }
  | { readonly kind: 'not-team-member' }
  | { readonly kind: 'invitee-already-in-team' }
  | { readonly kind: 'team-full' }
  | { readonly kind: 'already-invited' }
  | {
      readonly kind: 'ok';
      readonly invitation: SentTeamInvitationRecord;
    };

/** 팀장의 대기 초대 취소 결과. */
export type CancelInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-team-leader' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'ok' };

/** 초대받은 본인의 거절 결과. */
export type DeclineInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'ok' };

interface LockedTeamRow {
  readonly id: string;
}

function lockTeamRow(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  teamId: string,
): Promise<LockedTeamRow[]> {
  return tx.$queryRaw<LockedTeamRow[]>(
    Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
  );
}

@Injectable()
export class TeamInvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserIdByGithubId(githubId: bigint): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * 초대 대상 본인이 받은 초대 목록 — 최신 발송분이 먼저 온다.
   *
   * 상태로 거르지 않는다. `PENDING`만 돌려주면 화면이 응답 직후에 사라진 초대를
   * "없던 일"로 그려야 하고, 이미 이 목록을 쓰는 팀 화면이 자기 기준으로
   * 거르고 있다(`program-teams-page.tsx`). 거르는 자리는 호출부에 둔다.
   */
  async findByInviteeId(
    inviteeId: string,
  ): Promise<ReceivedTeamInvitationRecord[]> {
    const invitations = await this.prisma.teamInvitation.findMany({
      where: { inviteeId },
      orderBy: { invitedAt: 'desc' },
      include: {
        team: {
          select: {
            name: true,
            program: { select: { name: true, teamMaxSize: true } },
            _count: { select: { members: true } },
          },
        },
        invitedBy: {
          select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
        },
      },
    });

    return invitations.map((invitation) => ({
      id: invitation.id,
      teamId: invitation.teamId,
      programId: invitation.programId,
      inviteeId: invitation.inviteeId,
      invitedById: invitation.invitedById,
      status: invitation.status,
      invitedAt: invitation.invitedAt,
      respondedAt: invitation.respondedAt,
      teamName: invitation.team.name,
      programName: invitation.team.program.name,
      // 팀 초대 화면이 후보를 그리는 규칙과 같다 — 실명이 있으면 실명, 없으면
      // GitHub handle. `nickname`은 non-null이라 빈 문자열로 떨어지지 않는다.
      invitedByDisplayName:
        resolveUserProfileName(invitation.invitedBy)?.trim() ||
        invitation.invitedBy.nickname,
      memberCount: invitation.team._count.members,
      teamMaxSize: invitation.team.program.teamMaxSize,
    }));
  }

  /** 팀이 보낸 초대 목록 — 최신 발송분이 먼저 온다. */
  async findByTeamId(teamId: string): Promise<SentTeamInvitationRecord[]> {
    const invitations = await this.prisma.teamInvitation.findMany({
      where: { teamId },
      orderBy: { invitedAt: 'desc' },
      select: SENT_TEAM_INVITATION_SELECT,
    });
    return invitations.map(toSentTeamInvitationRecord);
  }

  /**
   * 조회·검색 권한 사전 판단용 스냅샷. 쓰기 경로의 최종 권한은 이 값이 아니라
   * 팀 행을 잠근 트랜잭션 안의 재조회가 정본이다.
   */
  async findTeamContext(teamId: string): Promise<TeamContextRecord | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        programId: true,
        leaderId: true,
        program: { select: { teamMaxSize: true } },
      },
    });
    if (!team) return null;
    return {
      teamId: team.id,
      programId: team.programId,
      leaderId: team.leaderId,
      teamMaxSize: team.program.teamMaxSize,
    };
  }

  async isTeamMember(teamId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { userId: true },
    });
    return member !== null;
  }

  async getInviteeEligibility(userId: string): Promise<InviteeEligibility> {
    return getInviteeEligibility(this.prisma, userId);
  }

  /**
   * 이름 또는 GitHub handle(nickname) 부분 일치 검색. 같은 프로그램에 이미 소속된
   * 사용자와 검색 실행자 본인은 결과에서 제외한다. 공개해도 되는 필드만 select한다
   * (학번·이메일·연락처는 select하지 않는다 — AGENTS.md 개인정보 경계).
   */
  async searchCandidates(
    programId: string,
    query: string,
    excludeUserId: string,
  ): Promise<InvitationCandidateRecord[]> {
    return searchInvitationCandidates(
      this.prisma,
      programId,
      query,
      excludeUserId,
    );
  }

  /**
   * 초대 생성 — 팀 행을 `FOR UPDATE`로 잠그고 그 안에서 팀장·소속·정원·대상의
   * 프로그램 소속을 다시 판정한다.
   *
   * 왜 재판정이 필요한가. 초대를 시작한 사람이 기다리는 사이에 탈퇴해 팀장이
   * 승계될 수 있다(`programs`의 탈퇴·제외도 같은 Team 행을 잠금다). 잠금 전
   * 스냅샷만 믿으면 이미 떠난 전 팀장의 초대가 통과한다.
   *
   * 신청 제출 여부는 보지 않는다 — 신청 창구는 초기 접수의 문이지 참여 중
   * 팀 구성 관리의 게이트가 아니다.
   */
  async createInvitation(
    input: CreateInvitationInput,
    now: Date = new Date(),
  ): Promise<CreateInvitationOutcome> {
    const creation = this.prisma.$transaction<CreateInvitationOutcome>(
      async (tx) => {
        await lockTeamRow(tx, input.teamId);

        const team = await tx.team.findUnique({
          where: { id: input.teamId },
          select: {
            id: true,
            programId: true,
            leaderId: true,
            program: { select: { teamMaxSize: true } },
          },
        });
        if (!team) return { kind: 'team-not-found' };

        // 권한을 먼저 본다 — 팀장이 아닌 사람에게 대상의 소속을 알리지 않는다.
        if (team.leaderId !== input.actorId) return { kind: 'not-team-leader' };
        const actorMembership = await tx.teamMember.findUnique({
          where: {
            teamId_userId: { teamId: team.id, userId: input.actorId },
          },
          select: { userId: true },
        });
        if (!actorMembership) return { kind: 'not-team-member' };

        const inviteeMembership = await tx.teamMember.findUnique({
          where: {
            programId_userId: {
              programId: team.programId,
              userId: input.inviteeId,
            },
          },
          select: { userId: true },
        });
        if (inviteeMembership) return { kind: 'invitee-already-in-team' };

        const memberCount = await tx.teamMember.count({
          where: { teamId: team.id },
        });
        if (memberCount >= team.program.teamMaxSize) {
          return { kind: 'team-full' };
        }

        const invitation = await tx.teamInvitation.create({
          data: {
            teamId: team.id,
            programId: team.programId,
            inviteeId: input.inviteeId,
            invitedById: input.actorId,
            invitedAt: now,
          },
          select: SENT_TEAM_INVITATION_SELECT,
        });
        return {
          kind: 'ok',
          invitation: toSentTeamInvitationRecord(invitation),
        };
      },
    );
    try {
      return await creation;
    } catch (error) {
      // partial unique index는 Prisma가 P2002로 매핑하지 못하고 DB 제약 위반(23505)
      // raw code로 올라올 수 있어 함께 잡는다(#164 패턴 마이그레이션 SQL 참고).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === '23505')
      ) {
        return { kind: 'already-invited' };
      }
      throw error;
    }
  }

  /**
   * 팀장의 대기 초대 취소 — 권한은 초대를 보낸 사람(`invitedById`)이 아니라
   * 팀 행을 잠근 시점의 **현재 팀장**이다. 그래야 승계받은 팀장이 전 팀장이
   * 남긴 초대를 정리할 수 있고, 이미 떠난 팀장은 정리할 수 없다.
   *
   * 스키마에 별도 CANCELLED 상태가 없어 "합류로 이어지지 않은 종결"은
   * DECLINED 하나로 표현한다(#164 Prisma 스키마 계약).
   */
  async cancelPendingInvitationAsLeader(
    invitationId: string,
    actorId: string,
    now: Date = new Date(),
  ): Promise<CancelInvitationOutcome> {
    return this.prisma.$transaction<CancelInvitationOutcome>(async (tx) => {
      const invitation = await tx.teamInvitation.findUnique({
        where: { id: invitationId },
        select: { teamId: true },
      });
      if (!invitation) return { kind: 'not-found' };

      await lockTeamRow(tx, invitation.teamId);

      const locked = await tx.teamInvitation.findUnique({
        where: { id: invitationId },
        select: { status: true, team: { select: { leaderId: true } } },
      });
      if (!locked) return { kind: 'not-found' };
      if (locked.team.leaderId !== actorId) return { kind: 'not-team-leader' };
      if (locked.status !== TeamInvitationStatus.PENDING) {
        return { kind: 'not-pending' };
      }

      const closed = await tx.teamInvitation.updateMany({
        where: { id: invitationId, status: TeamInvitationStatus.PENDING },
        data: { status: TeamInvitationStatus.DECLINED, respondedAt: now },
      });
      if (closed.count === 0) return { kind: 'not-pending' };
      return { kind: 'ok' };
    });
  }

  /**
   * 초대받은 본인의 거절. 본인 초대가 아니면 존재 여부를 알리지 않고
   * `not-found`로 돌려준다 — 초대 id를 추측해 다른 사람의 초대 존재를
   * 확인할 수 없게 한다. 상태 전이는 WHERE status=PENDING 재평가로 원자적이라
   * 팀 잠금이 필요 없다(멤버십을 바꾸지 않는다).
   */
  async declinePendingInvitationAsInvitee(
    invitationId: string,
    inviteeId: string,
    now: Date = new Date(),
  ): Promise<DeclineInvitationOutcome> {
    const closed = await this.prisma.teamInvitation.updateMany({
      where: {
        id: invitationId,
        inviteeId,
        status: TeamInvitationStatus.PENDING,
      },
      data: { status: TeamInvitationStatus.DECLINED, respondedAt: now },
    });
    if (closed.count > 0) return { kind: 'ok' };

    const own = await this.prisma.teamInvitation.findFirst({
      where: { id: invitationId, inviteeId },
      select: { id: true },
    });
    return own ? { kind: 'not-pending' } : { kind: 'not-found' };
  }

  /**
   * 수락 트랜잭션 — 팀 행을 `FOR UPDATE`로 잠가 같은 팀에 대한 동시 수락 사이의
   * 정원 초과 경합을 직렬화한다(#164 패턴). 잠금 뒤 상태 재조회와 `updateMany`의
   * WHERE status=PENDING 재평가로 동시 수락·거절 경합을 원자적으로 막는다.
   * 합류는 오직 여기서만 일어난다 — 초대 생성은 `TeamMember`를 만들지 않는다.
   */
  async withAcceptTransaction(
    invitationId: string,
    inviteeId: string,
    now: Date = new Date(),
    onOk?: AcceptInvitationOnOk,
  ): Promise<AcceptInvitationOutcome> {
    return acceptTeamInvitationTransaction(
      this.prisma,
      invitationId,
      inviteeId,
      now,
      onOk,
    );
  }
}
