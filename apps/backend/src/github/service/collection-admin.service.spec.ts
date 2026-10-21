import { AccountStatus } from '@prisma/client';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { CollectionAdminService } from './collection-admin.service';

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
      ['trigger', 'listRuns', 'checkInvariants'].map(
        (method) => [actor, method] as const,
      ),
    ),
  )('rejects %s before %s side effects', async (actor, method) => {
    const findActorByGithubId = jest.fn().mockResolvedValue(actor);
    const authority = new UsersAuthorityService({
      findActorByGithubId,
    });
    const work = jest.fn();
    const service = new CollectionAdminService(
      { run: work, runExternal: work },
      { isQuiesced: work },
      { listSyncRuns: work },
      { record: work },
      { check: work },
      { run: work },
      authority,
    );
    const action =
      method === 'trigger'
        ? service.trigger(4242n)
        : method === 'listRuns'
          ? service.listRuns(4242n)
          : service.checkInvariants(4242n);
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
