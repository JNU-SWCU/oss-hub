import { ProgramOverviewErrorCode } from './program-overview-error-code.enum';
import {
  CurrentSubmissionMilestone,
  MilestoneDocumentCatalogEntry,
  MilestoneSchedule,
  ProgramOverviewRecord,
  ProgramOverviewRepository,
  PublicTeamRow,
} from './program-overview.repository';
import { ProgramOverviewService } from './program-overview.service';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticProgramId = 'cuid-synthetic-program';
const syntheticGithubId = 123456789n;
const syntheticUserId = 'cuid-synthetic-user';
const syntheticApplicationId = 'cuid-synthetic-application';

const baseOverview: ProgramOverviewRecord = {
  programId: syntheticProgramId,
  name: 'seed-program-overview-project',
  trackType: 'CURRICULAR',
  lifecycle: 'PUBLISHED',
  milestoneCount: 7,
  boardPostCount: 3,
  participantCount: 188,
  teamCount: 47,
  connectedRepositoryCount: 47,
};

const currentMilestone: CurrentSubmissionMilestone = {
  milestoneId: 'cuid-synthetic-milestone-3',
  documentIds: ['doc-1', 'doc-2', 'doc-3'],
  requiredDocumentIds: ['doc-1', 'doc-2'],
};

/** 서류 0개 마일스톤(#1) + 서류 걸린 마일스톤 두 개. */
const milestoneDocumentCatalog: MilestoneDocumentCatalogEntry[] = [
  {
    milestoneId: 'cuid-synthetic-milestone-1',
    title: 'seed-program-overview-milestone-1',
    documentIds: [],
    requiredDocumentIds: [],
  },
  {
    milestoneId: currentMilestone.milestoneId,
    title: 'seed-program-overview-milestone-3',
    documentIds: currentMilestone.documentIds,
    requiredDocumentIds: currentMilestone.requiredDocumentIds,
  },
  {
    milestoneId: 'cuid-synthetic-milestone-4',
    title: 'seed-program-overview-milestone-4',
    documentIds: ['doc-4', 'doc-5', 'doc-6'],
    requiredDocumentIds: ['doc-4', 'doc-5'],
  },
];

