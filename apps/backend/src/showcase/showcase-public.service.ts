import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  type PublicArchiveDetailResponseDto,
  PublicArchiveApplicationMode,
  type PublicArchiveListResponseDto,
  type PublicArchiveQueryRequestDto,
} from './dto/public-archive-response.dto';
import {
  SHOWCASE_ERROR_CODES,
  ShowcaseErrorCode,
} from './showcase-error-code.enum';

@Injectable()
export class ShowcasePublicService {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(
    query: PublicArchiveQueryRequestDto,
  ): Promise<PublicArchiveListResponseDto> {
    const where = this.listWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.publicShowcaseRepository.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { repositoryId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.publicShowcaseRepository.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        repositoryId: row.repositoryId,
        programId: row.programId,
        programName: row.programName,
        category: row.programCategory,
        applicationMode: this.applicationMode(row.teamName),
        displayName: row.displayName,
        githubUrl: row.repositoryUrl,
        publishedAt: row.publishedAt.toISOString(),
        detailUrl: `/archive/${row.repositoryId}`,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async findDetail(
    repositoryId: string,
  ): Promise<PublicArchiveDetailResponseDto> {
    const row = await this.prisma.publicShowcaseRepository.findUnique({
      where: { repositoryId },
      include: {
        contributors: {
          select: { userId: true, githubNickname: true, avatarUrl: true },
          orderBy: { userId: 'asc' },
        },
      },
    });
    if (row === null) {
      throw new DomainException(
        SHOWCASE_ERROR_CODES[ShowcaseErrorCode.PUBLIC_PROJECT_NOT_FOUND],
      );
    }

    return {
      repositoryId: row.repositoryId,
      programId: row.programId,
      programName: row.programName,
      category: row.programCategory,
      applicationMode: this.applicationMode(row.teamName),
      displayName: row.displayName,
      repositoryName: row.repositoryName,
      githubUrl: row.repositoryUrl,
      publishedAt: row.publishedAt.toISOString(),
      approvedSubmissionCount: row.approvedSubmissionCount,
      contributors: row.contributors.map((contributor) => ({
        userId: contributor.userId,
        githubNickname: contributor.githubNickname,
        avatarUrl: contributor.avatarUrl,
      })),
    };
  }

  private listWhere(
    query: PublicArchiveQueryRequestDto,
  ): Prisma.PublicShowcaseRepositoryWhereInput {
    const q = query.q.trim();
    return {
      ...(q.length > 0
        ? {
            OR: [
              { programName: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
              { repositoryName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.category === undefined
        ? {}
        : { programCategory: query.category }),
      ...(query.applicationMode === undefined
        ? {}
        : query.applicationMode === PublicArchiveApplicationMode.PERSONAL
          ? { teamName: null }
          : { teamName: { not: null } }),
    };
  }

  private applicationMode(
    teamName: string | null,
  ): PublicArchiveApplicationMode {
    return teamName === null
      ? PublicArchiveApplicationMode.PERSONAL
      : PublicArchiveApplicationMode.TEAM;
  }
}
