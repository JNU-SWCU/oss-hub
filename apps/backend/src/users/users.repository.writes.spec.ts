import { Prisma } from '@prisma/client';
import type { UserProfileRecord } from './profile-validation.config';
import {
  canonicalCompletion,
  profileRecord,
} from './member-authority-test-fixtures';
import { usersRepositoryHarness } from './users.repository.spec-support';

const fields = { name: 'Name', department: 'Department' };
async function fixture(
  kind: 'STUDENT' | 'STAFF' = 'STUDENT',
  overrides: Partial<UserProfileRecord> = {},
) {
  const h = usersRepositoryHarness(
    profileRecord('user', {
      ...fields,
      studentId: kind === 'STUDENT' ? '123456' : null,
      memberKind: kind,
      selectedMemberKind: kind,
      departmentType: kind === 'STAFF' ? 'PROGRAM_OFFICE' : 'DEPARTMENT',
      department: fields.department,
      profileCreatedAt: new Date('2026-01-01'),
      ...overrides,
    }),
  );
  const expected = await h.repository.findByGithubId(4242n);
  if (!expected) throw new TypeError('Missing fixture user');
  return { h, expected };
}

describe('flat User profile completion writes', () => {
  it.each(['STUDENT', 'STAFF'] as const)(
    'completes %s without changing independent Admin',
    async (kind) => {
      const { h, expected } = await fixture(kind, {
        name: null,
        department: null,
        studentId: null,
        profileCreatedAt: null,
        hasAdminAccess: true,
      });
      const input = canonicalCompletion(
        { ...fields, studentId: kind === 'STUDENT' ? '123456' : null },
        kind,
      );
      expect(
        await h.repository.completeProfileIfUnchanged(
          expected,
          input,
          h.recordPhoneAudit,
        ),
      ).toBe('completed');
      const profileCreatedAt: unknown = expect.any(Date);
      expect(h.current()).toMatchObject({
        ...fields,
        studentId: input.studentId,
        type: kind,
        admin: { userId: 'user' },
        profileCreatedAt,
      });
    },
  );
  it('audits the first phone with the same transaction writer', async () => {
    const { h, expected } = await fixture('STUDENT', {
      name: null,
      department: null,
      studentId: null,
      profileCreatedAt: null,
    });
    await h.repository.completeProfileIfUnchanged(
      expected,
      {
        ...canonicalCompletion({ ...fields, studentId: '123456' }),
        phone: '00012345678',
      },
      h.recordPhoneAudit,
    );
    const user: unknown = expect.objectContaining({ id: 'user' });
    expect(h.recordPhoneAudit).toHaveBeenCalledWith(
      { auditLogWriter: h.transaction },
      { user, transition: 'set' },
    );
  });
  it('rejects a changed completion snapshot before any write', async () => {
    const { h, expected } = await fixture('STUDENT', {
      name: null,
      department: null,
      profileCreatedAt: null,
    });
    h.replaceCurrent({ name: 'Concurrent' });
    expect(
      await h.repository.completeProfileIfUnchanged(
        expected,
        canonicalCompletion({ ...fields, studentId: '123456' }),
        h.recordPhoneAudit,
      ),
    ).toBe('conflict');
    expect(h.userUpdate).not.toHaveBeenCalled();
  });
});

