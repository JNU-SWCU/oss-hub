import { MemberKind } from '@prisma/client';
import {
  USER_PHONE_AUDIT_TRANSITIONS,
  USER_PROFILE_AUDIT_ACTIONS,
  USER_PROFILE_AUDIT_FIELDS,
  USER_PROFILE_AUDIT_SCHEMA_VERSION,
  type UserPhoneAuditTransition,
} from '../../audit-log/domain/audit-log-metadata';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DomainException } from '../../common/error-code';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import type { PatchUserProfileInput } from '../domain/user-profile';
import { UsersErrorCode } from '../domain/users-error-code.enum';
import type {
  ProfileCompletionOutcome,
  UsersRepositoryPort,
} from '../repository/users.repository';
import { profileRecord } from './member-authority-test-fixtures';
import { UsersService } from './users.service';

type StudentIdFillOutcome = Awaited<
  ReturnType<UsersRepositoryPort['fillStudentId']>
>;
type RecordPhoneAudit = Parameters<UsersRepositoryPort['fillStudentId']>[1];
type RecordStaffNumberAudit = Parameters<
  UsersRepositoryPort['updateProfileFields']
>[2];
type PhoneAuditChange = Parameters<RecordPhoneAudit>[1];
type StaffNumberAuditChange = Parameters<RecordStaffNumberAudit>[1];

const githubId = 4242n;
const githubLogin = 'synthetic-login';
const studentId = '1'.repeat(6);
const initialPhone = '2'.repeat(11);
const changedPhone = '3'.repeat(11);
const input: PatchUserProfileInput = {
  name: '합성 사용자',
  studentId,
  department: '인공지능학부',
  phone: initialPhone,
};
const auditedRecord: Awaited<ReturnType<AuditLogService['record']>> = {
  id: 'synthetic-audit',
  actor: '합성 사용자',
  actorHandle: githubLogin,
  action: USER_PROFILE_AUDIT_ACTIONS.PHONE_UPDATED,
  targetType: 'USER',
  targetId: 'synthetic-user',
  target: '합성 사용자',
  targetHandle: githubLogin,
  occurredAt: new Date(0),
  legacy: true,
  metadata: null,
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
    readonly phoneAudit?: PhoneAuditChange;
    readonly staffNumberAudit?: StaffNumberAuditChange;
    readonly auditError?: Error;
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
  const auditLogWriter = {} as AuditLogTransactionWriter;
  const record = jest
    .fn<
      ReturnType<AuditLogService['record']>,
      Parameters<AuditLogService['record']>
    >()
    .mockResolvedValue(auditedRecord);
  if (overrides.auditError) {
    record.mockRejectedValue(overrides.auditError);
  }
  const completeProfileIfUnchanged = jest
    .fn<
      Promise<ProfileCompletionOutcome>,
      Parameters<UsersRepositoryPort['completeProfileIfUnchanged']>
    >()
    .mockImplementation(async (_expected, completion, recordPhoneAudit) => {
      const outcome = overrides.completed ?? 'completed';
      const phoneAudit =
        completion.phone === undefined ? undefined : overrides.phoneAudit;
      if (phoneAudit && outcome === 'completed') {
        await recordPhoneAudit({ auditLogWriter }, phoneAudit);
      }
      return outcome;
    });
  const updateProfileFields = jest
    .fn<Promise<void>, Parameters<UsersRepositoryPort['updateProfileFields']>>()
    .mockImplementation(
      async (_expected, fields, recordStaffNumberAudit, recordPhoneAudit) => {
        const staffNumberAudit = overrides.staffNumberAudit;
        if (staffNumberAudit && fields.staffNumber !== undefined) {
          await recordStaffNumberAudit({ auditLogWriter }, staffNumberAudit);
        }
        const phoneAudit = overrides.phoneAudit;
        if (phoneAudit && fields.phone !== undefined) {
          await recordPhoneAudit({ auditLogWriter }, phoneAudit);
        }
      },
    );
  const fillStudentId = jest
    .fn<
      Promise<StudentIdFillOutcome>,
      Parameters<UsersRepositoryPort['fillStudentId']>
    >()
    .mockImplementation(async (fill, recordPhoneAudit) => {
      const outcome = overrides.studentIdFill ?? 'filled';
      const phoneAudit =
        fill.phone === undefined ? undefined : overrides.phoneAudit;
      if (phoneAudit && outcome === 'filled') {
        await recordPhoneAudit({ auditLogWriter }, phoneAudit);
      }
      return outcome;
    });
  const repository: UsersRepositoryPort = {
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
  };
  const auditLog = { record } satisfies Pick<AuditLogService, 'record'>;
  return {
    service: new UsersService(repository, { requireCurrent }, auditLog),
    requireCurrent,
    findByGithubId,
    completeProfileIfUnchanged,
    fillStudentId,
    updateProfileFields,
    record,
    auditLogWriter,
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

it('현행 동의를 확인한 뒤 GitHub 이름과 빈 프로필을 반환한다', async () => {
  const { service, requireCurrent } = buildService();

  await expect(service.getMyProfile(githubId)).resolves.toEqual({
    name: 'GitHub 합성 이름',
    studentId: null,
    staffNumber: null,
    department: null,
    phone: null,
    isComplete: false,
  });
  expect(requireCurrent).toHaveBeenCalledWith(githubId);
});

it('이름이 비어 있으면 학번과 학과가 있어도 미완료로 반환한다', async () => {
  const { service } = buildService({
    user: {
      id: 'synthetic-user',
      name: '',
      studentId,
      staffNumber: null,
      department: input.department ?? null,
      phone: null,
      role: 'STUDENT',
    },
  });

  await expect(service.getMyProfile(githubId)).resolves.toEqual({
    name: '',
    studentId,
    staffNumber: null,
    department: input.department,
    phone: null,
    isComplete: false,
  });
});

it('동의 확인이 실패하면 사용자 조회를 시작하지 않는다', async () => {
  const consentError = new Error('synthetic consent failure');
  const { service, findByGithubId } = buildService({ consentError });

  await expect(service.getMyProfile(githubId)).rejects.toBe(consentError);
  expect(findByGithubId).not.toHaveBeenCalled();
});

it('빈 프로필을 한 번만 저장하고 완료 응답을 반환한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService();

  await expect(service.completeMyProfile(githubId, input)).resolves.toEqual({
    ...input,
    staffNumber: null,
    isComplete: true,
  });
  expect(completeProfileIfUnchanged).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'synthetic-user',
      selectedMemberKind: MemberKind.STUDENT,
    }),
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
  expect(updateProfileFields).not.toHaveBeenCalled();
});

