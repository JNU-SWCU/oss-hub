import { PlatformRepository } from '../platform/platform.repository';
import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { RequirementFeedbackRepository } from './requirement-feedback.repository';

const REVIEWED_AT = new Date('2026-09-20T01:00:00.000Z');
const REVIEWED_SINCE = new Date('2026-09-12T15:00:00.000Z');

function repositoryWith(
  user: { readonly id: string } | null,
  rows: readonly unknown[] = [],
) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = {
    user: { findUnique },
    submissionHistory: { findMany },
  } as unknown as PrismaService;
  return {
    repository: new RequirementFeedbackRepository(
      prisma,
      new PlatformRepository(),
    ),
    findUnique,
    findMany,
  };
}

describe('RequirementFeedbackRepository', () => {
  it('승인된 신청 중 지금 팀원인 신청의 판정을 기준 시각부터 최신순으로 최대 50건 읽는다', async () => {
    const { repository, findUnique, findMany } = repositoryWith(
      { id: 'synthetic-student' },
      [
        {
          id: 'review-1',
          event: 'CHANGES_REQUESTED',
          comment: '표지를 보완해 주세요.',
          createdAt: REVIEWED_AT,
          submission: {
            id: 'submission-1',
            status: SubmissionStatus.CHANGES_REQUESTED,
            teamId: 'application-1',
            requirement: {
              name: '합성 계획서',
              milestone: {
                id: 'milestone-1',
                name: '중간 보고',
                programId: 'program-1',
              },
            },
          },
        },
      ],
    );

    const reviews = await repository.findRecentForParticipant(
      34_290_100n,
      REVIEWED_SINCE,
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId: 34_290_100n },
      select: { id: true },
    });
    const [args] = findMany.mock.calls[0] as [
      {
        readonly where: unknown;
        readonly orderBy: unknown;
        readonly take: unknown;
        readonly select: Record<string, unknown>;
      },
    ];
    expect(args.where).toEqual({
      createdAt: { gte: REVIEWED_SINCE },
      event: { in: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] },
      submission: {
        is: {
          team: {
            is: {
              status: ApplicationStatus.APPROVED,
              members: { some: { userId: 'synthetic-student' } },
            },
          },
        },
      },
    });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(50);
    expect(JSON.stringify(args.select)).not.toContain('reviewer');
    expect(reviews).toEqual([
      {
        id: 'review-1',
        decision: 'CHANGES_REQUESTED',
        comment: '표지를 보완해 주세요.',
        reviewedAt: REVIEWED_AT,
        teamId: 'application-1',
        programId: 'program-1',
        milestoneId: 'milestone-1',
        milestoneName: '중간 보고',
        documentName: '합성 계획서',
        submissionId: 'submission-1',
        submissionStatus: SubmissionStatus.CHANGES_REQUESTED,
      },
    ]);
  });

  it('세션 사용자가 없으면 판정을 읽지 않고 빈 목록을 돌려준다', async () => {
    const { repository, findMany } = repositoryWith(null);

    await expect(
      repository.findRecentForParticipant(34_290_101n, REVIEWED_SINCE),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
