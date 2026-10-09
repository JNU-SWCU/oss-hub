import { MemberKind } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import type { PatchUserProfileInput } from '../domain/user-profile';
import { UsersErrorCode } from '../domain/users-error-code.enum';
import type {
  ProfileCompletionOutcome,
  StudentIdFillOutcome,
  UsersRepositoryPort,
} from '../repository/users.repository';
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
  readonly role?: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
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

function emptyUser(role: 'STUDENT' | 'STAFF' | 'ADMIN' | null): StoredUser {
  const selectedMemberKind =
    role === 'STUDENT'
      ? MemberKind.STUDENT
      : role === 'STAFF'
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
    hasAdminAccess: role === 'ADMIN',
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

  it('회원 유형이 없는 관리자는 아직 완료가 아니다', async () => {
    const { service, updateProfileFields } = buildService({
      user: emptyUser('ADMIN'),
    });

    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      isComplete: false,
    });
    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    expect(error.errorCode.code).toBe(
      UsersErrorCode.PROFILE_COMPLETE_REQUIRES_POST,
    );
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it('학생은 학번과 학과가 모두 있어야 완료된다', async () => {
    const { service } = buildService({ user: emptyUser('STUDENT') });

    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
  });

  it('역할이 없는 사용자는 학생 기준으로 학번까지 요구한다', async () => {
    const { service } = buildService({ user: emptyUser(null) });

    const error = await captureDomainException(() =>
      service.completeMyProfile(githubId, {
        name: input.name,
        department: input.department,
      }),
    );

    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
  });

  it('역할을 조회하지 않은 기록도 학생 기준으로 판정한다', async () => {
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        department: input.department ?? null,
      },
    });

    const error = await captureDomainException(() =>
      service.requireCompleteProfile(githubId),
    );

    expect(error.errorCode).toMatchObject({ code: 'USR_002', status: 409 });
  });
});
