import { PrismaService } from '../prisma/prisma.service';
import { ProgramTeamsRepository } from './repository/program-teams.repository';

export const teamFindFirst = jest.fn();
export const applicationFindFirst = jest.fn();
export const contributionGroupBy = jest.fn();
export const auditFindMany = jest.fn<Promise<unknown[]>, [unknown]>();
export const provisionFindUnique = jest.fn();
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    team: { findFirst: teamFindFirst },
    application: { findFirst: applicationFindFirst },
    contribution: { groupBy: contributionGroupBy },
    auditLog: { findMany: auditFindMany },
    outboxEvent: { findUnique: jest.fn().mockResolvedValue(null) },
    repositoryProvisionJob: { findUnique: provisionFindUnique },
  })),
}));

export function givenRepository(
  lastSuccessAt: Date | null = new Date('2026-08-31Z'),
  failureCount = 0,
  repositoryUrl: string | null = null,
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
    id: 'application',
    status: 'APPROVED',
    updatedAt: new Date('2026-08-01Z'),
    repositoryConnectionMode: 'NEW',
    repositoryUrl,
    isRepositoryPublicationPlanned: false,
    repository: {
      id: 'current-repo',
      nameWithOwner: 'synthetic/current',
      visibility: 'PRIVATE',
      lastSuccessAt,
      failureCount,
    },
    program: {
      id: 'program',
      startAt: new Date('2026-07-31T15:00:00Z'),
      endAt: new Date('2026-08-31T14:59:59Z'),
      repositoryProvisioningEnabled: true,
      milestones: [],
    },
    milestoneDocumentSubmissions: [],
  });
  auditFindMany.mockResolvedValue([]);
  provisionFindUnique.mockResolvedValue(null);
  contributionGroupBy.mockResolvedValue([
    {
      githubId: 101n,
      _sum: { commitCount: 3, pullRequestCount: 2, releaseCount: 1 },
    },
    {
      githubId: 999n,
      _sum: { commitCount: 4, pullRequestCount: 0, releaseCount: 0 },
    },
  ]);
  return new ProgramTeamsRepository(new PrismaService());
}
