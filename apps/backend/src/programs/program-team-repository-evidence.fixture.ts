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
export const historyQuery = jest.fn<
  Promise<unknown[]>,
  [TemplateStringsArray, ...unknown[]]
>();
export const provisionFindUnique = jest.fn();
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
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
      historyQuery(strings, ...values),
    outboxEvent: { findUnique: jest.fn().mockResolvedValue(null) },
    repositoryProvisionJob: { findUnique: provisionFindUnique },
  })),
}));

export function givenRepository(
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
    teamRepos: [
      {
        repo: {
          githubRepoId: 4242n,
          ownerName: 'synthetic/current',
          visibility: 'PRIVATE',
        },
      },
    ],
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
  provisionFindUnique.mockResolvedValue(null);
  const prisma = new PrismaService();
  return new TeamRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    new PlatformRepository(),
    new TeamHistoryRepository(),
  );
}
