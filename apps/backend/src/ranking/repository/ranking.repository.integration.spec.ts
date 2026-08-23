import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RankingService } from '../service/ranking.service';
import { RankingRepository } from './ranking.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new RankingRepository(prisma);

const PREFIX = 'synthetic-ranking-student-only';
const YEAR = 2116;
const OBSERVED_AT = new Date('2116-03-04T00:00:00.000Z');

/**
 * 한 축만 다른 6종 합성 계정. 회원 유형 외의 모든 칸(활성 상태·닉네임·관측)이 같아야
 * 순위에서 빠지는 이유가 `UserProfile.memberKind` 하나로 좁혀진다.
 */
interface SyntheticMember {
  readonly key: string;
  readonly githubId: bigint;
  /** 관리자 권한 — 회원 유형과 독립이라 별도 축이다(학생 관리자·교직원 관리자). */
  readonly hasAdminAccess?: boolean;
  readonly memberKind: MemberKind | null | 'no-profile';
  readonly commitCount: number;
  /** 학생만 갖는 6자리 학번. 교직원·미지정은 null 이다. */
  readonly studentId: string | null;
}

const MEMBERS: readonly SyntheticMember[] = [
  {
    key: 'student',
    githubId: 8_961_000_000_001n,
    memberKind: MemberKind.STUDENT,
    commitCount: 7,
    studentId: '260101',
  },
  {
    key: 'student-admin',
    githubId: 8_961_000_000_002n,
    hasAdminAccess: true,
    memberKind: MemberKind.STUDENT,
    commitCount: 5,
    studentId: '260102',
  },
  {
    key: 'staff',
    githubId: 8_961_000_000_003n,
    memberKind: MemberKind.STAFF,
    commitCount: 90,
    studentId: null,
  },
  {
    key: 'staff-admin',
    githubId: 8_961_000_000_004n,
    hasAdminAccess: true,
    memberKind: MemberKind.STAFF,
    commitCount: 80,
    studentId: null,
  },
  {
    key: 'unassigned',
    githubId: 8_961_000_000_005n,
    memberKind: null,
    commitCount: 70,
    studentId: null,
  },
  {
    key: 'missing-profile',
    githubId: 8_961_000_000_006n,
    memberKind: 'no-profile',
    commitCount: 60,
    studentId: null,
  },
];

const VISIBLE_LOGINS = [`${PREFIX}-student`, `${PREFIX}-student-admin`];

function login(member: SyntheticMember): string {
  return `${PREFIX}-${member.key}`;
}

/** canonical 프로필 하나만 심는다 — legacy mirror 칸은 계약 단계에서 사라졌다. */
async function seed(member: SyntheticMember): Promise<void> {
  const userId = `${PREFIX}-${member.key}`;
  const name = `합성 ${member.key}`;
  const department = `${PREFIX}-학부`;
  await prisma.user.create({
    data: {
      id: userId,
      githubId: member.githubId,
      nickname: login(member),
      accountStatus: AccountStatus.ACTIVE,
      selectedMemberKind:
        member.memberKind === 'no-profile' ? null : member.memberKind,
      hasStaffAccess: member.memberKind === MemberKind.STAFF,
      hasAdminAccess: member.hasAdminAccess ?? false,
      // `no-profile`은 프로필 행 자체가 없고, `null`은 유형을 아직 고르지 않아
      // 계약 스키마에서 프로필 행을 만들 수 없다 — 둘 다 순위에서 자연히 빠진다.
      ...(member.memberKind === 'no-profile' || member.memberKind === null
        ? {}
        : {
            profile: {
              create: {
                name,
                studentId: member.studentId,
                department,
                memberKind: member.memberKind,
                affiliationKind:
                  member.memberKind === MemberKind.STAFF
                    ? AffiliationKind.PROGRAM_OFFICE
                    : AffiliationKind.DEPARTMENT,
                affiliationName: department,
              },
            },
          }),
    },
  });
  await prisma.githubUserActivityHistory.create({
    data: {
      githubId: member.githubId,
      githubLogin: login(member),
      year: YEAR,
      commitCount: member.commitCount,
      pullRequestCount: 1,
      issueCount: 1,
      repositoryCount: 1,
      starCount: 1,
      observedAt: OBSERVED_AT,
    },
  });
}

async function purge(): Promise<void> {
  const githubIds = MEMBERS.map((member) => member.githubId);
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await purge();
  for (const member of MEMBERS) {
    await seed(member);
  }
});

afterAll(async () => {
  await purge();
  await prisma.$disconnect();
});

