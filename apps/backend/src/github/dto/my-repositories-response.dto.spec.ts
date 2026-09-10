import { MyRepositoriesResponseDto } from './my-repositories-response.dto';
import type { MyRepository } from '../service/repositories.service';

describe('MyRepositoriesResponseDto', () => {
  it.each(['NEW', 'OWN'] as const)(
    'preserves the %s connection mode during reconciliation failure',
    (connectionMode) => {
      const item: MyRepository = {
        repositoryId: 'synthetic-repository',
        applicationId: 'synthetic-application',
        connectionMode,
        applicationMode: 'TEAM',
        programName: '합성 프로그램',
        displayName: '합성 팀',
        repositoryName: 'synthetic-repository',
        githubUrl: 'https://github.com/synthetic-org/synthetic-repository',
        provisionStatus: 'FAILED_RETRYABLE',
        invitationStatus:
          connectionMode === 'NEW' ? 'REVOKE_FAILED_RETRYABLE' : null,
        visibility: 'PRIVATE',
        lastErrorCode: 'GITHUB_UNAVAILABLE',
        updatedAt: new Date('2026-09-10T00:00:00.000Z'),
      };

      expect(MyRepositoriesResponseDto.from([item]).items).toEqual([
        { ...item, updatedAt: '2026-09-10T00:00:00.000Z' },
      ]);
    },
  );
});
