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
// 기본 행위자(STUDENT)는 신청자가 아니라 **지금의 팀장**이다 — 신청을 낸 사람이 떠나고
// 승계로 팀장이 된 팀의 모습이다. 관리 권한은 `applicantId`가 아니라 현재 팀장에서
// 나온다는 것을 기본값으로 고정한다(#1083).
const APPLICATION = {
  id: 'application-1',
  programId: 'program-1',
  status: ApplicationStatus.SUBMITTED,
  teamId: 'team-1',
  teamLeaderId: STUDENT.id,
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
  rejectionReason: null,
} as const;

function createRepository() {
  const prisma = new PrismaService();
  const repository = new StudentApplicationManagementRepository(prisma);
  const applicationsRepository = new ApplicationsRepository(prisma, {
    TEAM_JOIN_CODE_SECRET: 'synthetic-student-mgmt-secret',
  });
  const findActiveStudentByGithubId = jest
    .spyOn(applicationsRepository, 'findActiveStudentByGithubId')
    .mockResolvedValue(STUDENT);
  const findOwnedApplication = jest
    .spyOn(repository, 'findOwnedApplication')
    .mockResolvedValue(APPLICATION);
  const findProgramPolicy = jest
    .spyOn(applicationsRepository, 'findProgramById')
    .mockResolvedValue({
      id: 'program-1',
      name: '합성 프로그램',
      category: 'BASIC',
      repositoryProvisioningEnabled: false,
      ...OPEN_PROGRAM,
    });
  const updatePendingApplication = jest
    .spyOn(repository, 'updatePendingApplication')
    .mockResolvedValue({
      kind: 'updated',
      application: {
        ...APPLICATION,
        answers: {
          applicantName: '합성 신청자',
          title: '수정 제목',
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
        applicantName: '합성 신청자',
        title: '기존 제목',
      },
      submittedAt: APPLICATION.submittedAt,
      updatedAt: APPLICATION.updatedAt,
      isRepositoryPublicationPlanned:
        APPLICATION.isRepositoryPublicationPlanned,
      rejectionReason: null,
      isManager: true,
      canManage: true,
    });
  });

  /**
   * 반려 사유가 학생에게 닿는 유일한 경로다(#722).
   *
   * 사유는 `Application.rejectionReason`에만 있고 알림·감사 로그·메일에는 담지
   * 않는다(`audit-log/audit-log-metadata.ts`). 이 조회가 빠뜨리면 학생은 왜
   * 반려됐는지 어디서도 알 수 없다.
   */
  it('반려된 신청은 사유를 함께 돌려준다', async () => {
    // Given
    const { repository, applicationsRepository, findOwnedApplication } =
      createRepository();
    findOwnedApplication.mockResolvedValue({
      ...APPLICATION,
      status: ApplicationStatus.REJECTED,
      rejectionReason: '합성 반려 사유',
    });
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.getMine(4242n, 'program-1', NOW);

    // Then
    expect(result.rejectionReason).toBe('합성 반려 사유');
    expect(result.status).toBe(ApplicationStatus.REJECTED);
  });

  /**
   * 반려가 아닌 신청에도 **키는 있고 값이 `null`이다.**
   * 반려일 때만 키를 실으면 클라이언트에서 "없는 키"와 "null"이 다르게 읽힌다.
   */
  it.each([ApplicationStatus.APPROVED, ApplicationStatus.SUBMITTED] as const)(
    '%s 신청의 사유는 키를 지우지 않고 null로 싣는다',
    async (status) => {
      // Given
      const { repository, applicationsRepository, findOwnedApplication } =
        createRepository();
      findOwnedApplication.mockResolvedValue({ ...APPLICATION, status });
      const service = new StudentApplicationManagementService(
        repository,
        applicationsRepository,
      );

      // When
      const result = await service.getMine(4242n, 'program-1', NOW);

      // Then
      expect(result).toHaveProperty('rejectionReason');
      expect(result.rejectionReason).toBeNull();
    },
  );

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
        answers: { title: ' 수정 제목 ' },
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
          },
          applicationTemplateVersion: 1,
        },
      ],
    ]);
    expect(result.answers.title).toBe('수정 제목');
  });

  it('팀장이 조회하고 수정해도 원 신청자 이름을 유지한다', async () => {
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
        answers: { title: '팀원 수정 제목' },
        applicationTemplateVersion: 1,
      },
      NOW,
    );

    // Then
    expect(beforeUpdate.answers.applicantName).toBe('합성 신청자');
    expect(updatePendingApplication.mock.calls[0]?.[0].answers).toEqual({
      applicantName: '합성 신청자',
      title: '팀원 수정 제목',
    });
    expect(afterUpdate.answers.applicantName).toBe('합성 신청자');
  });

  /**
   * 팀 신청서의 수정·취소는 **지금의 팀장**만 한다(#1083). 그 전에는 읽기 범위를
   * 그대로 써서 팀원 아무나 팀 전체의 신청을 하드 삭제할 수 있었다.
   * 거절 코드는 repository가 돌려주는 실패와 같은 APP_001로 맞춘다.
   */
  it.each(['update', 'cancel'] as const)(
    '팀장이 아닌 팀원의 %s 요청을 거절한다',
    async (operation) => {
      // Given
      const {
        repository,
        applicationsRepository,
        findOwnedApplication,
        updatePendingApplication,
        deletePendingApplication,
      } = createRepository();
      findOwnedApplication.mockResolvedValue({
        ...APPLICATION,
        teamLeaderId: 'team-leader-1',
      });
      const service = new StudentApplicationManagementService(
        repository,
        applicationsRepository,
      );

      // When / Then
      await expectDomainCode(
        operation === 'update'
          ? service.updateMine(
              4242n,
              'program-1',
              {
                answers: { title: '팀원 수정 제목' },
                applicationTemplateVersion: 1,
              },
              NOW,
            )
          : service.cancelMine(4242n, 'program-1', NOW),
        ApplicationsErrorCode.APPLICATION_NOT_FOUND,
      );
      expect(updatePendingApplication.mock.calls).toHaveLength(0);
      expect(deletePendingApplication.mock.calls).toHaveLength(0);
    },
  );

  /**
   * 읽기는 좁히지 않는다 — 판정 사유·답변은 팀원 전원이 읽는다(#570). 화면이
   * 「신청 취소」·「수정 내용 저장」을 감출 근거는 `canManage`뿐이라 여기서 내려간다.
   */
  it('팀원의 조회는 열어 두되 canManage를 내린다', async () => {
    // Given
    const { repository, applicationsRepository, findOwnedApplication } =
      createRepository();
    findOwnedApplication.mockResolvedValue({
      ...APPLICATION,
      teamLeaderId: 'team-leader-1',
      rejectionReason: null,
    });
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.getMine(4242n, 'program-1', NOW);

    // Then
    expect(result.answers.title).toBe('기존 제목');
    expect(result.isManager).toBe(false);
    expect(result.canManage).toBe(false);
  });

  /**
   * 신청을 낸 사람이라는 것은 권한이 아니다. 신청 뒤 팀장을 넘기고 팀원으로 남은 사람은
   * 읽기만 유지하고 팀 전체의 신청을 되돌릴 수 없게 지우지 못한다.
   */
  it.each(['update', 'cancel'] as const)(
    '팀장이 아닌 원 신청자의 %s 요청을 거절한다',
    async (operation) => {
      // Given
      const {
        repository,
        applicationsRepository,
        findOwnedApplication,
        updatePendingApplication,
        deletePendingApplication,
      } = createRepository();
      findOwnedApplication.mockResolvedValue({
        ...APPLICATION,
        teamLeaderId: 'successor-leader-1',
        applicant: { ...APPLICATION.applicant, id: STUDENT.id },
      });
      const service = new StudentApplicationManagementService(
        repository,
        applicationsRepository,
      );

      // When / Then
      await expectDomainCode(
        operation === 'update'
          ? service.updateMine(
              4242n,
              'program-1',
              {
                answers: { title: '원 신청자 수정 제목' },
                applicationTemplateVersion: 1,
              },
              NOW,
            )
          : service.cancelMine(4242n, 'program-1', NOW),
        ApplicationsErrorCode.APPLICATION_NOT_FOUND,
      );
      expect(updatePendingApplication.mock.calls).toHaveLength(0);
      expect(deletePendingApplication.mock.calls).toHaveLength(0);
    },
  );

  /** 원 신청자여도 팀원으로 남아 있는 동안은 읽기가 열려 있다. */
  it('팀장이 아닌 원 신청자의 조회는 열어 두되 isManager를 내린다', async () => {
    // Given
    const { repository, applicationsRepository, findOwnedApplication } =
      createRepository();
    findOwnedApplication.mockResolvedValue({
      ...APPLICATION,
      teamLeaderId: 'successor-leader-1',
      applicant: { ...APPLICATION.applicant, id: STUDENT.id },
    });
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.getMine(4242n, 'program-1', NOW);

    // Then
    expect(result.isManager).toBe(false);
    expect(result.canManage).toBe(false);
  });

  /**
   * 팀을 떠난 사람은 원 신청자였더라도 **읽기도** 못 한다 — repository가 현재 멤버십으로
   * 좁혀 `null`을 돌려주고, 세 표면 모두 같은 APP_001로 닫힌다.
   */
  it.each(['get', 'update', 'cancel'] as const)(
    '팀을 떠난 원 신청자의 %s 요청을 거절한다',
    async (operation) => {
      // Given
      const {
        repository,
        applicationsRepository,
        findOwnedApplication,
        updatePendingApplication,
        deletePendingApplication,
      } = createRepository();
      findOwnedApplication.mockResolvedValue(null);
      const service = new StudentApplicationManagementService(
        repository,
        applicationsRepository,
      );

      // When / Then
      const operations = {
        get: () => service.getMine(4242n, 'program-1', NOW),
        update: () =>
          service.updateMine(
            4242n,
            'program-1',
            {
              answers: { title: '떠난 사람의 수정' },
              applicationTemplateVersion: 1,
            },
            NOW,
          ),
        cancel: () => service.cancelMine(4242n, 'program-1', NOW),
      };
      await expectDomainCode(
        operations[operation](),
        ApplicationsErrorCode.APPLICATION_NOT_FOUND,
      );
      expect(updatePendingApplication.mock.calls).toHaveLength(0);
      expect(deletePendingApplication.mock.calls).toHaveLength(0);
    },
  );

  /**
   * 승계로 팀장이 된 사람은 신청자가 아니어도 관리한다 — 단, 기간·상태 창은 그대로다.
   * 권한과 창을 갈라 두어야 화면이 「기간이 지났다」와 「당신 권한이 아니다」를 갈라 말한다.
   */
  it('승계된 팀장은 기간 밖에서도 isManager를 유지하고 canManage만 내린다', async () => {
    // Given — 행위자는 신청자가 아니고 지금 팀장이다(APPLICATION 기본값).
    const { repository, applicationsRepository } = createRepository();
    const service = new StudentApplicationManagementService(
      repository,
      applicationsRepository,
    );

    // When
    const result = await service.getMine(
      4242n,
      'program-1',
      new Date('2026-08-01T00:00:00.000Z'),
    );

    // Then
    expect(result.isManager).toBe(true);
    expect(result.canManage).toBe(false);
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
          answers: { title: '수정 제목' },
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
