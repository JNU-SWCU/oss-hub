import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, type ApplicationStatus } from '@prisma/client';
import { STUDENT_MEMBER_WHERE } from '../platform/user-profile-read.config';
import { PlatformRepository } from '../platform/platform.repository';

export type StudentRepositoryUrlContext = {
  readonly id: string;
  readonly programId: string;
  readonly teamId: string;
  readonly status: ApplicationStatus;
  readonly applicantId: string;
  readonly applicant: { readonly githubId: bigint };
  readonly team: { readonly leaderId: string };
  readonly program: { readonly name: string; readonly endAt: Date };
  readonly repository: {
    readonly id: string;
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
  } | null;
};

export type TeamRepositoryUrlContext = StudentRepositoryUrlContext & {
  readonly editor: {
    readonly nickname: string;
    readonly isLeader: boolean;
    readonly isStaff: boolean;
  };
};

@Injectable()
export class StudentRepositoryUrlContextRepository {
  constructor(private readonly platformRepository: PlatformRepository) {}

  async readTeamRepositoryUrlContext(
    db: Prisma.TransactionClient,
    programId: string,
    teamId: string,
    actorGithubId: bigint,
  ): Promise<TeamRepositoryUrlContext | null> {
    const actor = await db.user.findFirst({
      where: { githubId: actorGithubId, accountStatus: AccountStatus.ACTIVE },
      select: {
        id: true,
        nickname: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
      },
    });
    if (!actor) return null;
    const context = await db.application.findUnique({
      where: { programId_teamId: { programId, teamId } },
      select: this.STUDENT_REPOSITORY_URL_SELECT,
    });
    if (!context) return null;
    const leads = await db.application.count({
      where: {
        id: context.id,
        AND: [
          this.platformRepository.programApplicationManagerWhere(actor.id),
          { team: { leader: STUDENT_MEMBER_WHERE } },
        ],
      },
    });
    return {
      ...context,
      editor: {
        nickname: actor.nickname,
        isLeader: leads === 1,
        isStaff: actor.hasStaffAccess || actor.hasAdminAccess,
      },
    };
  }

  readonly STUDENT_REPOSITORY_URL_SELECT = {
    id: true,
    programId: true,
    teamId: true,
    status: true,
    applicantId: true,
    applicant: { select: { githubId: true } },
    team: { select: { leaderId: true } },
    program: { select: { name: true, endAt: true } },
    repository: {
      select: { id: true, githubRepositoryId: true, nameWithOwner: true },
    },
  } as const satisfies Prisma.ApplicationSelect;
}
