import { ApplicationStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import {
  StudentApplicationManagementService,
  type StudentApplicationStore,
} from './student-application-management.service';

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
  answers: {
    applicantName: '합성 학생',
    title: '기존 제목',
    summary: '기존 요약',
  },
  submittedAt: new Date('2026-07-10T00:00:00.000Z'),
  updatedAt: new Date('2026-07-10T00:00:00.000Z'),
} as const;

function createStore(): jest.Mocked<StudentApplicationStore> {
  return {
    findActiveStudentByGithubId: jest.fn().mockResolvedValue(STUDENT),
    findOwnedApplication: jest.fn().mockResolvedValue(APPLICATION),
    findProgramPolicy: jest.fn().mockResolvedValue(OPEN_PROGRAM),
    updatePendingApplication: jest.fn().mockResolvedValue({
      ...APPLICATION,
      answers: {
        applicantName: '합성 학생',
        title: '수정 제목',
        summary: '수정 요약',
      },
    }),
    deletePendingApplication: jest.fn().mockResolvedValue(true),
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
    const store = createStore();
    const service = new StudentApplicationManagementService(store);

    // When
    const result = await service.getMine(4242n, 'program-1', NOW);

    // Then
    expect(result).toEqual({
      ...APPLICATION,
      answers: APPLICATION.answers,
      canEdit: true,
      canCancel: true,
    });
  });

  it('신청 기간 내 승인 대기 신청 내용을 수정한다', async () => {
    // Given
    const store = createStore();
    const service = new StudentApplicationManagementService(store);

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
    expect(store.updatePendingApplication.mock.calls).toEqual([
      [
        {
          applicationId: 'application-1',
          answers: {
            applicantName: '합성 학생',
            title: '수정 제목',
            summary: '수정 요약',
          },
          applicationTemplateVersion: 1,
        },
      ],
    ]);
    expect(result.answers.title).toBe('수정 제목');
  });

  it('승인된 신청은 수정하지 않는다', async () => {
    // Given
    const store = createStore();
    store.findOwnedApplication.mockResolvedValue({
      ...APPLICATION,
      status: ApplicationStatus.APPROVED,
    });
    const service = new StudentApplicationManagementService(store);

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
    expect(store.updatePendingApplication.mock.calls).toHaveLength(0);
  });

  it('신청 기간 내 승인 대기 신청을 취소한다', async () => {
    // Given
    const store = createStore();
    const service = new StudentApplicationManagementService(store);

    // When
    const result = await service.cancelMine(4242n, 'program-1', NOW);

    // Then
    expect(store.deletePendingApplication.mock.calls).toEqual([
      ['application-1'],
    ]);
    expect(result).toEqual({ cancelled: true });
  });

  it('신청 기간이 끝나면 취소하지 않는다', async () => {
    // Given
    const store = createStore();
    const service = new StudentApplicationManagementService(store);

    // When / Then
    await expectDomainCode(
      service.cancelMine(
        4242n,
        'program-1',
        new Date('2026-08-01T00:00:00.000Z'),
      ),
      ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    );
    expect(store.deletePendingApplication.mock.calls).toHaveLength(0);
  });
});
