import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { programApplicationParticipantWhere } from '../../prisma/program-application-participant';
import { PrismaService } from '../../prisma/prisma.service';
import {
  readTeamRepositoryUrlContext,
  STUDENT_REPOSITORY_URL_SELECT,
  type StudentRepositoryUrlContext,
  type TeamRepositoryUrlContext,
} from './student-repository-url-context.repository';
import { StudentRepositoryUrlTransaction } from './student-repository-url.transaction.repository';

export function isStudentRepositoryUrlConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
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
