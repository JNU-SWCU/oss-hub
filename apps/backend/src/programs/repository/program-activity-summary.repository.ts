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
      // 지금 신청에 걸린 저장소만 센다. 팀이 A→B로 바꾸면 A는 `applicationId`만 비고
      // `programId`는 이력으로 남는다 — 그대로 세면 A의 수가 프로그램 합계에 계속 더해진다.
      where: {
        programId: { in: [...programIds] },
        applicationId: { not: null },
      },
      select: { programId: true, githubRepositoryId: true },
    });
    // where절이 programId IN (...)을 강제하므로 null programId 행은 매칭될 수 없다
    // (GithubRepository는 #617 단계 D부터 programId가 nullable이라 select 타입만 넓어졌다).
    return rows.filter(
      (row): row is { programId: string; githubRepositoryId: bigint } =>
        row.programId !== null,
    );
  }
}