describe('profile and phone updates', () => {
  it('updates the single stored department and retains its discriminator', async () => {
    const { h, expected } = await fixture();
    await h.repository.updateProfileFields(
      expected,
      {
        name: 'New name',
        department: 'New department',
        departmentType: 'DEPARTMENT',
      },
      h.recordStaffNumberAudit,
      h.recordPhoneAudit,
    );
    expect(h.current()).toMatchObject({
      name: 'New name',
      department: 'New department',
      departmentType: 'DEPARTMENT',
    });
    expect(h.histories).toHaveLength(1);
  });
  it('uses the locked canonical identity rather than incomplete caller audit metadata', async () => {
    const { h, expected } = await fixture();
    await h.repository.updateProfileFields(
      { ...expected, githubId: undefined, githubLogin: undefined },
      { ...fields, phone: '00012345678' },
      h.recordStaffNumberAudit,
      h.recordPhoneAudit,
    );
    const user: unknown = expect.objectContaining({
      githubId: 4242n,
      githubLogin: 'user',
    });
    expect(h.recordPhoneAudit).toHaveBeenCalledWith(
      { auditLogWriter: h.transaction },
      {
        user,
        transition: 'set',
      },
    );
  });
  it('does not write or audit after the locked account disappears', async () => {
    const { h, expected } = await fixture();
    h.replaceCurrent(null);
    await expect(
      h.repository.updateProfileFields(
        expected,
        { ...fields, phone: '00012345678' },
        h.recordStaffNumberAudit,
        h.recordPhoneAudit,
      ),
    ).rejects.toThrow('Missing user');
    expect(h.userUpdate).not.toHaveBeenCalled();
    expect(h.recordPhoneAudit).not.toHaveBeenCalled();
  });
  it.each([
    [null, 'set'],
    ['00000000000', 'replaced'],
  ] as const)(
    'audits phone replacement from %s using latest locked value',
    async (phone, transition) => {
      const { h, expected } = await fixture();
      h.replaceCurrent({ phone });
      await h.repository.updateProfileFields(
        expected,
        { ...fields, phone: '00012345678' },
        h.recordStaffNumberAudit,
        h.recordPhoneAudit,
      );
      expect(h.current()?.phone).toBe('00012345678');
      const user: unknown = expect.objectContaining({ phone });
      expect(h.recordPhoneAudit).toHaveBeenCalledWith(
        { auditLogWriter: h.transaction },
        { user, transition },
      );
    },
  );
  it('does not write or audit an identical profile and phone', async () => {
    const { h, expected } = await fixture('STUDENT', { phone: '00012345678' });
    await h.repository.updateProfileFields(
      expected,
      { ...fields, phone: '00012345678' },
      h.recordStaffNumberAudit,
      h.recordPhoneAudit,
    );
    expect(h.userUpdate).not.toHaveBeenCalled();
    expect(h.recordPhoneAudit).not.toHaveBeenCalled();
  });
  it('rolls back both profile and phone when phone auditing fails', async () => {
    const { h, expected } = await fixture();
    h.recordPhoneAudit.mockRejectedValue(new Error('phone audit failure'));
    await expect(
      h.repository.updateProfileFields(
        expected,
        { name: 'Changed', department: 'Changed', phone: '00012345678' },
        h.recordStaffNumberAudit,
        h.recordPhoneAudit,
      ),
    ).rejects.toThrow('phone audit failure');
    expect(h.current()).toMatchObject({ ...fields, phone: null });
    expect(h.histories).toHaveLength(0);
  });
});

