import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StaffAccessRequestStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { RoleRequestsController } from './role-requests.controller';
import type { MemberOnboardingService } from './member-onboarding.service';
import { type StaffAccessRequestRecord } from './member-onboarding.repository';

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
  sessionGithubId: 424242n,
};
const REQUESTED_AT = new Date('2026-01-01T00:00:00.000Z');
const DECIDED_AT = new Date('2026-01-02T00:00:00.000Z');

class MissingHandlerMetadataError extends Error {
  constructor(propertyKey: string) {
    super(`Missing handler metadata: ${propertyKey}`);
    this.name = 'MissingHandlerMetadataError';
  }
}

function readGuards(target: object, propertyKey: string): readonly unknown[] {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    target,
    propertyKey,
  )?.value;
  if (typeof handler !== 'function') {
    throw new MissingHandlerMetadataError(propertyKey);
  }
  const metadata: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
  if (!Array.isArray(metadata)) {
    throw new MissingHandlerMetadataError(propertyKey);
  }
  return metadata;
}

function createStaffAccessRequestsController(
  getMyRequest: MemberOnboardingService['getMyRequest'],
  retryStaffRequest: MemberOnboardingService['retryStaffRequest'],
): RoleRequestsController {
  return new RoleRequestsController({ getMyRequest, retryStaffRequest });
}

const rejectedRequest: StaffAccessRequestRecord = {
  id: 'synthetic-request',
  userId: 'synthetic-user',
  status: StaffAccessRequestStatus.REJECTED,
  rejectionReason: '합성 사유',
  decidedAt: DECIDED_AT,
  createdAt: REQUESTED_AT,
};

describe('RoleRequestsController', () => {
  it('요청이 없으면 GET /me에서 NONE 상태와 request null을 반환한다', async () => {
    const controller = createStaffAccessRequestsController(
      jest.fn().mockResolvedValue(null),
      jest.fn(),
    );

    const result = await controller.getMe(REQUEST);

    expect(result).toEqual({ status: 'NONE', request: null });
  });

  it('최근 요청의 상태와 ISO 날짜 응답 계약을 함께 반환한다', async () => {
    const controller = createStaffAccessRequestsController(
      jest.fn().mockResolvedValue(rejectedRequest),
      jest.fn(),
    );

    const result = await controller.getMe(REQUEST);

    expect(result).toEqual({
      status: StaffAccessRequestStatus.REJECTED,
      request: {
        requestedRole: 'STAFF',
        status: StaffAccessRequestStatus.REJECTED,
        requestedAt: REQUESTED_AT.toISOString(),
        decidedAt: DECIDED_AT.toISOString(),
        rejectionReason: '합성 사유',
      },
    });
  });

  it('대기 중인 요청은 PENDING 상태로 반환한다', async () => {
    const controller = createStaffAccessRequestsController(
      jest.fn().mockResolvedValue({
        ...rejectedRequest,
        status: StaffAccessRequestStatus.PENDING,
        decidedAt: null,
        rejectionReason: null,
      }),
      jest.fn(),
    );

    const result = await controller.getMe(REQUEST);

    expect(result).toEqual({
      status: StaffAccessRequestStatus.PENDING,
      request: {
        requestedRole: 'STAFF',
        status: StaffAccessRequestStatus.PENDING,
        requestedAt: REQUESTED_AT.toISOString(),
        decidedAt: null,
        rejectionReason: null,
      },
    });
  });

  it('재요청 결과도 같은 StaffAccessRequest 응답 계약으로 반환한다', async () => {
    const pendingRequest = {
      ...rejectedRequest,
      status: StaffAccessRequestStatus.PENDING,
      rejectionReason: null,
      decidedAt: null,
    };
    const controller = createStaffAccessRequestsController(
      jest.fn(),
      jest.fn().mockResolvedValue(pendingRequest),
    );

    const result = await controller.retry(REQUEST);

    expect(result).toEqual({
      requestedRole: 'STAFF',
      status: StaffAccessRequestStatus.PENDING,
      requestedAt: REQUESTED_AT.toISOString(),
      decidedAt: null,
      rejectionReason: null,
    });
  });

  it('조회는 세션 guard, 재요청은 세션과 Origin guard를 적용한다', () => {
    const target = RoleRequestsController.prototype;

    const getGuards = readGuards(target, 'getMe');
    const postGuards = readGuards(target, 'retry');

    expect(getGuards).toEqual([SessionGuard]);
    expect(postGuards).toEqual([SessionGuard, OriginGuard]);
  });
});
