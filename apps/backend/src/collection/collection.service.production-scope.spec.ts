import { Test } from '@nestjs/testing';
import { DomainException } from '../common/error-code';
import { CollectionErrorCode } from './collection-error-code.enum';
import { CollectionConfig } from './collection.config';
import { CollectionRepository } from './collection.repository';
import { CollectionRunStarter } from './collection-run-starter.service';
import { CollectionService } from './collection.service';
import { GithubApiClient } from './github-api.client';

describe('CollectionService production scope', () => {
  it('SELF는 GitHub와 DB 호출 전에 COL_005로 거부한다', async () => {
    const findUserByGithubId = jest.fn();
    const start = jest.fn();
    const getUser = jest.fn();
    const getRepos = jest.fn();
    const getPublicEvents = jest.fn();
    const testingModule = await Test.createTestingModule({
      providers: [
        CollectionService,
        {
          provide: CollectionConfig,
          useValue: { batchLogins: [], legacyUserCollectionEnabled: false },
        },
        { provide: CollectionRepository, useValue: { findUserByGithubId } },
        { provide: CollectionRunStarter, useValue: { start } },
        {
          provide: GithubApiClient,
          useValue: { getUser, getRepos, getPublicEvents },
        },
      ],
    }).compile();
    const service = testingModule.get(CollectionService);

    const promise = service.runSelf(424242n);

    await expect(promise).rejects.toBeInstanceOf(DomainException);
    await expect(promise).rejects.toMatchObject({
      errorCode: {
        code: CollectionErrorCode.COLLECTION_SCOPE_DISABLED,
        status: 503,
      },
    });
    expect(findUserByGithubId).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(getRepos).not.toHaveBeenCalled();
    expect(getPublicEvents).not.toHaveBeenCalled();
    await testingModule.close();
  });
});
