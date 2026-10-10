import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { StaffAccessRequestStatus } from '@prisma/client';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { DomainException } from '../../common/error-code';
import type { StaffAccessRequestRecord } from '../../users/domain/member-onboarding';
import { SelectStaffAccessRequestDto } from '../dto/select-role-request.dto';
import {
  OnboardingController,
  StaffAccessRequestsController,
} from './roles.controller';
import { RolesErrorCode } from '../../users/domain/roles-error-code.enum';
import type { RolesService } from '../service/roles.service';

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

function createOnboardingController(
  selectMemberKind: RolesService['selectMemberKind'],
  getMySelection: RolesService['getMySelection'] = () =>
    Promise.resolve({ selectedMemberKind: null }),
): OnboardingController {
  return new OnboardingController({ selectMemberKind, getMySelection });
}

function createStaffAccessRequestsController(
  getMyRequest: RolesService['getMyRequest'],
  retryStaffRequest: RolesService['retryStaffRequest'],
): StaffAccessRequestsController {
  return new StaffAccessRequestsController({ getMyRequest, retryStaffRequest });
}

const rejectedRequest: StaffAccessRequestRecord = {
  id: 'synthetic-request',
  userId: 'synthetic-user',
  status: StaffAccessRequestStatus.REJECTED,
  rejectionReason: '합성 사유',
  decidedAt: DECIDED_AT,
  createdAt: REQUESTED_AT,
};

describe('OnboardingController', () => {
  it('역할 선택 결과를 응답 계약으로 반환한다', async () => {
    const selectMemberKind = jest.fn().mockResolvedValue({
      selectedMemberKind: 'STUDENT',
      redirectTo: '/onboarding/profile',
    });
    const controller = createOnboardingController(selectMemberKind);
    const body = plainToInstance(SelectStaffAccessRequestDto, {
      selectedRole: 'STUDENT',
    });

    const result = await controller.selectRole(REQUEST, body);

    expect(result).toEqual({
      selectedRole: 'STUDENT',
      redirectTo: '/onboarding/profile',
    });
    expect(selectMemberKind).toHaveBeenCalledWith(424242n, 'STUDENT');
  });

  it('지금 고른 역할을 응답 계약으로 반환한다', async () => {
    const getMySelection = jest
      .fn()
      .mockResolvedValue({ selectedMemberKind: 'STAFF' });
    const controller = createOnboardingController(jest.fn(), getMySelection);

    const result = await controller.getMySelection(REQUEST);

    expect(result).toEqual({ selectedRole: 'STAFF' });
    expect(getMySelection).toHaveBeenCalledWith(424242n);
  });

  it('STUDENT와 STAFF가 아닌 역할 선택은 ROL_001로 거부한다', () => {
    const body = plainToInstance(SelectStaffAccessRequestDto, {
      selectedRole: 'ADMIN',
    });

    let caught: unknown;
    try {
      body.toMemberKind();
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainException);
    if (!(caught instanceof DomainException)) {
      throw caught;
    }
    expect(caught.errorCode.code).toBe(RolesErrorCode.INVALID_ROLE_SELECTION);
  });

  it('쓰기 endpoint에 세션과 Origin guard를 적용한다', () => {
    const target = OnboardingController.prototype;

    const guards = readGuards(target, 'selectRole');

    expect(guards).toEqual([SessionGuard, OriginGuard]);
  });
});

describe('StaffAccessRequestsController', () => {
  it('요청이 없으면 GET /me에서 200 본문 null 계약을 반환한다', async () => {
    const controller = createStaffAccessRequestsController(
      jest.fn().mockResolvedValue(null),
      jest.fn(),
    );

    const result = await controller.getMe(REQUEST);

    expect(result).toBeNull();
  });

  it('최근 요청을 ISO 날짜 응답 계약으로 반환한다', async () => {
    const controller = createStaffAccessRequestsController(
      jest.fn().mockResolvedValue(rejectedRequest),
      jest.fn(),
    );

    const result = await controller.getMe(REQUEST);

    expect(result).toEqual({
      requestedRole: 'STAFF',
      status: StaffAccessRequestStatus.REJECTED,
      requestedAt: REQUESTED_AT.toISOString(),
      decidedAt: DECIDED_AT.toISOString(),
      rejectionReason: '합성 사유',
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
    const target = StaffAccessRequestsController.prototype;

    const getGuards = readGuards(target, 'getMe');
    const postGuards = readGuards(target, 'retry');

    expect(getGuards).toEqual([SessionGuard]);
    expect(postGuards).toEqual([SessionGuard, OriginGuard]);
  });
});
