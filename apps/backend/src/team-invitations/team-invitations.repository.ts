import { Injectable } from '@nestjs/common';
import { Prisma, TeamInvitationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

/** 초대 검색 결과 후보 — 공개해도 되는 필드만 담는다(학번·이메일·연락처 제외). */
export interface InvitationCandidateRecord {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface CreateInvitationInput {
  readonly teamId: string;
  readonly programId: string;
  readonly inviteeId: string;
  readonly invitedById: string;
}

export type AcceptInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'already-in-team' }
  | { readonly kind: 'team-full' }
  | {
      readonly kind: 'ok';
      readonly teamId: string;
      readonly programId: string;
    };

export class PendingInvitationConflictError extends Error {
  override readonly name = 'PendingInvitationConflictError';
}

interface LockedTeamRow {
  readonly id: string;
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
        invitedBy: { select: { nickname: true, name: true } },
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
        invitation.invitedBy.name?.trim() || invitation.invitedBy.nickname,
      memberCount: invitation.team._count.members,
      teamMaxSize: invitation.team.program.teamMaxSize,
    }));
  }

  /** 팀이 보낸 초대 목록 — 최신 발송분이 먼저 온다. */
  async findByTeamId(teamId: string): Promise<TeamInvitationRecord[]> {
    return this.prisma.teamInvitation.findMany({
      where: { teamId },
      orderBy: { invitedAt: 'desc' },
    });
  }

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

  async isUserInProgramTeam(
    programId: string,
    userId: string,
  ): Promise<boolean> {
    const member = await this.prisma.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { userId: true },
    });
    return member !== null;
  }

  async userExists(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return user !== null;
  }

  async countTeamMembers(teamId: string): Promise<number> {
    return this.prisma.teamMember.count({ where: { teamId } });
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
    return this.prisma.user.findMany({
      where: {
        id: { not: excludeUserId },
        OR: [
          { nickname: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
        teamMemberships: { none: { programId } },
      },
      select: { id: true, nickname: true, name: true, avatarUrl: true },
      orderBy: { nickname: 'asc' },
      take: 20,
    });
  }

  async createInvitation(
    input: CreateInvitationInput,
    now: Date = new Date(),
  ): Promise<TeamInvitationRecord> {
    try {
      return await this.prisma.teamInvitation.create({
        data: {
          teamId: input.teamId,
          programId: input.programId,
          inviteeId: input.inviteeId,
          invitedById: input.invitedById,
          invitedAt: now,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === '23505')
      ) {
        throw new PendingInvitationConflictError();
      }
      // partial unique index는 Prisma가 P2002로 매핑하지 못하고 DB 제약 위반(23505)
      // raw code로 올라올 수 있어 함께 잡는다(#164 패턴 마이그레이션 SQL 참고).
      throw error;
    }
  }

  async findInvitationForActor(
    invitationId: string,
  ): Promise<(TeamInvitationRecord & { readonly leaderId: string }) | null> {
    const invitation = await this.prisma.teamInvitation.findUnique({
      where: { id: invitationId },
      include: { team: { select: { leaderId: true } } },
    });
    if (!invitation) return null;
    return {
      id: invitation.id,
      teamId: invitation.teamId,
      programId: invitation.programId,
      inviteeId: invitation.inviteeId,
      invitedById: invitation.invitedById,
      status: invitation.status,
      invitedAt: invitation.invitedAt,
      respondedAt: invitation.respondedAt,
      leaderId: invitation.team.leaderId,
    };
  }

  /**
   * 대기 중인 초대를 DECLINED로 닫는다. 팀장의 취소·초대받은 이의 거절 모두 이
   * 메서드를 쓴다 — 스키마에 별도 CANCELLED 상태가 없어 "합류로 이어지지 않은
   * 종결"을 DECLINED 하나로 표현한다(#164 Prisma 스키마 계약). 이미 응답된
   * 초대는 count 0으로 알린다(호출자가 상태 전이 실패로 판단한다).
   */
  async closePendingInvitationAsDeclined(
    invitationId: string,
  ): Promise<number> {
    const result = await this.prisma.teamInvitation.updateMany({
      where: { id: invitationId, status: TeamInvitationStatus.PENDING },
      data: { status: TeamInvitationStatus.DECLINED, respondedAt: new Date() },
    });
    return result.count;
  }

  /**
   * 수락 트랜잭션 — 팀 행을 `FOR UPDATE`로 잠가 같은 팀에 대한 동시 수락 사이의
   * 정원 초과 경합을 직렬화한다(#164 패턴). 잠금 뒤 상태 재조회와 `updateMany`의
   * WHERE status=PENDING 재평가로 동시 수락·거절 경합을 원자적으로 막는다.
   */
  async withAcceptTransaction(
    invitationId: string,
    inviteeId: string,
    now: Date = new Date(),
  ): Promise<AcceptInvitationOutcome> {
    const acceptance = this.prisma.$transaction<AcceptInvitationOutcome>(
      async (tx) => {
        const invitation = await tx.teamInvitation.findUnique({
          where: { id: invitationId },
          select: {
            id: true,
            teamId: true,
            programId: true,
            inviteeId: true,
            team: { select: { program: { select: { teamMaxSize: true } } } },
          },
        });
        if (!invitation) return { kind: 'not-found' };
        if (invitation.inviteeId !== inviteeId) return { kind: 'forbidden' };

        await tx.$queryRaw<LockedTeamRow[]>(
          Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${invitation.teamId} FOR UPDATE`,
        );

        const currentInvitation = await tx.teamInvitation.findUnique({
          where: { id: invitationId },
          select: { status: true },
        });
        if (!currentInvitation) return { kind: 'not-found' };
        if (currentInvitation.status !== TeamInvitationStatus.PENDING) {
          return { kind: 'not-pending' };
        }

        const existingMembership = await tx.teamMember.findUnique({
          where: {
            programId_userId: {
              programId: invitation.programId,
              userId: inviteeId,
            },
          },
          select: { userId: true },
        });
        if (existingMembership) return { kind: 'already-in-team' };

        const maxSize = invitation.team.program.teamMaxSize;
        const memberCount = await tx.teamMember.count({
          where: { teamId: invitation.teamId },
        });
        if (memberCount >= maxSize) return { kind: 'team-full' };

        const updated = await tx.teamInvitation.updateMany({
          where: { id: invitationId, status: TeamInvitationStatus.PENDING },
          data: { status: TeamInvitationStatus.ACCEPTED, respondedAt: now },
        });
        if (updated.count === 0) return { kind: 'not-pending' };

        await tx.teamMember.create({
          data: {
            teamId: invitation.teamId,
            programId: invitation.programId,
            userId: inviteeId,
          },
        });

        return {
          kind: 'ok',
          teamId: invitation.teamId,
          programId: invitation.programId,
        };
      },
    );
    try {
      return await acceptance;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { kind: 'already-in-team' };
      }
      throw error;
    }
  }
}
