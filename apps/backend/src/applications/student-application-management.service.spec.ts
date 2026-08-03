import { ApplicationStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { ApplicationsRepository } from './applications.repository';
import { StudentApplicationManagementRepository } from './student-application-management.repository';
import { StudentApplicationManagementService } from './student-application-management.service';

const NOW = new Date('2026-07-15T00:00:00.000Z');
const OPEN_PROGRAM = {
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  applicationTemplateVersion: 1,
} as const;
const STUDENT = {
  id: 'student-1',
  name: '합성 학생',
  nickname: 'synthetic-student',
} as const;
const APPLICATION = {
  id: 'application-1',
  programId: 'program-1',
  status: ApplicationStatus.SUBMITTED,
  teamId: null,
  applicant: {
    id: 'applicant-1',
    name: '합성 신청자',
    nickname: 'synthetic-applicant',
  },
  answers: {
    applicantName: '합성 학생',
    title: '기존 제목',
    summary: '기존 요약',
  },
  submittedAt: new Date('2026-07-10T00:00:00.000Z'),
  updatedAt: new Date('2026-07-10T00:00:00.000Z'),
  isRepositoryPublicationPlanned: true,
} as const;

function createRepository() {
  const prisma = new PrismaService();
  const repository = new StudentApplicationManagementRepository(prisma);
  const applicationsRepository = new ApplicationsRepository(prisma);
  const findActiveStudentByGithubId = jest
    .spyOn(applicationsRepository, 'findActiveStudentByGithubId')
    .mockResolvedValue(STUDENT);
  const findOwnedApplication = jest
    .spyOn(repository, 'findOwnedApplication')
    .mockResolvedValue(APPLICATION);
  const findProgramPolicy = jest
    .spyOn(applicationsRepository, 'findProgramById')
    .mockResolvedValue({ id: 'program-1', category: 'BASIC', ...OPEN_PROGRAM });
  const updatePendingApplication = jest
    .spyOn(repository, 'updatePendingApplication')
    .mockResolvedValue({
      kind: 'updated',
      application: {
        ...APPLICATION,
        answers: {
          applicantName: '합성 신청자',
          title: '수정 제목',
          summary: '수정 요약',
        },
      },
    });
  const deletePendingApplication = jest
    .spyOn(repository, 'deletePendingApplication')
    .mockResolvedValue({ kind: 'cancelled' });
  return {
    repository,
    applicationsRepository,
    findActiveStudentByGithubId,
    findOwnedApplication,
    findProgramPolicy,
    updatePendingApplication,
    deletePendingApplication,
  };
}
async function expectDomainCode(
  operation: Promise<unknown>,
  code: ApplicationsErrorCode,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected DomainException ${code}`);
  } catch (error: unknown) {
    if (!(error instanceof DomainException)) throw error;
    expect(error.errorCode.code).toBe(code);
  }
}

describe('StudentApplicationManagementService', () => {
  it('신청 기간 내 승인 대기 신청을 조회한다', async () => {
    // Given
    const { repository, applicationsRepository } = createRepository();
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.getMine(4242n, 'program-1', NOW);

    // Then
    expect(result).toEqual({
      id: APPLICATION.id,
      programId: APPLICATION.programId,
      status: APPLICATION.status,
      teamId: APPLICATION.teamId,
      answers: {
        ...APPLICATION.answers,
        applicantName: '합성 신청자',
      },
      submittedAt: APPLICATION.submittedAt,
      updatedAt: APPLICATION.updatedAt,
      isRepositoryPublicationPlanned:
        APPLICATION.isRepositoryPublicationPlanned,
      canEdit: true,
      canCancel: true,
    });
  });

  it('신청 기간 내 승인 대기 신청 내용을 수정한다', async () => {
    // Given
    const { repository, applicationsRepository, updatePendingApplication } =
      createRepository();
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.updateMine(
      4242n,
      'program-1',
      {
        answers: { title: ' 수정 제목 ', summary: ' 수정 요약 ' },
        applicationTemplateVersion: 1,
      },
      NOW,
    );

    // Then
    expect(updatePendingApplication.mock.calls).toEqual([
      [
        {
          programId: 'program-1',
          studentId: 'student-1',
          answers: {
            applicantName: '합성 신청자',
            title: '수정 제목',
            summary: '수정 요약',
          },
          applicationTemplateVersion: 1,
        },
      ],
    ]);
    expect(result.answers.title).toBe('수정 제목');
  });

  it('팀원이 조회하고 수정해도 원 신청자 이름을 유지한다', async () => {
    // Given
    const { repository, applicationsRepository, updatePendingApplication } =
      createRepository();
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const beforeUpdate = await service.getMine(4242n, 'program-1', NOW);
    const afterUpdate = await service.updateMine(
      4242n,
      'program-1',
      {
        answers: { title: '팀원 수정 제목', summary: '팀원 수정 요약' },
        applicationTemplateVersion: 1,
      },
      NOW,
    );

    // Then
    expect(beforeUpdate.answers.applicantName).toBe('합성 신청자');
    expect(updatePendingApplication.mock.calls[0]?.[0].answers).toEqual({
      applicantName: '합성 신청자',
      title: '팀원 수정 제목',
      summary: '팀원 수정 요약',
    });
    expect(afterUpdate.answers.applicantName).toBe('합성 신청자');
  });

  it('승인된 신청은 수정하지 않는다', async () => {
    // Given
    const {
      repository,
      applicationsRepository,
      findOwnedApplication,
      updatePendingApplication,
    } = createRepository();
    findOwnedApplication.mockResolvedValue({
      ...APPLICATION,
      status: ApplicationStatus.APPROVED,
    });
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When / Then
    await expectDomainCode(
      service.updateMine(
        4242n,
        'program-1',
        {
          answers: { title: '수정 제목', summary: '수정 요약' },
          applicationTemplateVersion: 1,
        },
        NOW,
      ),
      ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED,
    );
    expect(updatePendingApplication.mock.calls).toHaveLength(0);
  });

  it('신청 기간 내 승인 대기 신청을 취소한다', async () => {
    // Given
    const { repository, applicationsRepository, deletePendingApplication } =
      createRepository();
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.cancelMine(4242n, 'program-1', NOW);

    // Then
    expect(deletePendingApplication.mock.calls).toEqual([
      [{ programId: 'program-1', studentId: 'student-1' }],
    ]);
    expect(result).toEqual({ cancelled: true });
  });

  it('신청 기간이 끝나면 취소하지 않는다', async () => {
    // Given
    const { repository, applicationsRepository, deletePendingApplication } =
      createRepository();
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When / Then
    await expectDomainCode(
      service.cancelMine(
        4242n,
        'program-1',
        new Date('2026-08-01T00:00:00.000Z'),
      ),
      ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    );
    expect(deletePendingApplication.mock.calls).toHaveLength(0);
  });
  it('uses the repository-resolved applicant name instead of the current actor nickname', async () => {
    // Given
    const {
      repository,
      applicationsRepository,
      findActiveStudentByGithubId,
      findOwnedApplication,
    } = createRepository();
    findActiveStudentByGithubId.mockResolvedValue({
      id: 'student-1',
      name: null,
      nickname: 'current-actor-login',
    });
    findOwnedApplication.mockResolvedValue({
      ...APPLICATION,
      applicant: {
        id: 'applicant-1',
        name: 'Profile Applicant',
        nickname: 'legacy-applicant-login',
      },
      answers: {
        applicantName: 'current-actor-login',
        title: 'Existing title',
        summary: 'Existing summary',
      },
    });
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.getMine(4242n, 'program-1', NOW);

    // Then
    expect(result.answers.applicantName).toBe('Profile Applicant');
  });
});
