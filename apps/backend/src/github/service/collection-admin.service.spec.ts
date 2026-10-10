import { AccountStatus } from '@prisma/client';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { ContributionInvariants } from '../contribution-invariants';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';
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
      { run: work, runExternal: work } as unknown as CollectionSyncService,
      { isQuiesced: work } as unknown as CollectionCutoverRepository,
      { listSyncRuns: work } as unknown as CollectionIncrementalRepository,
      { record: work } as unknown as AuditLogService,
      { check: work } as unknown as ContributionInvariants,
      { run: work } as unknown as CollectionUserActivityService,
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
