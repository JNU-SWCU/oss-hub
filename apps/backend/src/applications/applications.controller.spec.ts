import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ApplicationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import {
  ApplicationsStaffGuard,
  ApplicationsStaffListGuard,
} from './applications-staff.guard';
import { ApplicationsController } from './applications.controller';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import type { ApplicationsService } from './applications.service';
import type { ApplicationListItem } from './applications.repository';
import { PatchApplicationDecisionRequestDto } from './dto/patch-application-decision-request.dto';

type ControllerService = Pick<ApplicationsService, 'decide' | 'getForStaff'>;

function stubService(overrides: Partial<ControllerService>): ControllerService {
  return {
    decide: jest.fn(),
    getForStaff: jest.fn(),
    ...overrides,
  };
}

function readGuards(
  target: object,
  methodName: 'decide' | 'detail',
): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    target,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('ApplicationsController', () => {
  it('승인 결과를 저장소 프로비저닝 응답으로 변환한다', async () => {
    const decide = jest.fn().mockResolvedValue({
      kind: 'APPROVED',
      applicationId: 'synthetic-application',
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: 'synthetic-event',
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
    });
    const controller = new ApplicationsController(stubService({ decide }));
    const body = Object.assign(new PatchApplicationDecisionRequestDto(), {
      action: 'APPROVE',
    });

    const response = await controller.decide(
      { applicationActorId: 'synthetic-actor', sessionGithubId: 4242n },
      'synthetic-application',
      body,
    );

    expect(decide).toHaveBeenCalledWith(
      'synthetic-actor',
      'synthetic-application',
      4242n,
      expect.anything(),
    );

    expect(response).toEqual({
      applicationId: 'synthetic-application',
      status: ApplicationStatus.APPROVED,
      repositoryProvisioning: {
        enabled: true,
        eventId: 'synthetic-event',
        jobStatus: RepositoryProvisionJobStatus.PENDING,
      },
    });
  });

  it('공백 반려 사유를 APP 오류로 거부한다', () => {
    const body = Object.assign(new PatchApplicationDecisionRequestDto(), {
      action: 'REJECT',
      reason: '   ',
    });

    let thrown: unknown;
    try {
      body.toAction();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainException);
    if (!(thrown instanceof DomainException)) {
      throw new Error('DomainException이 발생해야 합니다.');
    }
    expect(thrown.errorCode.code).toBe(
      ApplicationsErrorCode.REJECTION_REASON_REQUIRED,
    );
  });

  it('PATCH 처리에 세션·STAFF 권한·Origin guard를 적용한다', () => {
    expect(readGuards(ApplicationsController.prototype, 'decide')).toEqual([
      SessionGuard,
      ApplicationsStaffGuard,
      OriginGuard,
    ]);
  });

  it('신청 상세 조회에 세션·STAFF 조회 guard를 적용한다', () => {
    expect(readGuards(ApplicationsController.prototype, 'detail')).toEqual([
      SessionGuard,
      ApplicationsStaffListGuard,
    ]);
  });

  it('신청 상세를 목록 항목과 같은 응답 모양으로 변환한다', async () => {
    const item: ApplicationListItem = {
      id: 'synthetic-application',
      programId: 'synthetic-program',
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
      status: ApplicationStatus.REJECTED,
      submittedAt: new Date('2026-08-05T05:32:00.000Z'),
      rejectionReason: '예산 항목이 비어 있습니다',
      repositoryProvisioning: {
        enabled: false,
        jobStatus: 'DISABLED',
        updatedAt: new Date('2026-08-06T01:00:00.000Z'),
        safeErrorClass: null,
      },
      repository: null,
      isRepositoryPublicationPlanned: true,
      participation: 'TEAM',
      applicant: {
        id: 'synthetic-applicant',
        name: '신청자',
        nickname: 'applicant',
      },
      team: { id: 'synthetic-team', name: '팀', memberCount: 3 },
      answers: { applicantName: '신청자', title: '제목', summary: '요약' },
    };
    const getForStaff = jest
      .fn()
      .mockResolvedValue({ application: item, reviewHistory: [] });
    const controller = new ApplicationsController(stubService({ getForStaff }));

    const response = await controller.detail('synthetic-application');

    expect(getForStaff).toHaveBeenCalledWith('synthetic-application');
    expect(response.submittedAt).toBe('2026-08-05T05:32:00.000Z');
    expect(response.repositoryProvisioning.updatedAt).toBe(
      '2026-08-06T01:00:00.000Z',
    );
    expect(response.rejectionReason).toBe('예산 항목이 비어 있습니다');
    expect(response.answers).toEqual({
      applicantName: '신청자',
      title: '제목',
      summary: '요약',
    });
  });

  it('없는 신청의 상세 조회 오류를 그대로 올려보낸다', async () => {
    const getForStaff = jest
      .fn()
      .mockRejectedValue(
        new DomainException(
          APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.APPLICATION_NOT_FOUND],
        ),
      );
    const controller = new ApplicationsController(stubService({ getForStaff }));

    let thrown: unknown;
    try {
      await controller.detail('missing-application');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainException);
    if (!(thrown instanceof DomainException)) {
      throw new Error('DomainException이 발생해야 합니다.');
    }
    expect(thrown.errorCode.code).toBe(
      ApplicationsErrorCode.APPLICATION_NOT_FOUND,
    );
  });
});
