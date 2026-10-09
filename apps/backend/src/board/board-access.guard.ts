import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AccountStatus, ApplicationStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/controller/http-auth';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { programApplicationParticipantWhere } from '../programs/program-participant';
import { BOARD_ERROR_CODES, BoardErrorCode } from './board-error-code.enum';

export interface BoardActorRequest extends AuthenticatedRequest {
  boardActorId: string;
  boardActorIsStaff: boolean;
}

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
