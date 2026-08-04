import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  RepositoryVisibility,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShowcaseProjectionRepository } from './showcase-projection.repository';

export interface ShowcaseBackfillResult {
  readonly projected: number;
  readonly revoked: number;
  readonly skipped: number;
}

type ProjectionResult = 'projected' | 'revoked' | 'skipped';

@Injectable()
export class ShowcaseProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ShowcaseProjectionRepository,
  ) {}

  async projectRepository(
    repositoryId: string,
    now = new Date(),
  ): Promise<ProjectionResult> {
    return this.prisma.$transaction((transaction) =>
      this.projectInTransaction(transaction, repositoryId, now),
    );
  }

  async backfillAll(now = new Date()): Promise<ShowcaseBackfillResult> {
    const repositoryIds = await this.prisma.$transaction((transaction) =>
      this.repository.listPublicRepositoryIds(transaction),
    );
    let projected = 0;
    let revoked = 0;
    let skipped = 0;
    for (const repositoryId of repositoryIds) {
      const outcome = await this.projectRepository(repositoryId, now);
      if (outcome === 'projected') projected += 1;
      if (outcome === 'revoked') revoked += 1;
      if (outcome === 'skipped') skipped += 1;
    }
    return { projected, revoked, skipped };
  }

  private async projectInTransaction(
    transaction: Prisma.TransactionClient,
    repositoryId: string,
    now: Date,
  ): Promise<ProjectionResult> {
    const repository = await this.repository.findRepositoryForProjection(
      transaction,
      repositoryId,
    );
    if (!this.isEligible(repository, now)) {
      const deleted = await transaction.publicShowcaseRepository.deleteMany({
        where: { repositoryId },
      });
      return deleted.count === 0 ? 'skipped' : 'revoked';
    }

    const approvedSubmissionCount =
      await this.repository.countApprovedSubmissions(
        transaction,
        repository.applicationId,
      );
    const contributors = this.contributors(repository);
    await transaction.publicShowcaseRepository.upsert({
      where: { repositoryId },
      create: {
        repositoryId,
        githubRepositoryId: repository.githubRepositoryId,
        repositoryName: repository.name,
        repositoryUrl: repository.url,
        publishedAt: repository.publishedAt!,
        programId: repository.programId,
        programName: repository.program.name,
        programCategory: repository.program.category,
        programEndAt: repository.program.endAt!,
        teamName: repository.team?.name ?? null,
        displayName:
          repository.team?.name ?? repository.application.applicant.nickname,
        approvedSubmissionCount,
      },
      update: {
        githubRepositoryId: repository.githubRepositoryId,
        repositoryName: repository.name,
        repositoryUrl: repository.url,
        publishedAt: repository.publishedAt!,
        programId: repository.programId,
        programName: repository.program.name,
        programCategory: repository.program.category,
        programEndAt: repository.program.endAt!,
        teamName: repository.team?.name ?? null,
        displayName:
          repository.team?.name ?? repository.application.applicant.nickname,
        approvedSubmissionCount,
      },
    });
    await transaction.publicShowcaseContributor.deleteMany({
      where: { repositoryId },
    });
    await transaction.publicShowcaseContributor.createMany({
      data: contributors.map((contributor) => ({
        repositoryId,
        ...contributor,
      })),
    });
    return 'projected';
  }

  private isEligible(
    repository: Awaited<
      ReturnType<ShowcaseProjectionRepository['findRepositoryForProjection']>
    >,
    now: Date,
  ): repository is NonNullable<typeof repository> {
    return (
      repository !== null &&
      repository.visibility === RepositoryVisibility.PUBLIC &&
      repository.application.status === ApplicationStatus.APPROVED &&
      repository.application.programId === repository.programId &&
      // 저장소가 팀을 가리키면 신청과 같은 팀이어야 한다. `Repository.teamId`는
      // 여전히 nullable이고(D5는 `Application.teamId`만 필수로 만들었다) 정합 백필은
      // 하지 않았으므로, 저장소에 팀이 없는 것 자체는 불일치가 아니다.
      (repository.team === null ||
        repository.application.teamId === repository.team.id) &&
      repository.program.endAt !== null &&
      repository.program.endAt <= now &&
      repository.publishedAt !== null &&
      repository.name.length > 0 &&
      repository.url === `https://github.com/JNU-SWCU/${repository.name}` &&
      (repository.team === null || repository.team.name.length > 0)
    );
  }

  private contributors(
    repository: NonNullable<
      Awaited<
        ReturnType<ShowcaseProjectionRepository['findRepositoryForProjection']>
      >
    >,
  ): { userId: string; githubNickname: string; avatarUrl: string | null }[] {
    const users =
      repository.team === null
        ? [repository.application.applicant]
        : [
            repository.team.leader,
            ...repository.team.members.map((member) => member.user),
          ];
    return [...new Map(users.map((user) => [user.id, user])).values()].map(
      (user) => ({
        userId: user.id,
        githubNickname: user.nickname,
        avatarUrl: user.avatarUrl,
      }),
    );
  }
}
