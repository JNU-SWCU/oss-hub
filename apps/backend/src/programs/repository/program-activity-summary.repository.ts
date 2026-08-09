import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ProgramRepositoryLink {
  readonly programId: string;
  readonly githubRepositoryId: bigint;
}

export interface ProgramActivitySummaryDataSource {
  readonly repository: {
    findMany(args: {
      readonly where: {
        readonly programId: { readonly in: readonly string[] };
      };
      readonly select: {
        readonly programId: true;
        readonly githubRepositoryId: true;
      };
    }): Promise<readonly ProgramRepositoryLink[]>;
  };
}

@Injectable()
export class ProgramActivitySummaryRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ProgramActivitySummaryDataSource,
  ) {}

  findRepositoryLinks(
    programIds: readonly string[],
  ): Promise<readonly ProgramRepositoryLink[]> {
    if (programIds.length === 0) return Promise.resolve([]);
    return this.prisma.repository.findMany({
      where: { programId: { in: [...programIds] } },
      select: { programId: true, githubRepositoryId: true },
    });
  }
}
