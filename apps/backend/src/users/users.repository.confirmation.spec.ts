import { usersRepositoryHarness } from './users.repository.spec-support';
import {
  profileRecord,
  canonicalCompletion,
} from './member-authority-test-fixtures';

async function complete(
  kind: 'STUDENT' | 'STAFF',
  options: {
    readonly pending?: boolean;
    readonly approved?: boolean;
    readonly failPhone?: boolean;
  } = {},
) {
  const h = usersRepositoryHarness(
    profileRecord('user', {
      memberKind: kind,
      selectedMemberKind: kind,
      approvalStatus:
        kind === 'STAFF'
          ? options.approved
            ? 'APPROVED'
            : 'PENDING'
          : 'NOT_REQUIRED',
      approvalRequestId: options.pending ? 'existing-request' : null,
    }),
  );
  const expected = await h.repository.findByGithubId(4242n);
  if (!expected) throw new TypeError('Missing fixture');
  const input = {
    ...canonicalCompletion(
      {
        name: 'Name',
        studentId: kind === 'STUDENT' ? '123456' : null,
        department: 'Department',
      },
      kind,
    ),
    phone: '00012345678',
    requestsStaffAccess: kind === 'STAFF' && !options.approved,
  };
  if (options.failPhone)
    h.recordPhoneAudit.mockRejectedValue(new Error('phone audit failure'));
  return { h, expected, input };
}
it('student completion does not submit a staff request or alter independent Admin', async () => {
  const { h, expected, input } = await complete('STUDENT');
  h.replaceCurrent({ admin: { userId: 'user' } });
  expect(
    await h.repository.completeProfileIfUnchanged(
      expected,
      input,
      h.recordPhoneAudit,
    ),
  ).toBe('completed');
  expect(h.current()).toMatchObject({
    type: 'STUDENT',
    approvalStatus: 'NOT_REQUIRED',
    approvalRequestId: null,
    admin: { userId: 'user' },
  });
  expect(
    h.histories.filter((row) => row.event === 'APPROVAL_REQUESTED'),
  ).toHaveLength(0);
});
it('staff completion submits exactly one pending request with a real identity', async () => {
  const { h, expected, input } = await complete('STAFF');
  expect(
    await h.repository.completeProfileIfUnchanged(
      expected,
      input,
      h.recordPhoneAudit,
    ),
  ).toBe('completed');
  expect(h.current()?.approvalRequestId).toEqual(expect.any(String));
  expect(
    h.histories.filter((row) => row.event === 'APPROVAL_REQUESTED'),
  ).toHaveLength(1);
});
it('an existing pending request is retained without a second request event', async () => {
  const { h, expected, input } = await complete('STAFF', { pending: true });
  await h.repository.completeProfileIfUnchanged(
    expected,
    input,
    h.recordPhoneAudit,
  );
  expect(h.current()?.approvalRequestId).toBe('existing-request');
  expect(
    h.histories.filter((row) => row.event === 'APPROVAL_REQUESTED'),
  ).toHaveLength(0);
});
it('a changed locked profile conflicts without profile or approval side effects', async () => {
  const { h, expected, input } = await complete('STAFF');
  h.replaceCurrent({ name: 'Concurrent name' });
  expect(
    await h.repository.completeProfileIfUnchanged(
      expected,
      input,
      h.recordPhoneAudit,
    ),
  ).toBe('conflict');
  expect(h.histories).toHaveLength(0);
  expect(h.userUpdate).not.toHaveBeenCalled();
});
it('an already approved STAFF completion preserves approval without submitting a request', async () => {
  const { h, expected, input } = await complete('STAFF', { approved: true });
  await h.repository.completeProfileIfUnchanged(
    expected,
    input,
    h.recordPhoneAudit,
  );
  expect(h.current()?.approvalStatus).toBe('APPROVED');
  expect(
    h.histories.filter((row) => row.event === 'APPROVAL_REQUESTED'),
  ).toHaveLength(0);
});
it('phone auditing precedes staff request submission in the same transaction', async () => {
  const { h, expected, input } = await complete('STAFF');
  h.recordPhoneAudit.mockImplementation(
    (store) =>
      new Promise<void>((resolve) => {
        expect(store.userHistoryWriter).toBe(h.transaction);
        expect(h.current()?.approvalRequestId).toBeNull();
        resolve();
      }),
  );
  await h.repository.completeProfileIfUnchanged(
    expected,
    input,
    h.recordPhoneAudit,
  );
  expect(h.current()?.approvalRequestId).not.toBeNull();
});
it('phone audit failure prevents request submission and rolls back profile completion', async () => {
  const { h, expected, input } = await complete('STAFF', { failPhone: true });
  await expect(
    h.repository.completeProfileIfUnchanged(
      expected,
      input,
      h.recordPhoneAudit,
    ),
  ).rejects.toThrow('phone audit failure');
  expect(h.current()).toMatchObject({
    name: null,
    profileCreatedAt: null,
    approvalRequestId: null,
  });
  expect(h.histories).toHaveLength(0);
});
