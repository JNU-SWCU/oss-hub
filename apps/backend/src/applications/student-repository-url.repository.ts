import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, type ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STUDENT_MEMBER_WHERE } from '../profiles/user-profile-read';
import {
  programApplicationManagerWhere,
  programApplicationParticipantWhere,
} from '../programs/program-participant';
import { StudentRepositoryUrlTransaction } from './student-repository-url.transaction.repository';

export const STUDENT_REPOSITORY_URL_SELECT = {
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

/** 바꾸려는 사람이 이 팀에 대해 가진 사실. 허용 여부는 service가 정한다. */
export type TeamRepositoryUrlContext = StudentRepositoryUrlContext & {
  readonly editor: {
    readonly nickname: string;
    readonly isLeader: boolean;
    readonly isStaff: boolean;
  };
};

/**
 * 팀장은 그 팀의 현재 팀장인 ACTIVE 학생이고, 교직원은 ACTIVE이면서 교직원·관리자
 * 접근이 있는 사람이다. 잠그기 전 확인과 잠근 뒤 재확인이 같은 판정이어야 해서
 * 한 함수로 둔다.
 */
export async function readTeamRepositoryUrlContext(
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
    select: STUDENT_REPOSITORY_URL_SELECT,
  });
  if (!context) return null;
  const leads = await db.application.count({
    where: {
      id: context.id,
      AND: [
        programApplicationManagerWhere(actor.id),
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

@Injectable()
export class StudentRepositoryUrlRepository {
  constructor(private readonly prisma: PrismaService) {}

  findContext(
    programId: string,
    studentId: string,
  ): Promise<StudentRepositoryUrlContext | null> {
    return this.prisma.application.findFirst({
      where: { programId, ...programApplicationParticipantWhere(studentId) },
      select: STUDENT_REPOSITORY_URL_SELECT,
    });
  }

  findTeamContext(
    programId: string,
    teamId: string,
    actorGithubId: bigint,
  ): Promise<TeamRepositoryUrlContext | null> {
    return readTeamRepositoryUrlContext(
      this.prisma,
      programId,
      teamId,
      actorGithubId,
    );
  }

  withTransaction<T>(
    operation: (store: StudentRepositoryUrlTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new StudentRepositoryUrlTransaction(transaction)),
    );
  }
}
