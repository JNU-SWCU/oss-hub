import { ProgramOverviewErrorCode } from './program-overview-error-code.error';
import {
  CurrentSubmissionMilestone,
  MilestoneDocumentCatalogEntry,
  MilestoneSchedule,
  ProgramOverviewRepository,
  ProgramOverviewRecord,
  PublicTeamRow,
} from './program-overview.repository';
import { ProgramOverviewService } from './program-overview.service';
import { UserProfileService } from '../users/user-profile.service';

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

function completionRows(
  teams: readonly {
    readonly members: number;
    readonly submitted: readonly string[];
  }[],
) {
  return {
    findProgramApplications: jest.fn().mockResolvedValue(
      teams.map((_, index) => ({
        id: `app-${index}`,
        teamId: `team-${index}`,
      })),
    ),
    findSubmittedDocumentPairs: jest.fn(
      (_applicationIds: readonly string[], documentIds: readonly string[]) =>
        Promise.resolve(
          teams.flatMap((team, index) =>
            team.submitted
              .filter((documentId) => documentIds.includes(documentId))
              .map((documentId) => ({
                applicationId: `app-${index}`,
                milestoneDocumentId: documentId,
              })),
          ),
        ),
    ),
    countTeamMembers: jest
      .fn()
      .mockResolvedValue(
        new Map(teams.map((team, index) => [`team-${index}`, team.members])),
      ),
  };
}

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
    it.each([false, true])(
      '학생 운영자의 참여 프로그램 개요는 학생 통계를 기본으로 하고 운영 전환=%s를 따른다',
      async (operationsView) => {
        const repository = {
          findByProgramId: jest.fn().mockResolvedValue(baseOverview),
          findViewerIdentity: jest.fn().mockResolvedValue({
            userId: syntheticUserId,
            hasAdminAccess: true,
            hasStaffAccess: false,
            memberKind: 'STUDENT',
          }),
          findApprovedViewerApplicationId: jest
            .fn()
            .mockResolvedValue(syntheticApplicationId),
          findCurrentSubmissionMilestone: jest
            .fn()
            .mockResolvedValue(currentMilestone),
          findViewerApplicationId: jest
            .fn()
            .mockResolvedValue(syntheticApplicationId),
          findMilestoneDocumentCatalog: jest
            .fn()
            .mockResolvedValue(milestoneDocumentCatalog),
          findSubmittedDocumentIds: jest
            .fn()
            .mockResolvedValue(new Set(['doc-1'])),
          ...completionRows([]),
          findMilestoneSchedules: jest.fn().mockResolvedValue([]),
        } as unknown as ProgramOverviewRepository;
        const result = await new ProgramOverviewService(
          repository,
          new UserProfileService(),
        ).getOverview(syntheticProgramId, syntheticGithubId, operationsView);
        expect(result.viewer.role).toBe(operationsView ? 'ADMIN' : 'STUDENT');
        expect(result.viewer.myDocumentsCompleted).toBe(
          operationsView ? null : 1,
        );
      },
    );

    it('프로그램이 없으면 POV_001로 거부한다', async () => {
      const repository = {
        findByProgramId: jest.fn().mockResolvedValue(null),
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      await expect(
        service.getOverview(syntheticProgramId, syntheticGithubId),
      ).rejects.toMatchObject({
        errorCode: { code: ProgramOverviewErrorCode.PROGRAM_NOT_FOUND },
      });
    });

    it('학생이면서 서류 걸린 마일스톤이 있으면 프로그램 전체 내 제출 N/M과 마일스톤별 분해를 채운다', async () => {
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest.fn().mockResolvedValue({
        userId: syntheticUserId,
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: false,
      });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const findViewerApplicationId = jest
        .fn()
        .mockResolvedValue(syntheticApplicationId);
      const findMilestoneDocumentCatalog = jest
        .fn()
        .mockResolvedValue(milestoneDocumentCatalog);

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
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

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
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest.fn().mockResolvedValue({
        userId: syntheticUserId,
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: false,
      });
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
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

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
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest.fn().mockResolvedValue({
        userId: syntheticUserId,
        memberKind: 'STUDENT',
        hasStaffAccess: false,
        hasAdminAccess: false,
      });
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
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

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
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest.fn().mockResolvedValue({
        userId: syntheticUserId,
        memberKind: 'STAFF',
        hasStaffAccess: true,
        hasAdminAccess: false,
      });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const completion = completionRows([
        ...Array.from({ length: 11 }, () => ({
          members: 10,
          submitted: ['doc-1', 'doc-2'],
        })),
        { members: 18, submitted: ['doc-1', 'doc-2'] },
      ]);
      const findMilestoneDocumentCatalog = jest
        .fn()
        .mockResolvedValue(milestoneDocumentCatalog);
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findMilestoneDocumentCatalog,
        findMilestoneSchedules,
        ...completion,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      expect(completion.findSubmittedDocumentPairs).toHaveBeenCalledWith(
        expect.any(Array),
        currentMilestone.requiredDocumentIds,
      );
      expect(completion.findSubmittedDocumentPairs).toHaveBeenCalledWith(
        expect.any(Array),
        ['doc-1', 'doc-2', 'doc-4', 'doc-5'],
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
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest.fn().mockResolvedValue({
        userId: syntheticUserId,
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: true,
      });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const completion = completionRows([
        ...Array.from({ length: 8 }, () => ({
          members: 1,
          submitted: ['doc-1', 'doc-2'],
        })),
        { members: 2, submitted: ['doc-1', 'doc-2'] },
      ]);
      const findMilestoneDocumentCatalog = jest
        .fn()
        .mockResolvedValue(milestoneDocumentCatalog);
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findMilestoneDocumentCatalog,
        findMilestoneSchedules,
        ...completion,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

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
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest.fn().mockResolvedValue({
        userId: syntheticUserId,
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
      });
      const findCurrentSubmissionMilestone = jest.fn();
      const findMilestoneSchedules = jest.fn().mockResolvedValue([]);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findMilestoneSchedules,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      expect(findCurrentSubmissionMilestone).not.toHaveBeenCalled();
      expect(result.viewer).toEqual({
        role: null,
        myDocumentsCompleted: null,
        myDocumentsTotal: null,
        fullySubmittedParticipantCount: null,
        milestoneDocuments: [],
      });
    });

    describe('remainingMilestones(마감 카운트다운)', () => {
      const now = new Date('2026-08-04T00:00:00.000Z');

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(now);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      function repositoryWithSchedules(
        schedules: MilestoneSchedule[],
      ): ProgramOverviewRepository {
        return {
          findByProgramId: jest.fn().mockResolvedValue(baseOverview),
          findViewerIdentity: jest.fn().mockResolvedValue({
            userId: syntheticUserId,
            memberKind: null,
            hasStaffAccess: false,
            hasAdminAccess: false,
          }),
          findMilestoneSchedules: jest.fn().mockResolvedValue(schedules),
        } as unknown as ProgramOverviewRepository;
      }

      it('마감이 지나지 않은 마일스톤을 입력 순서와 무관하게 dueAt 오름차순으로 모두 반환한다', async () => {
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
          new UserProfileService(),
        );

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result).toEqual(
          expect.objectContaining({
            remainingMilestones: [
              { label: nearMilestone.label, dueAt: nearMilestone.dueAt },
              { label: farMilestone.label, dueAt: farMilestone.dueAt },
            ],
          }),
        );
        expect(result).not.toHaveProperty('nextMilestone');
      });

      it('마감이 지난 마일스톤과 지금 정확히 마감인 마일스톤은 제외한다', async () => {
        const pastMilestone: MilestoneSchedule = {
          milestoneId: 'm-past',
          label: '지난 마일스톤',
          dueAt: new Date('2026-08-01T00:00:00.000Z'),
        };
        const exactNowMilestone: MilestoneSchedule = {
          milestoneId: 'm-now',
          label: '지금 마감',
          dueAt: now,
        };
        const upcomingMilestone: MilestoneSchedule = {
          milestoneId: 'm-upcoming',
          label: '다가오는 마일스톤',
          dueAt: new Date('2026-08-20T00:00:00.000Z'),
        };
        const service = new ProgramOverviewService(
          repositoryWithSchedules([
            pastMilestone,
            exactNowMilestone,
            upcomingMilestone,
          ]),
          new UserProfileService(),
        );

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result).toEqual(
          expect.objectContaining({
            remainingMilestones: [
              {
                label: upcomingMilestone.label,
                dueAt: upcomingMilestone.dueAt,
              },
            ],
          }),
        );
      });

      it('동일 dueAt 마일스톤의 입력 순서를 보존하고 원본 배열을 정렬하지 않는다', async () => {
        const firstMilestone: MilestoneSchedule = {
          milestoneId: 'm-first',
          label: '동일 마감 A',
          dueAt: new Date('2026-08-20T00:00:00.000Z'),
        };
        const secondMilestone: MilestoneSchedule = {
          milestoneId: 'm-second',
          label: '동일 마감 B',
          dueAt: new Date('2026-08-20T00:00:00.000Z'),
        };
        const earlierMilestone: MilestoneSchedule = {
          milestoneId: 'm-earlier',
          label: '더 이른 마감',
          dueAt: new Date('2026-08-10T00:00:00.000Z'),
        };
        const schedules = [firstMilestone, secondMilestone, earlierMilestone];
        const service = new ProgramOverviewService(
          repositoryWithSchedules(schedules),
          new UserProfileService(),
        );

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result).toEqual(
          expect.objectContaining({
            remainingMilestones: [
              { label: earlierMilestone.label, dueAt: earlierMilestone.dueAt },
              { label: firstMilestone.label, dueAt: firstMilestone.dueAt },
              { label: secondMilestone.label, dueAt: secondMilestone.dueAt },
            ],
          }),
        );
        expect(schedules).toEqual([
          firstMilestone,
          secondMilestone,
          earlierMilestone,
        ]);
      });

      it('다가오는 마일스톤이 없으면 빈 배열이다', async () => {
        const service = new ProgramOverviewService(
          repositoryWithSchedules([]),
          new UserProfileService(),
        );

        const result = await service.getOverview(
          syntheticProgramId,
          syntheticGithubId,
        );

        expect(result).toEqual(
          expect.objectContaining({ remainingMilestones: [] }),
        );
      });
    });
  });

  describe('getPublicTeams', () => {
    it('프로그램이 없으면 POV_001로 거부한다', async () => {
      const listPublicTeams = jest.fn();
      const repository = {
        programExists: jest.fn().mockResolvedValue(false),
        listPublicTeams,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      await expect(
        service.getPublicTeams(syntheticProgramId),
      ).rejects.toMatchObject({
        errorCode: { code: ProgramOverviewErrorCode.PROGRAM_NOT_FOUND },
      });
      expect(listPublicTeams).not.toHaveBeenCalled();
    });

    it('공개 팀 로스터를 그대로 반환한다', async () => {
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
      const service = new ProgramOverviewService(
        repository,
        new UserProfileService(),
      );

      const result = await service.getPublicTeams(syntheticProgramId);

      expect(listPublicTeams).toHaveBeenCalledWith(syntheticProgramId);
      expect(result).toBe(teams);
    });
  });
});