describe('RankingRepository.findMetrics — canonical STUDENT 경계', () => {
  it('학생과 학생 관리자만 집계 행으로 나온다', async () => {
    const rows = await repository.findMetrics({ currentYear: YEAR });

    expect(
      rows
        .filter((row) => row.githubLogin.startsWith(PREFIX))
        .map((row) => row.githubLogin)
        .sort(),
    ).toEqual(VISIBLE_LOGINS);
  });

  it('교직원·교직원 관리자·미지정·프로필 없음은 연도 무관 조회에서도 빠진다', async () => {
    const rows = await repository.findMetrics({});

    const excluded = MEMBERS.filter(
      (member) => member.memberKind !== MemberKind.STUDENT,
    ).map(login);
    const seen = rows.map((row) => row.githubLogin);
    for (const excludedLogin of excluded) {
      expect(seen).not.toContain(excludedLogin);
    }
  });

  it('학생 행의 지표·학과는 기존 계약 그대로 실린다', async () => {
    const rows = await repository.findMetrics({ currentYear: YEAR });

    expect(rows.find((row) => row.githubLogin === `${PREFIX}-student`)).toEqual(
      {
        githubId: 8_961_000_000_001n,
        githubLogin: `${PREFIX}-student`,
        department: `${PREFIX}-학부`,
        commitCount: 7,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 1,
        starCount: 1,
      },
    );
  });
});

/**
 * 같은 PostgreSQL 을 공유하는 형제 스펙도 canonical 학생을 정당하게 심는다 — 그래서 전역
 * 총계가 아니라 이 파일이 심은 cohort 만 본다. 전역 숫자를 박아 두면 실행 순서가 초록·빨강을
 * 가르는 defect 가 되고, 그러면서도 제외 대상이 한 명이라도 새면 여전히 빨강이다.
 */
async function collectCohortItems(
  service: RankingService,
  githubId: bigint | null,
): Promise<readonly Record<string, unknown>[]> {
  const pageSize = 100;
  const collected: Record<string, unknown>[] = [];
  const first = await service.findPage(YEAR, 1, pageSize, githubId);
  collected.push(...(first.items as unknown as Record<string, unknown>[]));
  const pageCount = Math.ceil(first.total / pageSize);
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await service.findPage(YEAR, page, pageSize, githubId);
    collected.push(...(next.items as unknown as Record<string, unknown>[]));
  }
  return collected.filter((item) =>
    String(item.githubLogin).startsWith(PREFIX),
  );
}

function excludedLogins(): readonly string[] {
  return MEMBERS.filter(
    (member) => member.memberKind !== MemberKind.STUDENT,
  ).map(login);
}

describe('RankingService — 순위 페이지·페이지네이션·DTO 모두 학생만 담는다', () => {
  it('공개 페이지의 cohort 항목이 학생 2명뿐이고 실명 칸이 없다', async () => {
    const service = new RankingService(repository);

    const items = await collectCohortItems(service, null);

    expect(items.map((item) => item.githubLogin).sort()).toEqual(
      VISIBLE_LOGINS,
    );
    for (const item of items) {
      expect(item).not.toHaveProperty('name');
    }
  });

  it('pageSize=1로 전 페이지를 순회해도 제외된 계정은 어느 페이지에도 없다', async () => {
    const service = new RankingService(repository);

    const firstPage = await service.findPage(YEAR, 1, 1, null);
    const seen: string[] = [];
    for (let page = 1; page <= firstPage.total; page += 1) {
      const result = await service.findPage(YEAR, page, 1, null);
      seen.push(...result.items.map((item) => item.githubLogin));
    }

    for (const excluded of excludedLogins()) {
      expect(seen).not.toContain(excluded);
    }
    expect(
      seen.filter((githubLogin) => githubLogin.startsWith(PREFIX)).sort(),
    ).toEqual(VISIBLE_LOGINS);
  });

  it('같은 연도를 두 번 물어도 제외 경계가 그대로다', async () => {
    const service = new RankingService(repository);

    const first = await collectCohortItems(service, null);
    const second = await collectCohortItems(service, null);

    expect(second).toEqual(first);
    expect(second.map((item) => item.githubLogin).sort()).toEqual(
      VISIBLE_LOGINS,
    );
  });

  it('교직원 열람자에게도 제외 경계와 실명 부착 대상이 학생뿐이다', async () => {
    const service = new RankingService(repository);
    const staffMember = MEMBERS.find((member) => member.key === 'staff');
    const viewerGithubId = staffMember?.githubId ?? null;

    const page = await service.findPage(YEAR, 1, 20, viewerGithubId);
    const items = await collectCohortItems(service, viewerGithubId);

    expect(page.viewerClass).toBe('staff');
    expect(items.map((item) => item.githubLogin).sort()).toEqual(
      VISIBLE_LOGINS,
    );
    expect(items.every((item) => 'name' in item)).toBe(true);
  });
});