describe('ProgramOverviewService', () => {
  describe('getOverview', () => {
    it('프로그램이 없으면 POV_001로 거부한다', async () => {
      // Given
      const repository = {
        findByProgramId: jest.fn().mockResolvedValue(null),
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When / Then
      await expect(
        service.getOverview(syntheticProgramId, syntheticGithubId),
      ).rejects.toMatchObject({
        errorCode: { code: ProgramOverviewErrorCode.PROGRAM_NOT_FOUND },
      });
    });

    it('학생이면서 서류 걸린 마일스톤이 있으면 프로그램 전체 내 제출 N/M과 마일스톤별 분해를 채운다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: 'STUDENT' });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const findViewerApplicationId = jest
        .fn()
        .mockResolvedValue(syntheticApplicationId);
      const findMilestoneDocumentCatalog = jest
        .fn()
        .mockResolvedValue(milestoneDocumentCatalog);
      // m3: doc-1,doc-2 / m4: doc-4 → parent completed=3, total=6
      const findSubmittedDocumentIds = jest
        .fn()
        .mockResolvedValue(new Set(['doc-1', 'doc-2', 'doc-4']));
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findViewerApplicationId,
        findMilestoneDocumentCatalog,
        findSubmittedDocumentIds,
        findMilestoneSchedules,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(findSubmittedDocumentIds).toHaveBeenCalledWith(
        syntheticApplicationId,
        ['doc-1', 'doc-2', 'doc-3', 'doc-4', 'doc-5', 'doc-6'],
      );
      expect(result.viewer).toEqual({
        role: 'STUDENT',
        myDocumentsCompleted: 3,
        myDocumentsTotal: 6,
        fullySubmittedParticipantCount: null,
        milestoneDocuments: [
          {
            milestoneId: currentMilestone.milestoneId,
            title: 'seed-program-overview-milestone-3',
            completed: 2,
            total: 3,
          },
          {
            milestoneId: 'cuid-synthetic-milestone-4',
            title: 'seed-program-overview-milestone-4',
            completed: 1,
            total: 3,
          },
        ],
      });
      expect(result.participantCount).toBe(188);
      expect(result.teamCount).toBe(47);
      expect(result.connectedRepositoryCount).toBe(47);
    });

    it('학생인데 이 프로그램에 신청이 없으면 완료 0으로 떨어진다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: 'STUDENT' });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const findViewerApplicationId = jest.fn().mockResolvedValue(null);
      const findMilestoneDocumentCatalog = jest
        .fn()
        .mockResolvedValue(milestoneDocumentCatalog);
      const findSubmittedDocumentIds = jest.fn();
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findViewerApplicationId,
        findMilestoneDocumentCatalog,
        findSubmittedDocumentIds,
        findMilestoneSchedules,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(findSubmittedDocumentIds).not.toHaveBeenCalled();
      expect(result.viewer).toEqual({
        role: 'STUDENT',
        myDocumentsCompleted: 0,
        myDocumentsTotal: 6,
        fullySubmittedParticipantCount: null,
        milestoneDocuments: [
          {
            milestoneId: currentMilestone.milestoneId,
            title: 'seed-program-overview-milestone-3',
            completed: 0,
            total: 3,
          },
          {
            milestoneId: 'cuid-synthetic-milestone-4',
            title: 'seed-program-overview-milestone-4',
            completed: 0,
            total: 3,
          },
        ],
      });
    });

    it('서류 걸린 마일스톤이 하나도 없으면 학생 viewer 수치는 전부 null/빈 배열이다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: 'STUDENT' });
      const findCurrentSubmissionMilestone = jest.fn().mockResolvedValue(null);
      const findViewerApplicationId = jest.fn();
      const findMilestoneDocumentCatalog = jest.fn();
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findViewerApplicationId,
        findMilestoneDocumentCatalog,
        findMilestoneSchedules,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(findViewerApplicationId).not.toHaveBeenCalled();
      expect(findMilestoneDocumentCatalog).not.toHaveBeenCalled();
      expect(result.viewer).toEqual({
        role: 'STUDENT',
        myDocumentsCompleted: null,
        myDocumentsTotal: null,
        fullySubmittedParticipantCount: null,
        milestoneDocuments: [],
      });
    });

    it('교직원이면 제출률 분자와 마일스톤별 분해(팀 수 기준)를 채운다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: 'STAFF' });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const countFullySubmittedParticipants = jest.fn().mockResolvedValue(128);
      const findMilestoneDocumentCatalog = jest
        .fn()
        .mockResolvedValue(milestoneDocumentCatalog);
      const countFullySubmittedTeamsByMilestone = jest.fn().mockResolvedValue(
        new Map([
          [currentMilestone.milestoneId, 12],
          ['cuid-synthetic-milestone-4', 0],
        ]),
      );
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        countFullySubmittedParticipants,
        findMilestoneDocumentCatalog,
        countFullySubmittedTeamsByMilestone,
        findMilestoneSchedules,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(countFullySubmittedParticipants).toHaveBeenCalledWith(
        syntheticProgramId,
        currentMilestone.requiredDocumentIds,
      );
      // 서류 0개 마일스톤(#1)은 배치 호출에서도 빠진다.
      expect(countFullySubmittedTeamsByMilestone).toHaveBeenCalledWith(
        syntheticProgramId,
        [milestoneDocumentCatalog[1], milestoneDocumentCatalog[2]],
      );
      expect(result.viewer).toEqual({
        role: 'STAFF',
        myDocumentsCompleted: null,
        myDocumentsTotal: null,
        fullySubmittedParticipantCount: 128,
        milestoneDocuments: [
          {
            milestoneId: currentMilestone.milestoneId,
            title: 'seed-program-overview-milestone-3',
            completed: 12,
            total: 47,
          },
          {
            milestoneId: 'cuid-synthetic-milestone-4',
            title: 'seed-program-overview-milestone-4',
            completed: 0,
            total: 47,
          },
        ],
      });
    });

    it('ADMIN도 교직원과 같은 제출률·분해 경로를 탄다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: 'ADMIN' });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const countFullySubmittedParticipants = jest.fn().mockResolvedValue(10);
      const findMilestoneDocumentCatalog = jest
        .fn()
        .mockResolvedValue(milestoneDocumentCatalog);
      const countFullySubmittedTeamsByMilestone = jest
        .fn()
        .mockResolvedValue(new Map([[currentMilestone.milestoneId, 9]]));
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        countFullySubmittedParticipants,
        findMilestoneDocumentCatalog,
        countFullySubmittedTeamsByMilestone,
        findMilestoneSchedules,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(result.viewer.role).toBe('ADMIN');
      expect(result.viewer.fullySubmittedParticipantCount).toBe(10);
      expect(result.viewer.milestoneDocuments).toEqual([
        {
          milestoneId: currentMilestone.milestoneId,
          title: 'seed-program-overview-milestone-3',
          completed: 9,
          total: 47,
        },
        {
          milestoneId: 'cuid-synthetic-milestone-4',
          title: 'seed-program-overview-milestone-4',
          completed: 0,
          total: 47,
        },
      ]);
    });

    it('역할이 확정되지 않은 뷰어는 viewer 수치가 전부 null/빈 배열이다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: null });
      const findCurrentSubmissionMilestone = jest.fn();
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findMilestoneSchedules,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(findCurrentSubmissionMilestone).not.toHaveBeenCalled();
      expect(result.viewer).toEqual({
        role: null,
        myDocumentsCompleted: null,
        myDocumentsTotal: null,
        fullySubmittedParticipantCount: null,
        milestoneDocuments: [],
      });
    });

    describe('nextMilestone(마감 카운트다운)', () => {
      const now = new Date('2026-08-04T00:00:00.000Z');

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(now);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      /** viewer 계산은 이 describe의 관심사가 아니므로 역할 미확정 뷰어로 고정한다. */
      function repositoryWithSchedules(
        schedules: MilestoneSchedule[],
      ): ProgramOverviewRepository {
        return {
          findByProgramId: jest.fn().mockResolvedValue(baseOverview),
          findViewerIdentity: jest
            .fn()
            .mockResolvedValue({ userId: syntheticUserId, role: null }),
          findMilestoneSchedules: jest.fn().mockResolvedValue(schedules),
        } as unknown as ProgramOverviewRepository;
      }

      it('마감이 지나지 않은 마일스톤 중 정렬 순서와 무관하게 가장 이른 것을 고른다', async () => {
        const farMilestone: MilestoneSchedule = {
          milestoneId: 'm-far',
          label: '늦은 마일스톤',
          dueAt: new Date('2026-09-01T00:00:00.000Z'),
        };
        const nearMilestone: MilestoneSchedule = {
          milestoneId: 'm-near',
          label: '가장 이른 마일스톤',
          dueAt: new Date('2026-08-10T00:00:00.000Z'),
        };
        const service = new ProgramOverviewService(
          repositoryWithSchedules([farMilestone, nearMilestone]),
        );

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result.nextMilestone).toEqual({
          label: nearMilestone.label,
          dueAt: nearMilestone.dueAt,
        });
      });

      it('마감이 지난 마일스톤은 제외한다', async () => {
        const pastMilestone: MilestoneSchedule = {
          milestoneId: 'm-past',
          label: '지난 마일스톤',
          dueAt: new Date('2026-08-01T00:00:00.000Z'),
        };
        const upcomingMilestone: MilestoneSchedule = {
          milestoneId: 'm-upcoming',
          label: '다가오는 마일스톤',
          dueAt: new Date('2026-08-20T00:00:00.000Z'),
        };
        const service = new ProgramOverviewService(
          repositoryWithSchedules([pastMilestone, upcomingMilestone]),
        );

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result.nextMilestone).toEqual({
          label: upcomingMilestone.label,
          dueAt: upcomingMilestone.dueAt,
        });
      });

      it('dueAt이 지금과 정확히 같은 마일스톤도 제외한다(dueAt > now)', async () => {
        const schedules: MilestoneSchedule[] = [
          { milestoneId: 'm-now', label: '지금 마감', dueAt: now },
        ];
        const service = new ProgramOverviewService(
          repositoryWithSchedules(schedules),
        );

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result.nextMilestone).toBeNull();
      });

      it('다가오는 마일스톤이 없으면 null이다', async () => {
        const service = new ProgramOverviewService(repositoryWithSchedules([]));

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result.nextMilestone).toBeNull();
      });
    });
  });

  describe('getPublicTeams', () => {
    it('프로그램이 없으면 POV_001로 거부한다', async () => {
      // Given
      const listPublicTeams = jest.fn();
      const repository = {
        programExists: jest.fn().mockResolvedValue(false),
        listPublicTeams,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When / Then
      await expect(
        service.getPublicTeams(syntheticProgramId),
      ).rejects.toMatchObject({
        errorCode: { code: ProgramOverviewErrorCode.PROGRAM_NOT_FOUND },
      });
      expect(listPublicTeams).not.toHaveBeenCalled();
    });

    it('공개 팀 로스터를 그대로 반환한다', async () => {
      // Given
      const teams: PublicTeamRow[] = [
        {
          teamId: 'cuid-synthetic-team-1',
          name: 'seed-program-overview-team',
          members: [
            {
              userId: 'cuid-synthetic-leader',
              displayName: 'synthetic-leader',
              isLeader: true,
            },
            {
              userId: 'cuid-synthetic-member',
              displayName: 'synthetic-member',
              isLeader: false,
            },
          ],
        },
      ];
      const listPublicTeams = jest.fn().mockResolvedValue(teams);
      const repository = {
        programExists: jest.fn().mockResolvedValue(true),
        listPublicTeams,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getPublicTeams(syntheticProgramId);

      // Then
      expect(listPublicTeams).toHaveBeenCalledWith(syntheticProgramId);
      expect(result).toBe(teams);
    });
  });
});
