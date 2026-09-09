import { Injectable } from '@nestjs/common';
import { Prisma, type ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { programApplicationParticipantWhere } from '../programs/program-participant';
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

  withTransaction<T>(
    operation: (store: StudentRepositoryUrlTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new StudentRepositoryUrlTransaction(transaction)),
    );
  }
}
