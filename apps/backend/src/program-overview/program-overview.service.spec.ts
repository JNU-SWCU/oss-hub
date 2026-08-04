import { Role } from '@prisma/client';
import { ProgramOverviewErrorCode } from './program-overview-error-code.enum';
import {
  CurrentSubmissionMilestone,
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
  category: 'CAPSTONE',
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

    it('학생이면서 서류 걸린 마일스톤이 있으면 내 제출 N/M을 채운다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: Role.STUDENT });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const findViewerApplicationId = jest
        .fn()
        .mockResolvedValue(syntheticApplicationId);
      const countSubmittedDocuments = jest.fn().mockResolvedValue(2);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findViewerApplicationId,
        countSubmittedDocuments,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(countSubmittedDocuments).toHaveBeenCalledWith(
        syntheticApplicationId,
        currentMilestone.documentIds,
      );
      expect(result.viewer).toEqual({
        role: Role.STUDENT,
        myDocumentsCompleted: 2,
        myDocumentsTotal: 3,
        fullySubmittedParticipantCount: null,
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
        .mockResolvedValue({ userId: syntheticUserId, role: Role.STUDENT });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const findViewerApplicationId = jest.fn().mockResolvedValue(null);
      const countSubmittedDocuments = jest.fn().mockResolvedValue(0);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findViewerApplicationId,
        countSubmittedDocuments,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(countSubmittedDocuments).not.toHaveBeenCalled();
      expect(result.viewer).toEqual({
        role: Role.STUDENT,
        myDocumentsCompleted: 0,
        myDocumentsTotal: 3,
        fullySubmittedParticipantCount: null,
      });
    });

    it('서류 걸린 마일스톤이 하나도 없으면 학생 viewer 수치는 전부 null이다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: Role.STUDENT });
      const findCurrentSubmissionMilestone = jest.fn().mockResolvedValue(null);
      const findViewerApplicationId = jest.fn();
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        findViewerApplicationId,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(findViewerApplicationId).not.toHaveBeenCalled();
      expect(result.viewer).toEqual({
        role: Role.STUDENT,
        myDocumentsCompleted: null,
        myDocumentsTotal: null,
        fullySubmittedParticipantCount: null,
      });
    });

    it('교직원이면 제출률 분자(fullySubmittedParticipantCount)를 채운다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: Role.STAFF });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const countFullySubmittedParticipants = jest.fn().mockResolvedValue(128);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        countFullySubmittedParticipants,
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
      expect(result.viewer).toEqual({
        role: Role.STAFF,
        myDocumentsCompleted: null,
        myDocumentsTotal: null,
        fullySubmittedParticipantCount: 128,
      });
    });

    it('ADMIN도 교직원과 같은 제출률 경로를 탄다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: Role.ADMIN });
      const findCurrentSubmissionMilestone = jest
        .fn()
        .mockResolvedValue(currentMilestone);
      const countFullySubmittedParticipants = jest.fn().mockResolvedValue(10);
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
        countFullySubmittedParticipants,
      } as unknown as ProgramOverviewRepository;
      const service = new ProgramOverviewService(repository);

      // When
      const result = await service.getOverview(
        syntheticProgramId,
        syntheticGithubId,
      );

      // Then
      expect(result.viewer.role).toBe(Role.ADMIN);
      expect(result.viewer.fullySubmittedParticipantCount).toBe(10);
    });

    it('역할이 확정되지 않은 뷰어는 viewer 수치가 전부 null이다', async () => {
      // Given
      const findByProgramId = jest.fn().mockResolvedValue(baseOverview);
      const findViewerIdentity = jest
        .fn()
        .mockResolvedValue({ userId: syntheticUserId, role: null });
      const findCurrentSubmissionMilestone = jest.fn();
      const repository = {
        findByProgramId,
        findViewerIdentity,
        findCurrentSubmissionMilestone,
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