it('미완료 프로필에 학번이 없으면 400 검증 오류로 거부한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService();

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
  expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  expect(updateProfileFields).not.toHaveBeenCalled();
});

it('이미 완료된 프로필의 학번을 다른 값으로 바꾸려 하면 USR_003으로 거부한다', async () => {
  const { service, completeProfileIfUnchanged, updateProfileFields } =
    buildService({
      user: {
        id: 'synthetic-user',
        name: input.name,
        studentId,
        department: input.department ?? null,
        phone: input.phone,
        role: 'STUDENT',
      },
    });

  const error = await captureDomainException(() =>
    service.patchMyProfile(githubId, { ...input, studentId: '9'.repeat(6) }),
  );

  expect(error.errorCode.code).toBe(UsersErrorCode.STUDENT_ID_IMMUTABLE);
  expect(error.errorCode.status).toBe(400);
  expect(completeProfileIfUnchanged).not.toHaveBeenCalled();
  expect(updateProfileFields).not.toHaveBeenCalled();
});

it('완료된 프로필의 연락처를 PATCH로 변경한다', async () => {
  const existingUser = {
    id: 'synthetic-user',
    name: input.name,
    studentId,
    staffNumber: null,
    department: input.department ?? null,
    phone: initialPhone,
    role: 'STUDENT' as const,
  };
  const { service, updateProfileFields } = buildService({
    user: existingUser,
  });

  await expect(
    service.patchMyProfile(githubId, {
      name: input.name,
      department: input.department,
      phone: changedPhone,
    }),
  ).resolves.toEqual({
    name: input.name,
    studentId,
    staffNumber: null,
    department: input.department,
    phone: changedPhone,
    isComplete: true,
  });
  expect(updateProfileFields).toHaveBeenCalledWith(
    existingUser,
    {
      name: input.name,
      department: input.department,
      phone: changedPhone,
    },
    expect.any(Function),
    expect.any(Function),
  );
});

it('완료된 프로필의 형식화된 연락처 PATCH를 400 검증 오류로 거부한다', async () => {
  const { service, updateProfileFields } = buildService({
    user: {
      id: 'synthetic-user',
      name: input.name,
      studentId,
      department: input.department ?? null,
      phone: initialPhone,
      role: 'STUDENT',
    },
  });

  const error = await captureDomainException(() =>
    service.patchMyProfile(githubId, {
      name: input.name,
      department: input.department,
      phone: '333-3333-3333',
    }),
  );

  expect(error.errorCode).toMatchObject({
    code: SystemErrorCode.VALIDATION_FAILED,
    status: 400,
  });
  expect(updateProfileFields).not.toHaveBeenCalled();
});

