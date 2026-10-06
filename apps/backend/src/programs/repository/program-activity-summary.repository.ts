import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ProgramRepositoryLink {
  readonly programId: string;
  readonly githubRepositoryId: bigint;
}

export interface ProgramActivitySummaryDataSource {
  readonly githubRepository: {
    findMany(args: {
      readonly where: {
        readonly programId: { readonly in: string[] };
        readonly applicationId: { readonly not: null };
      };
      readonly select: {
        readonly programId: true;
        readonly githubRepositoryId: true;
      };
    }): Promise<
      readonly { programId: string | null; githubRepositoryId: bigint }[]
    >;
  };
}

@Injectable()
export class ProgramActivitySummaryRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ProgramActivitySummaryDataSource,
  ) {}

  async findRepositoryLinks(
    programIds: readonly string[],
  ): Promise<readonly ProgramRepositoryLink[]> {
    if (programIds.length === 0) return [];
    const rows = await this.prisma.githubRepository.findMany({
      where: {
        programId: { in: [...programIds] },
        applicationId: { not: null },
      },
      select: { programId: true, githubRepositoryId: true },
    });

    return rows.filter(
      (row): row is { programId: string; githubRepositoryId: bigint } =>
        row.programId !== null,
    );
  }
}
