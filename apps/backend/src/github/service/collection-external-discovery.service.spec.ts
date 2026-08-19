import { AccountStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
} from '../collection-discovery.client';
import { CollectionExternalDiscoveryService } from './collection-external-discovery.service';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';

describe('CollectionExternalDiscoveryService', () => {
  const findFirst = jest.fn();
  const enrollExternalRepository = jest.fn();
  const discoverContributedRepositories = jest.fn();

  const now = () => new Date('2026-08-04T00:00:00.000Z');

  const buildService = (): CollectionExternalDiscoveryService =>
    new CollectionExternalDiscoveryService(
      { user: { findFirst } } as unknown as PrismaService,
      {
        enrollExternalRepository,
      } as unknown as CollectionIncrementalRepository,
      {
        discoverContributedRepositories,
      } as unknown as CollectionDiscoveryClient,
      now,
    );

  beforeEach(() => {
    findFirst.mockReset();
    enrollExternalRepository.mockReset();
    discoverContributedRepositories.mockReset();
  });

  it('활성 가입 학생을 찾아 discovery를 호출하고 신규 저장소를 EXTERNAL_PUBLIC으로 upsert한다', async () => {
    // Given: 활성 학생 계정 하나. 배경 수집 경로는 동의 테이블을 조회하지 않는다.
    findFirst.mockResolvedValue({ githubId: 424242n });
    discoverContributedRepositories.mockResolvedValue({
      repositories: [
        {
          databaseId: '900001',
          nameWithOwner: 'octocat/hello-world',
          ownerLogin: 'octocat',
          defaultBranch: 'main',
          archived: false,
        },
      ],
      restrictedContributionsCount: 0,
    });
    enrollExternalRepository.mockResolvedValue(true);
    const service = buildService();

    // When
    const result = await service.discoverForStudent('octocat');

    // Then: 학생 조회는 ACTIVE 계정만 대상으로 한다. 동의 확인은 이 배경
    // 수집 경로에서 제거됐다 — 온보딩 경로(roles·users·own-enrollment)가
    // 그대로 지키는 게이트이고, 여기서 두 번 묻지 않는다.
    expect(findFirst).toHaveBeenCalledWith({
      where: { nickname: 'octocat', accountStatus: AccountStatus.ACTIVE },
      select: { githubId: true },
    });
    expect(discoverContributedRepositories).toHaveBeenCalledWith(
      'octocat',
      expect.any(String),
      now().toISOString(),
    );
    // 저장 필드는 저장소 식별자·가시성·활동 메타뿐이다(ADR-006 field
    // inventory) — raw response/commit message/author email 등은 여기 없다.
    expect(enrollExternalRepository).toHaveBeenCalledWith({
      githubRepositoryId: 900001n,
      nameWithOwner: 'octocat/hello-world',
      defaultBranch: 'main',
      archived: false,
      observedAt: now(),
    });
    expect(result).toEqual({
      githubLogin: 'octocat',
      discoveredCount: 1,
      upsertedCount: 1,
      skippedOrgProvisionedCount: 0,
    });
  });

  it('이미 ORG_PROVISIONED로 관찰된 저장소는 덮어쓰지 않고 건너뛴다', async () => {
    // Given: discovery가 org sweep이 이미 관찰한 저장소를 함께 반환하는 경우
    // (학생이 조직 저장소에도 기여한 경우) — external 경로가 이를 덮어쓰면
    // githubOrganizationId가 null로 강등되는 데이터 손상이 생긴다.
    findFirst.mockResolvedValue({ githubId: 424242n });
    discoverContributedRepositories.mockResolvedValue({
      repositories: [
        {
          databaseId: '900002',
          nameWithOwner: 'JNU-SWCU/already-org-repo',
          ownerLogin: 'JNU-SWCU',
          defaultBranch: 'main',
          archived: false,
        },
      ],
      restrictedContributionsCount: 0,
    });
    enrollExternalRepository.mockResolvedValue(false);
    const service = buildService();

    // When
    const result = await service.discoverForStudent('octocat');

    // Then
    expect(enrollExternalRepository).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      githubLogin: 'octocat',
      discoveredCount: 1,
      upsertedCount: 0,
      skippedOrgProvisionedCount: 1,
    });
  });

  it('플랫폼에 등록된 학생을 찾지 못하면 COL_009로 거부하고 discovery를 호출하지 않는다', async () => {
    // Given
    findFirst.mockResolvedValue(null);
    const service = buildService();

    // When / Then
    await expect(
      service.discoverForStudent('unknown-login'),
    ).rejects.toMatchObject({
      errorCode: { code: 'COL_009', status: 404 },
    });
    expect(discoverContributedRepositories).not.toHaveBeenCalled();
  });

  it('동의 테이블을 조회하지 않고 ACTIVE 확인만으로 discovery를 진행한다', async () => {
    // Given: 동의 여부와 무관하게 배경 수집이 돈다 — 동의 게이트는 온보딩
    // 경로 전속이고, 이 경로가 그걸 두 번 묻지 않는다는 것이 이 스펙의 계약이다.
    const consent = { findFirst: jest.fn(), findMany: jest.fn() };
    const service = new CollectionExternalDiscoveryService(
      { user: { findFirst }, consent } as unknown as PrismaService,
      {
        enrollExternalRepository,
      } as unknown as CollectionIncrementalRepository,
      {
        discoverContributedRepositories,
      } as unknown as CollectionDiscoveryClient,
      now,
    );
    findFirst.mockResolvedValue({ githubId: 424242n });
    discoverContributedRepositories.mockResolvedValue({
      repositories: [],
      restrictedContributionsCount: 0,
    });

    // When
    await service.discoverForStudent('octocat');

    // Then
    expect(discoverContributedRepositories).toHaveBeenCalledTimes(1);
    expect(consent.findFirst).not.toHaveBeenCalled();
    expect(consent.findMany).not.toHaveBeenCalled();
  });

  it('discovery client 오류는 토큰을 노출하지 않고 COL_010으로 변환된다', async () => {
    // Given: discovery client 오류는 kind/retryAfterSeconds만 갖고 PAT 원문을
    // 담지 않는다(CollectionDiscoveryClientError 자체가 그렇게 설계돼 있다).
    findFirst.mockResolvedValue({ githubId: 424242n });
    discoverContributedRepositories.mockRejectedValue(
      new CollectionDiscoveryClientError('RATE_LIMITED', 30),
    );
    const service = buildService();

    // When / Then
    await expect(service.discoverForStudent('octocat')).rejects.toMatchObject({
      errorCode: { code: 'COL_010', status: 502 },
    });
    expect(enrollExternalRepository).not.toHaveBeenCalled();
  });

  it('discovery 결과가 비어 있으면 upsert 없이 0건 결과를 반환한다', async () => {
    // Given
    findFirst.mockResolvedValue({ githubId: 424242n });
    discoverContributedRepositories.mockResolvedValue({
      repositories: [],
      restrictedContributionsCount: 0,
    });
    const service = buildService();

    // When
    const result = await service.discoverForStudent('octocat');

    // Then
    expect(enrollExternalRepository).not.toHaveBeenCalled();
    expect(result).toEqual({
      githubLogin: 'octocat',
      discoveredCount: 0,
      upsertedCount: 0,
      skippedOrgProvisionedCount: 0,
    });
  });
});
