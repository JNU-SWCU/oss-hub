import { AffiliationKind, MemberKind } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import type { PatchUserProfileInput } from '../domain/user-profile';
import type {
  ProfileCompletionOutcome,
  UsersRepositoryPort,
} from '../repository/users.repository';
import { UsersService } from './users.service';

type StudentIdFillOutcome = Awaited<
  ReturnType<UsersRepositoryPort['fillStudentId']>
>;

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
  readonly staffNumber?: string | null;
  readonly department: string | null;
  readonly phone?: string | null;
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
          staffNumber: null,
          department: null,
          phone: null,
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
  const record = jest.fn().mockResolvedValue(undefined);
  return {
    service: new UsersService(repository, { requireCurrent }, { record }),
    requireCurrent,
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
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

describe('기존 데이터 호환', () => {
  it('세 항목을 모두 채운 기존 사용자는 어떤 역할에서도 완료다', async () => {
    for (const role of ['STUDENT', 'STAFF'] as const) {
      const { service } = buildService({
        user: {
          id: 'synthetic-user',
          name: input.name,
          studentId,
          department: input.department ?? null,
          memberKind: role,
        },
      });

      await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
        studentId,
        isComplete: true,
      });
    }
  });

  it('학번이 null인 기존 교직원은 학번을 요구받지 않고 이름·학과만 갱신한다', async () => {
    const existingStaff = {
      id: 'synthetic-user',
      name: input.name,
      studentId: null,
      staffNumber: null,
      department: input.department ?? null,
      phone: null,
      memberKind: MemberKind.STAFF,
    };
    const { service, updateProfileFields, completeProfileIfUnchanged } =
      buildService({
        user: existingStaff,
      });

    const profile = await service.patchMyProfile(githubId, {
      name: '수정된 이름',
      department: '소프트웨어공학과',
    });

    expect(profile).toEqual({
      name: '수정된 이름',
      studentId: null,
      staffNumber: null,
      department: '소프트웨어공학과',
      phone: null,
      isComplete: true,
    });
    expect(updateProfileFields).toHaveBeenCalledWith(
      existingStaff,
      {
        name: '수정된 이름',
        department: '소프트웨어공학과',

        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '소프트웨어공학과',
      },
      expect.any(Function),
      expect.any(Function),
    );
    expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  });

  it('관리자 갱신도 이름·학과를 함께 보낸다', async () => {
    const existingAdmin = {
      id: 'synthetic-user',
      name: input.name,
      studentId: null,
      department: input.department ?? null,
      phone: null,
      memberKind: MemberKind.STAFF,
      hasAdminAccess: true,
    };
    const { service, updateProfileFields } = buildService({
      user: existingAdmin,
    });

    const profile = await service.patchMyProfile(githubId, {
      name: '수정된 이름',
      department: input.department,
    });

    expect(profile.department).toBe(input.department);
    expect(updateProfileFields).toHaveBeenCalledWith(
      existingAdmin,
      {
        name: '수정된 이름',
        department: input.department,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: input.department,
      },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('교직원이 학번을 실어 보내면 400 검증 오류로 거부한다', async () => {
    const stored = {
      id: 'synthetic-user',
      name: input.name,
      studentId: null,
      department: input.department ?? null,
      memberKind: MemberKind.STAFF,
    } as const;
    const { service, updateProfileFields, fillStudentId } = buildService({
      user: stored,
    });

    const error = await captureDomainException(() =>
      service.patchMyProfile(githubId, input),
    );

    expect(error.errorCode).toMatchObject({
      code: SystemErrorCode.VALIDATION_FAILED,
      status: 400,
    });
    expect(fillStudentId).not.toHaveBeenCalled();
    expect(updateProfileFields).not.toHaveBeenCalled();
  });
});
