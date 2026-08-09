import { AccountStatus } from '@prisma/client';

import { DomainException } from '../../common/error-code';
import { ConsentsService } from '../../consents/consents.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
} from '../collection-discovery.client';
import { CollectionExternalDiscoveryService } from './collection-external-discovery.service';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';

describe('CollectionExternalDiscoveryService', () => {
  const findFirst = jest.fn();
  const requireCurrent = jest.fn();
  const findRepositoryByLogicalKey = jest.fn();
  const recordRepositoryObservation = jest.fn();
  const discoverContributedRepositories = jest.fn();

  const now = () => new Date('2026-08-04T00:00:00.000Z');

  const buildService = (): CollectionExternalDiscoveryService =>
    new CollectionExternalDiscoveryService(
      { user: { findFirst } } as unknown as PrismaService,
      { requireCurrent } as unknown as ConsentsService,
      {
        findRepositoryByLogicalKey,
        recordRepositoryObservation,
      } as unknown as CollectionIncrementalRepository,
      {
        discoverContributedRepositories,
      } as unknown as CollectionDiscoveryClient,
      now,
    );

  beforeEach(() => {
    findFirst.mockReset();
    requireCurrent.mockReset();
    findRepositoryByLogicalKey.mockReset();
    recordRepositoryObservation.mockReset();
    discoverContributedRepositories.mockReset();
  });

  it('활성·현재 정책 동의 학생을 찾아 discovery를 호출하고 신규 저장소를 EXTERNAL_PUBLIC으로 upsert한다', async () => {
    // Given: 활성 학생 계정과 현재 정책 동의(재사용 경로라 버전 문자열은 여기서 등장하지 않는다).
    findFirst.mockResolvedValue({ githubId: 424242n });
    requireCurrent.mockResolvedValue(undefined);
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
    findRepositoryByLogicalKey.mockResolvedValue(null);
    recordRepositoryObservation.mockResolvedValue(undefined);
    const service = buildService();

    // When
    const result = await service.discoverForStudent('octocat');

    // Then: 학생 조회는 ACTIVE 계정만 대상으로 하고, 동의 게이트는
    // ConsentsService.requireCurrent(githubId)로 위임한다 — 정책 버전 문자열을
    // 이 서비스가 직접 참조하지 않는다.
    expect(findFirst).toHaveBeenCalledWith({
      where: { nickname: 'octocat', accountStatus: AccountStatus.ACTIVE },
      select: { githubId: true },
    });
    expect(requireCurrent).toHaveBeenCalledWith(424242n);
    expect(discoverContributedRepositories).toHaveBeenCalledWith(
      'octocat',
      expect.any(String),
      now().toISOString(),
    );
    // 저장 필드는 저장소 식별자·가시성·활동 메타뿐이다(ADR-006 field
    // inventory) — raw response/commit message/author email 등은 여기 없다.
    expect(recordRepositoryObservation).toHaveBeenCalledWith({
      githubOrganizationId: null,
      githubRepositoryId: 900001n,
      nameWithOwner: 'octocat/hello-world',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'EXTERNAL_PUBLIC',
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
    requireCurrent.mockResolvedValue(undefined);
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
    findRepositoryByLogicalKey.mockResolvedValue({
      id: 'row-1',
      githubOrganizationId: 1n,
      githubRepositoryId: 900002n,
      nameWithOwner: 'JNU-SWCU/already-org-repo',
      defaultBranch: 'main',
      archived: false,
      visibility: 'PUBLIC',
      presence: 'PRESENT',
      source: 'ORG_PROVISIONED',
      lastCompleteInventoryObservedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const service = buildService();

    // When
    const result = await service.discoverForStudent('octocat');

    // Then
    expect(recordRepositoryObservation).not.toHaveBeenCalled();
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
    expect(requireCurrent).not.toHaveBeenCalled();
    expect(discoverContributedRepositories).not.toHaveBeenCalled();
  });

  it('현재 정책에 동의하지 않은 학생은 동의 게이트에서 거부되고 discovery를 호출하지 않는다', async () => {
    // Given: ConsentsService.requireCurrent 자체가 CON_003을 던진다 — 이 서비스가
    // 별도로 만든 동의 로직이 아니라 기존 경로를 그대로 재사용한다는 증거다.
    findFirst.mockResolvedValue({ githubId: 424242n });
    requireCurrent.mockRejectedValue(
      new DomainException({
        code: 'CON_003',
        status: 422,
        message: '필수 동의 항목이 모두 포함되어야 합니다.',
      }),
    );
    const service = buildService();

    // When / Then
    await expect(service.discoverForStudent('octocat')).rejects.toMatchObject({
      errorCode: { code: 'CON_003' },
    });
    expect(discoverContributedRepositories).not.toHaveBeenCalled();
  });

  it('discovery client 오류는 토큰을 노출하지 않고 COL_010으로 변환된다', async () => {
    // Given: discovery client 오류는 kind/retryAfterSeconds만 갖고 PAT 원문을
    // 담지 않는다(CollectionDiscoveryClientError 자체가 그렇게 설계돼 있다).
    findFirst.mockResolvedValue({ githubId: 424242n });
    requireCurrent.mockResolvedValue(undefined);
    discoverContributedRepositories.mockRejectedValue(
      new CollectionDiscoveryClientError('RATE_LIMITED', 30),
    );
    const service = buildService();

    // When / Then
    await expect(service.discoverForStudent('octocat')).rejects.toMatchObject({
      errorCode: { code: 'COL_010', status: 502 },
    });
    expect(recordRepositoryObservation).not.toHaveBeenCalled();
  });

  it('discovery 결과가 비어 있으면 upsert 없이 0건 결과를 반환한다', async () => {
    // Given
    findFirst.mockResolvedValue({ githubId: 424242n });
    requireCurrent.mockResolvedValue(undefined);
    discoverContributedRepositories.mockResolvedValue({
      repositories: [],
      restrictedContributionsCount: 0,
    });
    const service = buildService();

    // When
    const result = await service.discoverForStudent('octocat');

    // Then
    expect(recordRepositoryObservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      githubLogin: 'octocat',
      discoveredCount: 0,
      upsertedCount: 0,
      skippedOrgProvisionedCount: 0,
    });
  });
});
