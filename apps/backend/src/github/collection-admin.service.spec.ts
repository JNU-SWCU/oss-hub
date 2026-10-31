import { AccountStatus } from '@prisma/client';
import { UsersAuthorityService } from '../users/users-authority.service';
import { CollectionAdminService } from './collection-admin.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';

const deniedActors = [
  {
    id: 'student',
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: 'staff',
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: 'inactive-admin',
    hasStaffAccess: true,
    hasAdminAccess: true,
    accountStatus: AccountStatus.DEACTIVATED,
  },
  null,
];

describe('CollectionAdminService authorization', () => {
  it.each(
    deniedActors.flatMap((actor) =>
      ['trigger'].map((method) => [actor, method] as const),
    ),
  )('rejects %s before %s side effects', async (actor) => {
    const findActorByGithubId = jest.fn().mockResolvedValue(actor);
    const authority = new UsersAuthorityService({
      findActorByGithubId,
    });
    const work = jest.fn();
    const service = new CollectionAdminService(
      { run: work, runExternal: work },
      { isQuiesced: work },
      { record: work },
      { run: work },
      authority,
      new AuditLogMetadataService(),
    );
    const action = service.trigger(4242n);
    await expect(action).rejects.toMatchObject({
      errorCode: {
        status: 403,
        code: 'COL_004',
        message: '관리자 권한이 필요합니다.',
      },
    });
    expect(findActorByGithubId).toHaveBeenCalledWith(4242n);
    expect(work).not.toHaveBeenCalled();
  });
});
