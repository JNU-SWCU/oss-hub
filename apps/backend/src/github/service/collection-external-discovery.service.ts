import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';

import { DomainException } from '../../common/error-code';
import { ConsentsService } from '../../consents/consents.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
} from '../collection-discovery.client';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../collection-error-code.enum';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';

/**
 * GitHub GraphQL `contributionsCollection`의 하드 상한(1년)과 같은 폭으로 기본
 * 탐색 창을 잡는다 — 이보다 넓게 요청하면 discovery client가 GraphQL 검증
 * 오류로 실패한다(`.omc/plans/adr-006-amendment-external-collection.md`).
 */
const DEFAULT_DISCOVERY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export interface DiscoverExternalRepositoriesResult {
  readonly githubLogin: string;
  readonly discoveredCount: number;
  readonly upsertedCount: number;
  /** 이미 `ORG_PROVISIONED`로 관찰된 저장소는 덮어쓰지 않고 건너뛴 개수. */
  readonly skippedOrgProvisionedCount: number;
}

/**
 * 학생의 GitHub login으로 GraphQL discovery를 호출해 조직 밖 public 저장소를
 * 찾아 `GithubRepository`에 `source: 'EXTERNAL_PUBLIC'`으로 적재한다(ADR-006
 * 단계 E4). 저장 필드는 discovery client가 반환하는 저장소 식별자·가시성·
 * 기본 브랜치·archived 여부뿐이다 — raw 응답·코드·commit message·author
 * email·PR/release 본문·사용자 프로필 등은 애초에 discovery client가 반환하지
 * 않으므로 이 서비스도 저장할 수 없다(ADR-006 저장·폐기 field inventory,
 * `source`와 무관하게 동일 적용).
 *
 * 실행마다 다음 두 게이트를 통과해야 한다:
 * 1. 대상 학생이 **현재** 동의 정책 버전(`CURRENT_CONSENT_POLICY.policyVersion`,
 *    하드코딩 금지)에 동의했어야 한다 — `ConsentsService.requireCurrent`를
 *    그대로 재사용한다(GR-14 활성화 게이트).
 * 2. private 저장소는 discovery client가 이미 필터링한다
 *    (`collection-discovery.client.ts`의 `!r.isPrivate` 필터) — 이 서비스는
 *    client가 돌려준 결과를 그대로 신뢰한다.
 */
@Injectable()
export class CollectionExternalDiscoveryService {
  private readonly logger = new Logger(CollectionExternalDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentsService,
    private readonly incrementalRepository: CollectionIncrementalRepository,
    private readonly discoveryClient: CollectionDiscoveryClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async discoverForStudent(
    githubLogin: string,
  ): Promise<DiscoverExternalRepositoriesResult> {
    await this.requireConsentedStudent(githubLogin);

    const to = this.now();
    const from = new Date(to.getTime() - DEFAULT_DISCOVERY_WINDOW_MS);

    const result = await this.discover(githubLogin, from, to);

    const observedAt = this.now();
    let upsertedCount = 0;
    let skippedOrgProvisionedCount = 0;
    for (const repository of result.repositories) {
      const githubRepositoryId = BigInt(repository.databaseId);
      // ORG 우선순위 판정과 external 갱신을 같은 DB transaction 안에서
      // 처리한다. 조회 후 별도 upsert를 하면 그 사이 org sweep이 들어와도
      // EXTERNAL_PUBLIC으로 다시 덮어쓰는 TOCTOU가 생긴다.
      const enrolled =
        await this.incrementalRepository.enrollExternalRepository({
          githubRepositoryId,
          nameWithOwner: repository.nameWithOwner,
          defaultBranch: repository.defaultBranch,
          archived: repository.archived,
          observedAt,
        });
      if (enrolled) upsertedCount += 1;
      else skippedOrgProvisionedCount += 1;
    }

    this.logger.log({
      event: 'collection.external_discovery.completed',
      githubLogin,
      discoveredCount: result.repositories.length,
      upsertedCount,
      skippedOrgProvisionedCount,
    });

    return {
      githubLogin,
      discoveredCount: result.repositories.length,
      upsertedCount,
      skippedOrgProvisionedCount,
    };
  }

  private async discover(githubLogin: string, from: Date, to: Date) {
    try {
      return await this.discoveryClient.discoverContributedRepositories(
        githubLogin,
        from.toISOString(),
        to.toISOString(),
      );
    } catch (error) {
      // discovery client 오류는 PAT 원문을 포함하지 않는다(kind/재시도-후
      // 초 단위만 갖는다) — 그대로 로그에 실어도 토큰이 새지 않는다.
      const kind =
        error instanceof CollectionDiscoveryClientError
          ? error.kind
          : 'UNKNOWN';
      this.logger.error({
        event: 'collection.external_discovery.failed',
        githubLogin,
        kind,
      });
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.EXTERNAL_DISCOVERY_FAILED],
      );
    }
  }

  /**
   * login → githubId 매핑은 이 서비스 고유의 새 조회다(기존 저장소 어디에도
   * login 기반 조회가 없다). 이후 ACTIVE·동의 여부 판정은 여기서 다시 만들지
   * 않고 `ConsentsService.requireCurrent`에 위임한다 — 정책 버전 문자열은
   * 그 안에서 `CURRENT_CONSENT_POLICY.policyVersion`으로만 참조된다.
   */
  private async requireConsentedStudent(githubLogin: string): Promise<bigint> {
    const user = await this.prisma.user.findFirst({
      where: { nickname: githubLogin, accountStatus: AccountStatus.ACTIVE },
      select: { githubId: true },
    });
    if (!user) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.EXTERNAL_STUDENT_NOT_FOUND],
      );
    }
    await this.consents.requireCurrent(user.githubId);
    return user.githubId;
  }
}
