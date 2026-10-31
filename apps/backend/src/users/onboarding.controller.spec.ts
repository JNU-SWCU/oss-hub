import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { DomainException } from '../platform/error-code.error';
import { SelectRoleRequestDto } from './dto/select-role-request.dto';
import { OnboardingController } from './onboarding.controller';
import { RolesErrorCode } from './roles-error-code.error';
import { MemberOnboardingService } from './member-onboarding.service';

const onboardingRequestParser = Object.create(
  MemberOnboardingService.prototype,
) as MemberOnboardingService;

const REQUEST: Pick<AuthenticatedRequest, 'sessionGithubId'> = {
  sessionGithubId: 424242n,
};

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
  selectMemberKind: MemberOnboardingService['selectMemberKind'],
  getMySelection: MemberOnboardingService['getMySelection'] = () =>
    Promise.resolve({ selectedMemberKind: null }),
): OnboardingController {
  return new OnboardingController({
    selectMemberKind,
    getMySelection,
    memberKindFromRequest: (request) =>
      onboardingRequestParser.memberKindFromRequest(request),
  });
}

describe('OnboardingController', () => {
  it('역할 선택 결과를 응답 계약으로 반환한다', async () => {
    const selectMemberKind = jest.fn().mockResolvedValue({
      selectedMemberKind: 'STUDENT',
      redirectTo: '/onboarding/profile',
    });
    const controller = createOnboardingController(selectMemberKind);
    const body = plainToInstance(SelectRoleRequestDto, {
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
    const body = plainToInstance(SelectRoleRequestDto, {
      selectedRole: 'ADMIN',
    });

    let caught: unknown;
    try {
      onboardingRequestParser.memberKindFromRequest(body);
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

    expect(guards).toEqual([OriginGuard]);
  });
});