describe('locked staffNumber updates', () => {
  it('does not allow a student to save staffNumber', async () => {
    const { h, expected } = await fixture();
    await expect(
      h.repository.updateProfileFields(
        expected,
        { ...fields, staffNumber: 'staff-number' },
        h.recordStaffNumberAudit,
        h.recordPhoneAudit,
      ),
    ).rejects.toMatchObject({ errorCode: { code: 'SYS_003' } });
    expect(h.userUpdate).not.toHaveBeenCalled();
  });
  it.each(['next-number', null] as const)(
    'stores %s and audits the locked prior number',
    async (staffNumber) => {
      const { h, expected } = await fixture('STAFF', {
        staffNumber: 'old-number',
      });
      await h.repository.updateProfileFields(
        expected,
        { ...fields, staffNumber },
        h.recordStaffNumberAudit,
        h.recordPhoneAudit,
      );
      expect(h.current()?.staffNumber).toBe(staffNumber);
      const user: unknown = expect.objectContaining({ id: 'user' });
      expect(h.recordStaffNumberAudit).toHaveBeenCalledWith(
        { auditLogWriter: h.transaction },
        {
          user,
          before: 'old-number',
          after: staffNumber,
        },
      );
    },
  );
  it('uses a concurrent locked staff number as the audit before value', async () => {
    const { h, expected } = await fixture('STAFF', { staffNumber: 'snapshot' });
    h.replaceCurrent({ staffNumber: 'concurrent' });
    await h.repository.updateProfileFields(
      expected,
      { ...fields, staffNumber: 'next' },
      h.recordStaffNumberAudit,
      h.recordPhoneAudit,
    );
    expect(h.recordStaffNumberAudit).toHaveBeenCalledWith(
      { auditLogWriter: h.transaction },
      expect.objectContaining({ before: 'concurrent', after: 'next' }),
    );
  });
  it('audits staff number before phone in the same transaction', async () => {
    const { h, expected } = await fixture('STAFF');
    const order: string[] = [];
    h.recordStaffNumberAudit.mockImplementation(
      (store) =>
        new Promise<void>((resolve) => {
          expect(store.auditLogWriter).toBe(h.transaction);
          order.push('staff');
          resolve();
        }),
    );
    h.recordPhoneAudit.mockImplementation(
      (store) =>
        new Promise<void>((resolve) => {
          expect(store.auditLogWriter).toBe(h.transaction);
          order.push('phone');
          resolve();
        }),
    );
    await h.repository.updateProfileFields(
      expected,
      { ...fields, staffNumber: 'next', phone: '00012345678' },
      h.recordStaffNumberAudit,
      h.recordPhoneAudit,
    );
    expect(order).toEqual(['staff', 'phone']);
  });
  it.each([undefined, 'existing'] as const)(
    'preserves the number without audit when supplied value is %s',
    async (staffNumber) => {
      const { h, expected } = await fixture('STAFF', {
        staffNumber: 'existing',
      });
      await h.repository.updateProfileFields(
        expected,
        { ...fields, staffNumber },
        h.recordStaffNumberAudit,
        h.recordPhoneAudit,
      );
      expect(h.current()?.staffNumber).toBe('existing');
      expect(h.recordStaffNumberAudit).not.toHaveBeenCalled();
    },
  );
  it('uses canonical audit identity for a number change', async () => {
    const { h, expected } = await fixture('STAFF');
    await h.repository.updateProfileFields(
      { ...expected, githubId: undefined, githubLogin: undefined },
      { ...fields, staffNumber: 'next' },
      h.recordStaffNumberAudit,
      h.recordPhoneAudit,
    );
    const user: unknown = expect.objectContaining({
      githubId: 4242n,
      githubLogin: 'user',
    });
    expect(h.recordStaffNumberAudit).toHaveBeenCalledWith(
      { auditLogWriter: h.transaction },
      expect.objectContaining({ user }),
    );
  });
  it('rolls back profile changes when staff number auditing fails', async () => {
    const { h, expected } = await fixture('STAFF');
    h.recordStaffNumberAudit.mockRejectedValue(
      new Error('staff audit failure'),
    );
    await expect(
      h.repository.updateProfileFields(
        expected,
        { name: 'Changed', department: 'Changed', staffNumber: 'next' },
        h.recordStaffNumberAudit,
        h.recordPhoneAudit,
      ),
    ).rejects.toThrow('staff audit failure');
    expect(h.current()).toMatchObject({ ...fields, staffNumber: null });
  });
});

