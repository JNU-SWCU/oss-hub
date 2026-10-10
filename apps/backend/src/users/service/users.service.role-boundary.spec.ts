import { MemberKind } from '@prisma/client';
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
  phone: '1'.repeat(11),
};

type StoredUser = {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly staffNumber?: string | null;
  readonly department: string | null;
  readonly phone?: string | null;
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
          staffNumber: null,
          department: null,
          phone: null,
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
  const auditLog = { record: jest.fn() };
  const repository: UsersRepositoryPort = {
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
  return {
    service: new UsersService(repository, { requireCurrent }, auditLog),
    requireCurrent,
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
}

describe('역할 변경 경계', () => {
  it('학생이 교직원이 되어도 학번은 남고 프로필은 완료로 유지된다', async () => {
    const { service } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId,
        staffNumber: null,
        department: input.department ?? null,
        role: 'STAFF',
        selectedMemberKind: MemberKind.STUDENT,
        memberKind: MemberKind.STUDENT,
      },
    });

    await expect(service.getMyProfile(githubId)).resolves.toEqual({
      name: input.name,
      studentId,
      staffNumber: null,
      department: input.department,
      phone: null,
      isComplete: true,
    });
    await expect(
      service.requireCompleteProfile(githubId),
    ).resolves.toBeUndefined();
  });

  it('학번 없는 교직원이 학생으로 바뀌면 미완료가 되고 학번을 다시 받는다', async () => {
    const { service, completeProfileIfUnchanged } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        staffNumber: null,
        department: input.department ?? null,
        role: 'STUDENT',
        selectedMemberKind: MemberKind.STUDENT,
        memberKind: MemberKind.STUDENT,
      },
    });

    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      isComplete: false,
    });
    const profile = await service.completeMyProfile(githubId, input);

    expect(profile).toEqual({
      ...input,
      staffNumber: null,
      isComplete: true,
    });
    expect(completeProfileIfUnchanged).toHaveBeenCalledWith(
      expect.anything(),
      {
        name: input.name,
        studentId,
        department: input.department,
        phone: input.phone,
        memberKind: MemberKind.STUDENT,
        affiliationKind: 'DEPARTMENT',
        affiliationName: input.department,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
      expect.any(Function),
    );
  });

  it('이름만 있는 관리자가 교직원이 되면 학과만 추가로 받는다', async () => {
    const { service, completeProfileIfUnchanged } = buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId: null,
        staffNumber: null,
        department: null,
        role: 'STAFF',
        selectedMemberKind: MemberKind.STAFF,
        memberKind: MemberKind.STAFF,
      },
    });

    await expect(service.getMyProfile(githubId)).resolves.toMatchObject({
      isComplete: false,
    });
    const profile = await service.completeMyProfile(githubId, {
      name: input.name,
      department: input.department,
    });

    expect(profile).toEqual({
      name: input.name,
      studentId: null,
      staffNumber: null,
      department: input.department,
      phone: null,
      isComplete: true,
    });
    expect(completeProfileIfUnchanged).toHaveBeenCalledWith(
      expect.anything(),
      {
        name: input.name,
        studentId: null,
        department: input.department,
        memberKind: MemberKind.STAFF,
        affiliationKind: 'DEPARTMENT',
        affiliationName: input.department,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
      expect.any(Function),
    );
  });
});
