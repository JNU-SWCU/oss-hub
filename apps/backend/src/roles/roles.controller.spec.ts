import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { Role, RoleRequestStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import type { RoleRequestRecord } from './domain/role-onboarding';
import { SelectRoleRequestDto } from './dto/select-role-request.dto';
import {
  OnboardingController,
  RoleRequestsController,
} from './roles.controller';
import { RolesErrorCode } from './roles-error-code.enum';
import type { RolesService } from './roles.service';

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
  selectRole: RolesService['selectRole'],
): OnboardingController {
  return new OnboardingController({ selectRole });
}

function createRoleRequestsController(
  getMyRequest: RolesService['getMyRequest'],
  retryStaffRequest: RolesService['retryStaffRequest'],
): RoleRequestsController {
  return new RoleRequestsController({ getMyRequest, retryStaffRequest });
}

const rejectedRequest: RoleRequestRecord = {
  id: 'synthetic-request',
  userId: 'synthetic-user',
  status: RoleRequestStatus.REJECTED,
  rejectionReason: '합성 사유',
  decidedAt: DECIDED_AT,
  createdAt: REQUESTED_AT,
};

describe('OnboardingController', () => {
  it('역할 선택 결과를 응답 계약으로 반환한다', async () => {
    // Given
    const selectRole = jest.fn().mockResolvedValue({
      selectedRole: Role.STUDENT,
      role: Role.STUDENT,
      requestStatus: null,
      redirectTo: '/programs',
    });
    const controller = createOnboardingController(selectRole);
    const body = plainToInstance(SelectRoleRequestDto, {
      selectedRole: Role.STUDENT,
    });

    // When
    const result = await controller.selectRole(REQUEST, body);

    // Then
    expect(result).toEqual({
      selectedRole: Role.STUDENT,
      role: Role.STUDENT,
      requestStatus: null,
      redirectTo: '/programs',
    });
    expect(selectRole).toHaveBeenCalledWith(424242n, Role.STUDENT);
  });

  it('STUDENT와 STAFF가 아닌 역할 선택은 ROL_001로 거부한다', () => {
    // Given
    const body = plainToInstance(SelectRoleRequestDto, {
      selectedRole: Role.ADMIN,
    });

    // When
    let caught: unknown;
    try {
      body.toRole();
    } catch (error: unknown) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(DomainException);
    if (!(caught instanceof DomainException)) {
      throw caught;
    }
    expect(caught.errorCode.code).toBe(RolesErrorCode.INVALID_ROLE_SELECTION);
  });

  it('쓰기 endpoint에 세션과 Origin guard를 적용한다', () => {
    // Given
    const target = OnboardingController.prototype;

    // When
    const guards = readGuards(target, 'selectRole');

    // Then
    expect(guards).toEqual([SessionGuard, OriginGuard]);
  });
});

describe('RoleRequestsController', () => {
  it('요청이 없으면 GET /me에서 200 본문 null 계약을 반환한다', async () => {
    // Given
    const controller = createRoleRequestsController(
      jest.fn().mockResolvedValue(null),
      jest.fn(),
    );

    // When
    const result = await controller.getMe(REQUEST);

    // Then
    expect(result).toBeNull();
  });

  it('최근 요청을 ISO 날짜 응답 계약으로 반환한다', async () => {
    // Given
    const controller = createRoleRequestsController(
      jest.fn().mockResolvedValue(rejectedRequest),
      jest.fn(),
    );

    // When
    const result = await controller.getMe(REQUEST);

    // Then
    expect(result).toEqual({
      requestedRole: Role.STAFF,
      status: RoleRequestStatus.REJECTED,
      requestedAt: REQUESTED_AT.toISOString(),
      decidedAt: DECIDED_AT.toISOString(),
      rejectionReason: '합성 사유',
    });
  });

  it('재요청 결과도 같은 RoleRequest 응답 계약으로 반환한다', async () => {
    // Given
    const pendingRequest = {
      ...rejectedRequest,
      status: RoleRequestStatus.PENDING,
      rejectionReason: null,
      decidedAt: null,
    };
    const controller = createRoleRequestsController(
      jest.fn(),
      jest.fn().mockResolvedValue(pendingRequest),
    );

    // When
    const result = await controller.retry(REQUEST);

    // Then
    expect(result).toEqual({
      requestedRole: Role.STAFF,
      status: RoleRequestStatus.PENDING,
      requestedAt: REQUESTED_AT.toISOString(),
      decidedAt: null,
      rejectionReason: null,
    });
  });

  it('조회는 세션 guard, 재요청은 세션과 Origin guard를 적용한다', () => {
    // Given
    const target = RoleRequestsController.prototype;

    // When
    const getGuards = readGuards(target, 'getMe');
    const postGuards = readGuards(target, 'retry');

    // Then
    expect(getGuards).toEqual([SessionGuard]);
    expect(postGuards).toEqual([SessionGuard, OriginGuard]);
  });
});
