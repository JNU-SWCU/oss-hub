import {
  buildProfile,
  buildRepository,
  buildRow,
  upsertUser,
} from './auth.repository.spec-support';

describe('AuthRepository OAuth account synchronization', () => {
  it('records a new signup without selecting a type or granting authority', async () => {
    const { repository, historyCreate, adminCreate } = buildRepository(
      buildRow(),
      { isNew: true },
    );
    const result = await upsertUser(repository, buildProfile());
    expect(result).toMatchObject({
      isNew: true,
      user: {
        memberKind: null,
        approvalStatus: 'NOT_REQUIRED',
        hasAdminAccess: false,
      },
    });
    const signupData: unknown = expect.objectContaining({
      userId: 'cuid-synthetic',
      event: 'SIGNED_UP',
      source: 'APPLICATION',
    });
    expect(historyCreate).toHaveBeenCalledWith({ data: signupData });
    expect(adminCreate).not.toHaveBeenCalled();
  });
  it('updates GitHub metadata without replacing the locally supplied name', async () => {
    const { repository, historyCreate } = buildRepository(
      buildRow({ name: 'Local name', type: 'STUDENT' }),
    );
    const result = await upsertUser(
      repository,
      buildProfile({ name: 'GitHub name', login: 'new-login' }),
    );
    expect(result.user).toMatchObject({
      name: 'Local name',
      nickname: 'new-login',
      memberKind: 'STUDENT',
    });
    expect(historyCreate).not.toHaveBeenCalled();
  });
  it('fills an absent notification email but preserves an existing user choice', async () => {
    const missing = buildRepository(buildRow());
    await upsertUser(
      missing.repository,
      buildProfile({ email: 'new@example.test' }),
    );
    const notificationData: unknown = expect.objectContaining({
      notificationEmail: 'new@example.test',
    });
    expect(missing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: notificationData }),
    );
    const existing = buildRepository(
      buildRow({ notificationEmail: 'chosen@example.test' }),
    );
    await upsertUser(
      existing.repository,
      buildProfile({ email: 'new@example.test' }),
    );
    expect(existing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nickname: 'synthetic-login', avatarUrl: null },
      }),
    );
  });
});
