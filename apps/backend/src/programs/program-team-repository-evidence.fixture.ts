import { PlatformRepository } from '../platform/platform.repository';
import { ProgramTeamRepositoryEvidenceRepository } from './program-team-repository-evidence.repository';
import { PrismaService } from '../platform/prisma.service';
import { TeamRepository } from './team.repository';
import { TeamHistoryRepository } from './team-history.repository';

export const teamFindFirst = jest.fn<
  Promise<Record<string, unknown> | null>,
  [unknown]
>();
const applicationFindFirst = jest.fn<
  Promise<Record<string, unknown> | null>,
  [unknown]
>();
export const contributionQuery = jest.fn<
  Promise<unknown[]>,
  [TemplateStringsArray, ...unknown[]]
>();
export const historyQuery = jest.fn<
  Promise<unknown[]>,
  [TemplateStringsArray, ...unknown[]]
>();
export const provisionFindUnique = jest.fn();
export const repoFindUnique = jest.fn();
jest.mock('../platform/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    team: {
      findFirst: async (args: unknown): Promise<unknown> => {
        const team = await teamFindFirst(args);
        if (team === null) return null;
        const application = await applicationFindFirst(args);
        return { ...(application ?? {}), ...team };
      },
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.from(strings).join('');
      if (sql.includes('"contribution" AS event')) {
        return contributionQuery(strings, ...values);
      }
      return historyQuery(strings, ...values);
    },
    outboxEvent: { findUnique: jest.fn().mockResolvedValue(null) },
    repositoryProvisionJob: { findUnique: provisionFindUnique },
    repo: { findUnique: repoFindUnique },
  })),
}));

export function givenRepository(
  lastSuccessAt: Date | null = new Date('2026-08-31Z'),
  repositoryConnectionMode: 'NEW' | 'OWN' = 'NEW',
) {
  teamFindFirst.mockResolvedValue({
    id: 'team',
    name: 'Synthetic team',
    leaderId: 'member-a',
    members: [
      {
        userId: 'member-a',
        user: { githubId: 101n, nickname: 'renamed-login', name: null },
      },
      {
        userId: 'member-b',
        user: { githubId: 102n, nickname: 'student-b', name: null },
      },
    ],
  });
  applicationFindFirst.mockResolvedValue({
    id: 'team',
    status: 'APPROVED',
    updatedAt: new Date('2026-08-01Z'),
    repositoryConnectionMode,
    isRepositoryPublicationPlanned: false,
    repository: {
      id: 'current-repo',
      nameWithOwner: 'synthetic/current',
      visibility: 'PRIVATE',
      githubRepositoryId: 7001n,
    },
    program: {
      id: 'program',
      startAt: new Date('2026-07-31T15:00:00Z'),
      endAt: new Date('2026-08-31T14:59:59Z'),
      repositoryProvisioningEnabled: true,
      milestones: [],
    },
    submissions: [],
  });
  historyQuery.mockResolvedValue([]);
  repoFindUnique.mockResolvedValue(
    lastSuccessAt === null ? null : { lastSuccessAt },
  );
  provisionFindUnique.mockResolvedValue(null);
  contributionQuery.mockResolvedValue([
    {
      githubId: 101n,
      commitCount: 3,
      pullRequestCount: 2,
      releaseCount: 1,
      issueCount: 0,
    },
    {
      githubId: 999n,
      commitCount: 4,
      pullRequestCount: 0,
      releaseCount: 0,
      issueCount: 2,
    },
  ]);
  const prisma = new PrismaService();
  return new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  );
}
