import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ApplicationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { ApplicationsStaffGuard } from './applications-staff.guard';
import { ApplicationsController } from './applications.controller';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import type { ApplicationsService } from './applications.service';
import { PatchApplicationDecisionDto } from './dto/patch-application-decision.dto';

function readGuards(target: object, methodName: 'decide'): unknown[] {
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
    // Given
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
    const service: Pick<ApplicationsService, 'decide'> = { decide };
    const controller = new ApplicationsController(service);
    const body = Object.assign(new PatchApplicationDecisionDto(), {
      action: 'APPROVE',
    });

    // When
    const response = await controller.decide(
      { applicationActorId: 'synthetic-actor' },
      'synthetic-application',
      body,
    );

    // Then
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
    // Given
    const body = Object.assign(new PatchApplicationDecisionDto(), {
      action: 'REJECT',
      reason: '   ',
    });

    // When
    let thrown: unknown;
    try {
      body.toAction();
    } catch (error) {
      thrown = error;
    }

    // Then
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
});
