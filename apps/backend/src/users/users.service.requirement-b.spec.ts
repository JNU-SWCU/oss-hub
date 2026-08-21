import { MemberKind, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import type { PatchUserProfileInput } from './domain/user-profile';
import { UsersErrorCode } from './users-error-code.enum';
import type {
  ProfileCompletionOutcome,
  StudentIdFillOutcome,
  UsersRepositoryPort,
} from './users.repository';
import { UsersService } from './users.service';

const githubId = 4242n;
const studentId = '1'.repeat(6);
const input: PatchUserProfileInput = {
  name: '합성 사용자',
  studentId,
  department: '인공지능학부',
};

type StoredUser = {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly role?: Role | null;
  readonly selectedMemberKind?: MemberKind | null;
  readonly memberKind?: MemberKind | null;
  readonly hasAdminAccess?: boolean;
};

function buildService(
  overrides: {
    readonly user?: StoredUser | null;
    readonly completed?: ProfileCompletionOutcome;
    readonly studentIdFill?: StudentIdFillOutcome;
    readonly consentError?: Error;
  } = {},
) {
  const requireCurrent = overrides.consentError
    ? jest.fn().mockRejectedValue(overrides.consentError)
    : jest.fn().mockResolvedValue(undefined);
  const findByGithubId = jest.fn().mockResolvedValue(
    overrides.user === undefined
      ? {
          id: 'synthetic-user',
          name: 'GitHub 합성 이름',
          studentId: null,
          department: null,
          role: null,
          selectedMemberKind: MemberKind.STUDENT,
          memberKind: null,
          hasAdminAccess: false,
        }
      : overrides.user,
  );
  const completeProfileIfUnchanged = jest
    .fn()
    .mockResolvedValue(overrides.completed ?? 'completed');
  const updateProfileFields = jest.fn().mockResolvedValue(undefined);
  const fillStudentId = jest
    .fn()
    .mockResolvedValue(overrides.studentIdFill ?? 'filled');
  const repository: UsersRepositoryPort = {
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
  return {
    service: new UsersService(repository, { requireCurrent }),
    requireCurrent,
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
}

/** 아직 아무것도 채우지 않은 사용자. 역할만 갈아 끼운다. */
function emptyUser(role: Role | null): StoredUser {
  const selectedMemberKind =
    role === Role.STUDENT
      ? MemberKind.STUDENT
      : role === Role.STAFF
        ? MemberKind.STAFF
        : null;
  return {
    id: 'synthetic-user',
    name: 'GitHub 합성 이름',
    studentId: null,
    department: null,
    role,
    selectedMemberKind,
    memberKind: selectedMemberKind,
    hasAdminAccess: role === Role.ADMIN,
  };
}

async function captureDomainException(
  operation: () => Promise<unknown>,
): Promise<DomainException> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof DomainException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected DomainException');
}

describe('역할별 필수 항목 후속', () => {
  it('미완료 프로필을 PATCH하면 USR_010으로 거부한다', async () => {
    const { service, completeProfileIfUnchanged, updateProfileFields } =
      buildService({ user: { ...emptyUser('ADMIN'), name: null } });

    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    expect(error.errorCode.code).toBe(
      UsersErrorCode.PROFILE_COMPLETE_REQUIRES_POST,
    );
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it('GitHub 이름이 실린 관리자는 온보딩 없이 이미 완료 상태다', async () => {
    // Given — 관리자에게 더 받을 항목이 없으므로 이름만으로 완료다
    const { service, updateProfileFields } = buildService({
      user: emptyUser('ADMIN'),
    });

    // When
    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      isComplete: true,
    });
    await service.patchMyProfile(githubId, {
      name: input.name,
      department: input.department,
    });

    // Then — 완료 상태이므로 1회 저장이 아니라 갱신 경로를 탄다
    expect(updateProfileFields).toHaveBeenCalledWith('synthetic-user', {
      name: input.name,
      department: input.department,
    });
  });

  it('학생은 학번과 학과가 모두 있어야 완료된다', async () => {
    // Given
    const { service } = buildService({ user: emptyUser('STUDENT') });

    // When
    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
  });

  it('역할이 없는 사용자는 학생 기준으로 학번까지 요구한다', async () => {
    // Given — 온보딩 중에는 role이 null이고, 자력으로 고를 수 있는 역할은 학생뿐이다
    const { service } = buildService({ user: emptyUser(null) });

    // When
    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    // Then
    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
  });

  it('역할을 조회하지 않은 기록도 학생 기준으로 판정한다', async () => {
    // Given — roles 모듈은 role을 select하지 않고 UserProfileRecord를 만든다
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
      },
    });

    // When
    const error = await captureDomainException(() =>
      service.requireCompleteProfile(githubId),
    );

    // Then
    expect(error.errorCode).toMatchObject({ code: 'USR_002', status: 409 });
  });
});
