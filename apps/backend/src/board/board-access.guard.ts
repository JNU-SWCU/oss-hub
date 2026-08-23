import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AccountStatus, ApplicationStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { programApplicationParticipantWhere } from '../programs/program-participant';
import { BOARD_ERROR_CODES, BoardErrorCode } from './board-error-code.enum';

export interface BoardActorRequest extends AuthenticatedRequest {
  boardActorId: string;
  boardActorIsStaff: boolean;
}

/**
 * 게시판은 해당 프로그램 참여자(승인된 신청자)와 교직원만 읽고 쓴다(#619) — 공개
 * endpoint가 아니다. SessionGuard 다음에 적용해 `sessionGithubId`를 읽는다.
 *
 * 교직원 여부는 역할만으로 판정한다(특정 프로그램 소속을 요구하지 않음 — 프로토타입에서
 * 교직원은 모든 프로그램의 게시판에 접근한다). 학생은 해당 프로그램에 APPROVED
 * Application을 가진 신청자·팀원일 때만 참여자로 인정한다(programParticipantWhere와
 * 동일 기준, #109/#164).
 */
@Injectable()
export class BoardAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params: Record<string, string> }>();
    const programId = request.params.programId;

    const user = await this.prisma.user.findUnique({
      where: { githubId: request.sessionGithubId },
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        BOARD_ERROR_CODES[BoardErrorCode.ACCESS_FORBIDDEN],
      );
    }

    // 교직원 접근과 관리자 접근은 서로 독립이다 — 어느 한쪽만 있어도 교직원 면을 얻는다.
    if (user.hasStaffAccess || user.hasAdminAccess) {
      Object.assign(request, {
        boardActorId: user.id,
        boardActorIsStaff: true,
      });
      return true;
    }

    const participant = await this.prisma.application.findFirst({
      where: {
        programId,
        status: ApplicationStatus.APPROVED,
        ...programApplicationParticipantWhere(user.id),
      },
      select: { id: true },
    });
    if (!participant) {
      throw new DomainException(
        BOARD_ERROR_CODES[BoardErrorCode.ACCESS_FORBIDDEN],
      );
    }
    Object.assign(request, {
      boardActorId: user.id,
      boardActorIsStaff: false,
    });
    return true;
  }
}
