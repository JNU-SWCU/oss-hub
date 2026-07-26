import { Injectable } from '@nestjs/common';
import {
  RepositoryVisibility,
  SubmissionStatus,
  type Prisma,
} from '@prisma/client';

@Injectable()
export class ShowcaseProjectionRepository {
  async findRepositoryForProjection(
    prisma: Prisma.TransactionClient,
    repositoryId: string,
  ) {
    return prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        application: { include: { applicant: true } },
        program: true,
        team: {
          include: {
            leader: true,
            members: { include: { user: true } },
          },
        },
      },
    });
  }

  async countApprovedSubmissions(
    prisma: Prisma.TransactionClient,
    applicationId: string,
  ): Promise<number> {
    return prisma.submission.count({
      where: { applicationId, status: SubmissionStatus.APPROVED },
    });
  }

  async listPublicRepositoryIds(
    prisma: Prisma.TransactionClient,
  ): Promise<string[]> {
    const repositories = await prisma.repository.findMany({
      where: { visibility: RepositoryVisibility.PUBLIC },
      select: { id: true },
    });
    return repositories.map((repository) => repository.id);
  }
}
