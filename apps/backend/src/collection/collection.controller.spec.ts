import { DomainException } from '../common/error-code';
import { CollectionErrorCode } from './collection-error-code.enum';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';
import {
  COLLECTION_RUN_STATUSES,
  COLLECTION_TRIGGERS,
  CollectionRun,
} from './domain/collection-run';

const succeededRun: CollectionRun = {
  id: 'synthetic-run-id',
  targetGithubId: 424242n,
  targetLogin: 'synthetic-login',
  trigger: COLLECTION_TRIGGERS.SELF,
  status: COLLECTION_RUN_STATUSES.SUCCEEDED,
  profileCount: 1,
  repoCount: 2,
  eventCount: 3,
  retryNotBeforeAt: null,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: new Date('2026-01-01T00:00:03.000Z'),
};

describe('CollectionController', () => {
  const runSelf = jest.fn();
  const service = { runSelf } as unknown as CollectionService;
  const controller = new CollectionController(service);

  beforeEach(() => {
    runSelf.mockReset();
  });

  it('성공 run을 BigInt 없는 응답 DTO로 변환한다', async () => {
    runSelf.mockResolvedValue(succeededRun);

    const result = await controller.runSelf({
      sessionGithubId: 424242n,
    } as never);

    expect(result).toEqual({
      runId: 'synthetic-run-id',
      status: COLLECTION_RUN_STATUSES.SUCCEEDED,
      profileCount: 1,
      repoCount: 2,
      eventCount: 3,
    });
    expect(runSelf).toHaveBeenCalledWith(424242n);
  });

  it('rate limited run은 COL_001과 ISO retryNotBeforeAt로 거부한다', async () => {
    const retryNotBeforeAt = new Date('2026-01-01T00:01:00.000Z');
    runSelf.mockResolvedValue({
      ...succeededRun,
      status: COLLECTION_RUN_STATUSES.RATE_LIMITED,
      retryNotBeforeAt,
    });

    const promise = controller.runSelf({ sessionGithubId: 424242n } as never);

    await expect(promise).rejects.toBeInstanceOf(DomainException);
    await expect(promise).rejects.toMatchObject({
      errorCode: { code: CollectionErrorCode.RATE_LIMITED, status: 429 },
      extensions: { retryNotBeforeAt: retryNotBeforeAt.toISOString() },
    });
  });
});
