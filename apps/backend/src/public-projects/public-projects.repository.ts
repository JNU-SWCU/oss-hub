import { Injectable } from '@nestjs/common';
import { type ProgramCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * todo 16 — ADR-003 공개 strict-read 예외를 쓰는 전용 repository. `Repository`(원본) 및
 * `User`(신원 최소 필드)만 명시적 select로 읽는다 — wildcard `include`는 절대 쓰지 않는다.
 * 모든 질의가 `visibility: 'PUBLIC'`·`publishedAt: { not: null }`로 platform eligibility를
 * DB 경계에서 먼저 걸러, private/unpublished 저장소와 존재하지 않는 저장소가 서비스 계층에서
 * 항상 동일하게 "행 없음"으로 보이게 한다(동일 404의 토대). Collection freshness fence는
 * 여기서 다루지 않는다 — `PublicEligibilityService`(todo 15)의 책임이다.
 */
export interface PublicProjectRow {
  readonly id: string;
  /**
   * 공개 API가 노출하는 프로젝트 식별자. `Repository.id`(내부 seed 추적 키 — `seed:...`처럼
   * 콜론을 포함할 수 있다)와 달리, 프런트(`apps/frontend/src/features/archive/api.ts`)가
   * 강제하는 `/^[A-Za-z0-9_-]+$/` 계약을 항상 만족하는 `githubRepositoryId`(BigInt, unique,
   * non-null) 문자열이다. cursor 등 내부 용도로는 여전히 `id`를 쓴다.
   */
  readonly projectId: string;
  readonly githubRepositoryId: bigint;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: Date;
  readonly programId: string;
  readonly programName: string;
  readonly category: ProgramCategory;
  readonly teamName: string | null;
  /** 개인 참여는 멤버 1명인 팀이다(D5·D6) — 표시명·유형 구분에 인원이 필요하다. */
  readonly teamMemberCount: number;
  readonly applicantNickname: string;
}

export interface PublicProjectCursor {
  readonly publishedAt: Date;
  readonly id: string;
}

export interface PublicUserIdentity {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;
  /**
   * todo 18 — profile 서비스가 `CollectionContributorCumulativeMetricsDto.githubUserId`와
   * 매칭할 내부 키. 실명·studentId·department·email·role과 달리 응답 DTO에는 노출하지 않는다.
   */
  readonly githubId: bigint;
}

const PROJECT_ROW_SELECT = {
  id: true,
  githubRepositoryId: true,
  name: true,
  url: true,
  publishedAt: true,
  programId: true,
  program: { select: { name: true, category: true } },
  team: { select: { name: true, _count: { select: { members: true } } } },
  application: { select: { applicant: { select: { nickname: true } } } },
} as const;

type ProjectRowSelection = {
  id: string;
  githubRepositoryId: bigint;
  name: string;
  url: string;
  publishedAt: Date | null;
  programId: string;
  program: { name: string; category: ProgramCategory };
  team: { name: string; _count: { members: number } } | null;
  application: { applicant: { nickname: string } };
};

function toProjectRow(row: ProjectRowSelection): PublicProjectRow {
  return {
    id: row.id,
    projectId: row.githubRepositoryId.toString(),
    githubRepositoryId: row.githubRepositoryId,
    repositoryName: row.name,
    githubUrl: row.url,
    // where절이 publishedAt: { not: null }을 강제하므로 null이 아니다.
    publishedAt: row.publishedAt!,
    programId: row.programId,
    programName: row.program.name,
    category: row.program.category,
    teamName: row.team?.name ?? null,
    teamMemberCount: row.team?._count?.members ?? 0,
    applicantNickname: row.application.applicant.nickname,
  };
}

@Injectable()
export class PublicProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `(publishedAt desc, id desc)` 순서의 keyset 커서 페이지네이션. `cursor`가 `null`이면
   * 첫 페이지다. `take`는 호출자가 `pageSize + 1`을 넘겨 lookahead로 다음 페이지 존재 여부를
   * 판단할 수 있게 한다 — 페이지 경계는 이 원본 조회 하나로만 결정되고, eligibility 필터링이
   * 경계를 옮기지 않는다(`Repository_visibility_publishedAt_id_idx` 사용).
   * `category`가 있으면 해당 프로그램 분류만 서버에서 거른다.
   */
  async listPage(
    cursor: PublicProjectCursor | null,
    take: number,
    category?: ProgramCategory,
  ): Promise<PublicProjectRow[]> {
    const rows = await this.prisma.repository.findMany({
      where: {
        visibility: 'PUBLIC',
        publishedAt: { not: null },
        ...(category === undefined ? {} : { program: { category } }),
        ...(cursor === null
          ? {}
          : {
              OR: [
                { publishedAt: { lt: cursor.publishedAt } },
                { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take,
      select: PROJECT_ROW_SELECT,
    });
    return rows.map(toProjectRow);
  }

  /**
   * 플랫폼 공개 프로젝트의 프로그램 분류별 개수. eligibility fence는 적용하지 않는다.
   * `Program.category`로 GROUP BY 1회. 없는 분류는 호출 측에서 0으로 채운다.
   */
  async countByCategory(): Promise<
    readonly { readonly category: ProgramCategory; readonly count: number }[]
  > {
    const rows = await this.prisma.$queryRaw<
      readonly { category: ProgramCategory; count: bigint }[]
    >`
      SELECT p.category AS category, COUNT(*)::bigint AS count
      FROM "Repository" r
      INNER JOIN "Program" p ON p.id = r."programId"
      WHERE r.visibility = 'PUBLIC'::"RepositoryVisibility"
        AND r."publishedAt" IS NOT NULL
      GROUP BY p.category
    `;
    return rows.map((row) => ({
      category: row.category,
      count: Number(row.count),
    }));
  }

  /**
   * `projectId`는 공개 계약상 `githubRepositoryId`(BigInt) 문자열이다. 숫자가 아니면
   * `BigInt()` 변환이 던지므로, 존재하지 않는 프로젝트와 동일하게 `null`을 돌려준다.
   */
  async findById(projectId: string): Promise<PublicProjectRow | null> {
    if (!/^[0-9]+$/.test(projectId)) return null;

    const row = await this.prisma.repository.findFirst({
      where: {
        githubRepositoryId: BigInt(projectId),
        visibility: 'PUBLIC',
        publishedAt: { not: null },
      },
      select: PROJECT_ROW_SELECT,
    });
    return row === null ? null : toProjectRow(row);
  }

  /**
   * 단독 지원자(팀 없음) 또는 팀(리더·멤버)으로 참여한 공개-발행 저장소를 모두 찾는다.
   * repositoryIds 크기와 무관하게 findMany 질의 1개다.
   */
  async listForUser(userId: string): Promise<PublicProjectRow[]> {
    const rows = await this.prisma.repository.findMany({
      where: {
        visibility: 'PUBLIC',
        publishedAt: { not: null },
        OR: [
          { teamId: null, application: { applicantId: userId } },
          { team: { leaderId: userId } },
          { team: { members: { some: { userId } } } },
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: PROJECT_ROW_SELECT,
    });
    return rows.map(toProjectRow);
  }

  async findUserIdentity(userId: string): Promise<PublicUserIdentity | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nickname: true, avatarUrl: true, githubId: true },
    });
    return user === null
      ? null
      : {
          userId: user.id,
          githubNickname: user.nickname,
          avatarUrl: user.avatarUrl,
          githubId: user.githubId,
        };
  }
}