describe('저장소가 넘긴 감사 콜백', () => {
  const auditedEmptyUser = {
    ...profileRecord('synthetic-user', { name: 'GitHub 합성 이름' }),
    githubId,
    githubLogin,
  };
  const auditedStudent = {
    ...profileRecord('synthetic-user', {
      name: input.name,
      studentId,
      department: input.department ?? null,
      phone: initialPhone,
      memberKind: MemberKind.STUDENT,
    }),
    githubId,
    githubLogin,
  };
  const auditedStaff = {
    ...profileRecord('synthetic-staff', {
      name: '합성 교직원',
      staffNumber: 'OLD-42',
      department: '인공지능학부',
      selectedMemberKind: MemberKind.STAFF,
      memberKind: MemberKind.STAFF,
    }),
    githubId,
    githubLogin,
  };
  const staffProfileInput = {
    name: '합성 교직원',
    department: '인공지능학부',
  };

  function expectedPhoneAudit(
    user: PhoneAuditChange['user'],
    transition: UserPhoneAuditTransition,
  ) {
    return {
      actorGithubId: user.githubId,
      action: USER_PROFILE_AUDIT_ACTIONS.PHONE_UPDATED,
      targetType: 'USER',
      targetId: user.id,
      metadata: {
        schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
        actor: { displayName: user.name, githubLogin: user.githubLogin },
        target: { displayName: user.name, githubLogin: user.githubLogin },
        transition,
      },
    };
  }

  function expectedStaffNumberAudit(
    user: StaffNumberAuditChange['user'],
    before: string | null,
    after: string | null,
  ) {
    return {
      actorGithubId: user.githubId,
      action: USER_PROFILE_AUDIT_ACTIONS.PROFILE_UPDATED,
      targetType: 'USER',
      targetId: user.id,
      metadata: {
        schemaVersion: USER_PROFILE_AUDIT_SCHEMA_VERSION,
        actor: { displayName: user.name, githubLogin: user.githubLogin },
        target: { displayName: user.name, githubLogin: user.githubLogin },
        changes: [
          { field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER, before, after },
        ],
      },
    };
  }

  it('가입 완료의 첫 연락처 저장을 SET 전이 감사로 남긴다', async () => {
    const { service, record, auditLogWriter } = buildService({
      user: auditedEmptyUser,
      phoneAudit: { user: auditedEmptyUser, transition: 'set' },
    });

    await expect(service.completeMyProfile(githubId, input)).resolves.toEqual({
      ...input,
      staffNumber: null,
      isComplete: true,
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expectedPhoneAudit(auditedEmptyUser, USER_PHONE_AUDIT_TRANSITIONS.SET),
      auditLogWriter,
    );
    expect(record.mock.calls[0]?.[1]).toBe(auditLogWriter);
  });

  it('완료된 프로필의 연락처 교체를 REPLACED 전이 감사로 남긴다', async () => {
    const { service, record, auditLogWriter, updateProfileFields } =
      buildService({
        user: auditedStudent,
        phoneAudit: { user: auditedStudent, transition: 'replaced' },
      });

    await expect(
      service.patchMyProfile(githubId, {
        name: input.name,
        department: input.department,
        phone: changedPhone,
      }),
    ).resolves.toMatchObject({ phone: changedPhone, isComplete: true });
    expect(updateProfileFields).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expectedPhoneAudit(auditedStudent, USER_PHONE_AUDIT_TRANSITIONS.REPLACED),
      auditLogWriter,
    );
    expect(record.mock.calls[0]?.[1]).toBe(auditLogWriter);
  });

  it.each([
    [' NEW-7 ', 'NEW-7'],
    [null, null],
  ] as const)(
    '사번 %s 변경을 before·after 감사로 남긴다',
    async (staffNumber, after) => {
      const { service, record, auditLogWriter } = buildService({
        user: auditedStaff,
        staffNumberAudit: { user: auditedStaff, before: 'OLD-42', after },
      });

      await expect(
        service.patchMyProfile(githubId, {
          ...staffProfileInput,
          staffNumber,
        }),
      ).resolves.toMatchObject({ staffNumber: after });
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(
        expectedStaffNumberAudit(auditedStaff, 'OLD-42', after),
        auditLogWriter,
      );
      expect(record.mock.calls[0]?.[1]).toBe(auditLogWriter);
    },
  );

  it('사번과 연락처가 함께 바뀌면 감사를 각각 남긴다', async () => {
    const { service, record, auditLogWriter } = buildService({
      user: auditedStaff,
      staffNumberAudit: {
        user: auditedStaff,
        before: 'OLD-42',
        after: 'NEW-7',
      },
      phoneAudit: { user: auditedStaff, transition: 'set' },
    });

    await expect(
      service.patchMyProfile(githubId, {
        ...staffProfileInput,
        staffNumber: 'NEW-7',
        phone: changedPhone,
      }),
    ).resolves.toMatchObject({ staffNumber: 'NEW-7', phone: changedPhone });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(
      expectedStaffNumberAudit(auditedStaff, 'OLD-42', 'NEW-7'),
      auditLogWriter,
    );
    expect(record).toHaveBeenCalledWith(
      expectedPhoneAudit(auditedStaff, USER_PHONE_AUDIT_TRANSITIONS.SET),
      auditLogWriter,
    );
  });

  it('감사 기록 실패를 삼키지 않고 그대로 전파한다', async () => {
    const auditError = new Error('synthetic audit failure');
    const { service, record, updateProfileFields } = buildService({
      user: auditedStudent,
      phoneAudit: { user: auditedStudent, transition: 'replaced' },
      auditError,
    });

    await expect(
      service.patchMyProfile(githubId, {
        name: input.name,
        department: input.department,
        phone: changedPhone,
      }),
    ).rejects.toBe(auditError);
    expect(updateProfileFields).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
