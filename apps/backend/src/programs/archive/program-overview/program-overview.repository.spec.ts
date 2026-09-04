import { ProgramOverviewRepository } from './program-overview.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';

describe('ProgramOverviewRepository', () => {
  describe('findMilestoneSchedules', () => {
    it('동일 dueAt에서도 id 보조 정렬로 마감 목록 순서를 고정한다', async () => {
      const milestoneFindMany = jest.fn().mockResolvedValue([
        {
          id: 'milestone-a',
          name: '합성 마감 A',
          dueAt: new Date('2026-09-12T09:00:00.000Z'),
        },
        {
          id: 'milestone-b',
          name: '합성 마감 B',
          dueAt: new Date('2026-09-12T09:00:00.000Z'),
        },
      ]);
      const repository = new ProgramOverviewRepository({
        milestone: { findMany: milestoneFindMany },
      } as never);

      const result =
        await repository.findMilestoneSchedules(syntheticProgramId);

      expect(milestoneFindMany).toHaveBeenCalledWith({
        where: { programId: syntheticProgramId },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, dueAt: true },
      });
      expect(result.map(({ milestoneId }) => milestoneId)).toEqual([
        'milestone-a',
        'milestone-b',
      ]);
    });
  });

  describe('countFullySubmittedTeamsByMilestone', () => {
    it('마일스톤이 여럿이어도 제출 groupBy는 1회이고 쿼리 수는 상수다', async () => {
      // Given — 3개 마일스톤, 2팀(다인 팀 + 1인 팀)
      const applications = [
        { id: 'app-team-a', teamId: 'team-a' },
        { id: 'app-team-b', teamId: 'team-b' },
      ];
      const applicationFindMany = jest.fn().mockResolvedValue(applications);
      const submissionGroupBy = jest.fn().mockResolvedValue([
        // team-a: m1 필수 전부(doc-1,doc-2) + m2 필수 전부(doc-4,doc-5)
        { milestoneDocumentId: 'doc-1', applicationId: 'app-team-a' },
        { milestoneDocumentId: 'doc-2', applicationId: 'app-team-a' },
        { milestoneDocumentId: 'doc-4', applicationId: 'app-team-a' },
        { milestoneDocumentId: 'doc-5', applicationId: 'app-team-a' },
        // team-b(1인 팀): m1 필수 전부, m2 미완
        { milestoneDocumentId: 'doc-1', applicationId: 'app-team-b' },
        { milestoneDocumentId: 'doc-2', applicationId: 'app-team-b' },
      ]);
      const prisma = {
        application: { findMany: applicationFindMany },
        milestoneDocumentSubmission: { groupBy: submissionGroupBy },
      };
      const repository = new ProgramOverviewRepository(prisma as never);

      const milestones = [
        {
          milestoneId: 'm1',
          requiredDocumentIds: ['doc-1', 'doc-2'],
        },
        {
          milestoneId: 'm2',
          requiredDocumentIds: ['doc-4', 'doc-5'],
        },
        {
          milestoneId: 'm3',
          requiredDocumentIds: ['doc-7'],
        },
      ];

      // When
      const result = await repository.countFullySubmittedTeamsByMilestone(
        syntheticProgramId,
        milestones,
      );

      // Then — 상수 쿼리: application.findMany 1 + submission.groupBy 1
      expect(applicationFindMany).toHaveBeenCalledTimes(1);
      expect(submissionGroupBy).toHaveBeenCalledTimes(1);
      expect(submissionGroupBy).toHaveBeenCalledWith({
        by: ['milestoneDocumentId', 'applicationId'],
        where: {
          applicationId: { in: ['app-team-a', 'app-team-b'] },
          milestoneDocumentId: {
            in: expect.arrayContaining<string>([
              'doc-1',
              'doc-2',
              'doc-4',
              'doc-5',
              'doc-7',
            ]) as unknown,
          },
        },
      });
      // m1: 두 팀 모두 필수 완료(1인 팀 포함). m2: team-a만. m3: 0.
      expect(result.get('m1')).toBe(2);
      expect(result.get('m2')).toBe(1);
      expect(result.get('m3')).toBe(0);
    });

    it('필수 서류가 비어 있으면 모든 팀을 완료로 센다(vacuous true)', async () => {
      const applicationFindMany = jest.fn().mockResolvedValue([
        { id: 'app-1', teamId: 'team-1' },
        { id: 'app-2', teamId: 'team-2' },
      ]);
      const submissionGroupBy = jest.fn();
      const prisma = {
        application: { findMany: applicationFindMany },
        milestoneDocumentSubmission: { groupBy: submissionGroupBy },
      };
      const repository = new ProgramOverviewRepository(prisma as never);

      const result = await repository.countFullySubmittedTeamsByMilestone(
        syntheticProgramId,
        [{ milestoneId: 'm-optional-only', requiredDocumentIds: [] }],
      );

      expect(submissionGroupBy).not.toHaveBeenCalled();
      expect(result.get('m-optional-only')).toBe(2);
    });
  });

  describe('findSubmittedDocumentIds', () => {
    it('groupBy(milestoneDocumentId) 1회로 제출 서류 id를 모은다', async () => {
      const submissionGroupBy = jest
        .fn()
        .mockResolvedValue([
          { milestoneDocumentId: 'doc-1' },
          { milestoneDocumentId: 'doc-3' },
        ]);
      const prisma = {
        milestoneDocumentSubmission: { groupBy: submissionGroupBy },
      };
      const repository = new ProgramOverviewRepository(prisma as never);

      const result = await repository.findSubmittedDocumentIds('app-1', [
        'doc-1',
        'doc-2',
        'doc-3',
      ]);

      expect(submissionGroupBy).toHaveBeenCalledTimes(1);
      expect(submissionGroupBy).toHaveBeenCalledWith({
        by: ['milestoneDocumentId'],
        where: {
          applicationId: 'app-1',
          milestoneDocumentId: { in: ['doc-1', 'doc-2', 'doc-3'] },
        },
      });
      expect(result).toEqual(new Set(['doc-1', 'doc-3']));
    });
  });
});