describe('initial studentId fill', () => {
  it('stores a missing studentId on the existing User without inventing a profile record', async () => {
    const { h, expected } = await fixture('STAFF', {
      studentId: null,
      profileCreatedAt: null,
    });
    expect(
      await h.repository.fillStudentId(
        { expected, studentId: '654321' },
        h.recordPhoneAudit,
      ),
    ).toBe('filled');
    expect(h.current()).toMatchObject({
      studentId: '654321',
      profileCreatedAt: null,
    });
  });
  it('fills studentId and phone in one transaction', async () => {
    const { h, expected } = await fixture('STUDENT', { studentId: null });
    expect(
      await h.repository.fillStudentId(
        { expected, studentId: '654321', phone: '00012345678' },
        h.recordPhoneAudit,
      ),
    ).toBe('filled');
    expect(h.current()).toMatchObject({
      studentId: '654321',
      phone: '00012345678',
    });
    expect(h.recordPhoneAudit).toHaveBeenCalledTimes(1);
  });
  it('does not write phone when studentId was already filled', async () => {
    const { h, expected } = await fixture();
    expect(
      await h.repository.fillStudentId(
        { expected, studentId: '654321', phone: '00012345678' },
        h.recordPhoneAudit,
      ),
    ).toBe('conflict');
    expect(h.recordPhoneAudit).not.toHaveBeenCalled();
    expect(h.userUpdate).not.toHaveBeenCalled();
  });
  it('rolls back studentId when phone audit fails', async () => {
    const { h, expected } = await fixture('STUDENT', { studentId: null });
    h.recordPhoneAudit.mockRejectedValue(new Error('phone audit failure'));
    await expect(
      h.repository.fillStudentId(
        { expected, studentId: '654321', phone: '00012345678' },
        h.recordPhoneAudit,
      ),
    ).rejects.toThrow('phone audit failure');
    expect(h.current()).toMatchObject({ studentId: null, phone: null });
  });
  it('returns taken without writing when another account owns the studentId', async () => {
    const { h, expected } = await fixture('STUDENT', { studentId: null });
    h.takeStudentId('654321');
    expect(
      await h.repository.fillStudentId(
        { expected, studentId: '654321' },
        h.recordPhoneAudit,
      ),
    ).toBe('taken');
    expect(h.userUpdate).not.toHaveBeenCalled();
  });
});

it('maps a concurrent studentId unique violation to taken at the current User writer', async () => {
  const { h, expected } = await fixture('STUDENT', { studentId: null });
  h.userUpdate.mockRejectedValueOnce(
    new Prisma.PrismaClientKnownRequestError('Duplicate studentId', {
      code: 'P2002',
      clientVersion: 'synthetic',
    }),
  );
  expect(
    await h.repository.fillStudentId(
      { expected, studentId: '654321' },
      h.recordPhoneAudit,
    ),
  ).toBe('taken');
  expect(h.current()?.studentId).toBeNull();
});
it('propagates non-unique studentId storage errors without recording a success', async () => {
  const { h, expected } = await fixture('STUDENT', { studentId: null });
  const failure = new TypeError('synthetic profile update failure');
  h.userUpdate.mockRejectedValueOnce(failure);
  await expect(
    h.repository.fillStudentId(
      { expected, studentId: '654321' },
      h.recordPhoneAudit,
    ),
  ).rejects.toBe(failure);
  expect(h.current()?.studentId).toBeNull();
});
it('rejects a studentId fill when the same account was concurrently filled after the snapshot', async () => {
  const { h, expected } = await fixture('STUDENT', { studentId: null });
  h.replaceCurrent({ studentId: '654321' });
  expect(
    await h.repository.fillStudentId(
      { expected, studentId: '654321' },
      h.recordPhoneAudit,
    ),
  ).toBe('conflict');
  expect(h.userUpdate).not.toHaveBeenCalled();
});

it('preserves SYS_003 when the locked account changed from STAFF to STUDENT before a staffNumber write', async () => {
  const { h, expected } = await fixture('STAFF', { studentId: '123456' });
  h.replaceCurrent({
    type: 'STUDENT',
    departmentType: 'DEPARTMENT',
    approvalStatus: 'NOT_REQUIRED',
  });
  await expect(
    h.repository.updateProfileFields(
      expected,
      { ...fields, staffNumber: 'forbidden' },
      h.recordStaffNumberAudit,
      h.recordPhoneAudit,
    ),
  ).rejects.toMatchObject({ errorCode: { code: 'SYS_003', status: 400 } });
  expect(h.userUpdate).not.toHaveBeenCalled();
  expect(h.histories).toHaveLength(0);
  expect(h.recordStaffNumberAudit).not.toHaveBeenCalled();
  expect(h.recordPhoneAudit).not.toHaveBeenCalled();
});
