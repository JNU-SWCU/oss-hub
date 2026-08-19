import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAppClient } from './collection-app.client';
import { CollectionAppConfig } from './collection-app.config';
import { CollectionAppTokenProvider } from './collection-app.token';
import { CollectionCutoverRepository } from './repository/collection-cutover.repository';
import { CollectionDiscoveryClient } from './collection-discovery.client';
import { CollectionExternalDiscoveryService } from './service/collection-external-discovery.service';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { CollectionAdminController } from './controller/collection-admin.controller';
import { ContributionInvariants } from './contribution-invariants';
import { PublicRankingRepository } from './repository/public-ranking.repository';
import { CollectionAdminGuard } from './collection-admin.guard';
import { CollectionPublicTokenProvider } from './collection-public.token';
import { COLLECTION_READ_PORT } from './collection-read.port';
import { CollectionReadService } from './service/collection-read.service';
import { CollectionSchedulerService } from './service/collection-scheduler.service';
import { CollectionUserActivityService } from './service/collection-user-activity.service';
import { ProviderRequestQueue } from './collection-provider-queue';
import {
  CollectionSyncRuntime,
  CollectionSyncRuntimeFactory,
  CollectionSyncService,
} from './service/collection-sync.service';

/**
 * todo 14 원자 전환(ADR-006)으로 live writer는 `CollectionSyncService` 하나다 — 스케줄러/관리자
 * 트리거 모두 이 writer만 부른다. 전환 이후 한 릴리스 동안 rollback 참조용으로 남겨 두었던 old
 * canonical writer/전환 orchestration은 `Canonical*` 8개 테이블과 함께 제거됐다(ADR-006 "누적
 * 저장소로의 1회 전환" 5항의 후속 migration) — 되돌리기는 이전 릴리스 재배포 + 백업 restore라는
 * 순수 운영 절차다. `CollectionCutoverRepository`는 남는다 — 그건 별개 테이블(`CollectionCutoverLease`)
 * 의 quiesce 게이트이고 scheduler/admin 트리거가 매번 확인한다.
 */
@Module({
  imports: [ScheduleModule.forRoot(), AuditLogModule, AuthModule],
  controllers: [CollectionAdminController],
  providers: [
    CollectionAdminGuard,
    ContributionInvariants,
    PublicRankingRepository,
    CollectionSchedulerService,
    CollectionIncrementalRepository,
    CollectionCutoverRepository,
    CollectionReadService,
    { provide: COLLECTION_READ_PORT, useExisting: CollectionReadService },
    {
      // 외부 public 저장소 수집용 서비스 계정 PAT provider. GITHUB_PUBLIC_READ_TOKEN이
      // 없어도 이 factory 자체는 실패하지 않는다 — fail-closed 검증은
      // CollectionPublicTokenProvider.getToken() 최초 호출 시점으로 미룬다(조직
      // collection이 이 키 없이도 계속 동작해야 한다). 소비자는 아래
      // CollectionDiscoveryClient 하나뿐이다(E4).
      provide: CollectionPublicTokenProvider,
      inject: [RUNTIME_CONFIG],
      useFactory: (
        runtimeConfig: RuntimeConfig,
      ): CollectionPublicTokenProvider =>
        new CollectionPublicTokenProvider(runtimeConfig),
    },
    {
      // GraphQL `contributionsCollection` discovery client — 조직 밖 public
      // 저장소를 찾는 유일한 경로(E4). `CollectionPublicTokenProvider`가
      // 이 client의 `CollectionDiscoveryTokenProvider` 표면(getToken/clear)을
      // 구조적으로 만족한다 — `CollectionAppTokenProvider`(installation
      // JWT)는 이 client에 배선하지 않는다(client 자체 문서에 금지 명시).
      // `maxRepositories`는 GitHub GraphQL 스키마 기본값(25)보다 넉넉히 잡은
      // 안전한 상한이다(client 문서: 상한은 undocumented, 초과분은 GitHub
      // 오류로 그대로 전파된다).
      provide: CollectionDiscoveryClient,
      inject: [CollectionPublicTokenProvider],
      useFactory: (
        tokens: CollectionPublicTokenProvider,
      ): CollectionDiscoveryClient =>
        new CollectionDiscoveryClient({ maxRepositories: 50 }, tokens),
    },
    {
      // 학생 GitHub login → discovery → `GithubRepository`
      // `source: 'EXTERNAL_PUBLIC'` upsert(E4). `GITHUB_PUBLIC_READ_TOKEN`이
      // 없어도 이 provider 등록 자체는 실패하지 않는다 — fail-closed 검증은
      // `CollectionPublicTokenProvider.getToken()`을 거치는 첫 discovery 호출
      // 시점으로 미룬다(조직 collection이 이 키 없이도 계속 동작해야 한다는
      // 계약은 여기서도 동일하게 지킨다).
      provide: CollectionExternalDiscoveryService,
      inject: [
        PrismaService,
        CollectionIncrementalRepository,
        CollectionDiscoveryClient,
      ],
      useFactory: (
        prisma: PrismaService,
        incrementalRepository: CollectionIncrementalRepository,
        discoveryClient: CollectionDiscoveryClient,
      ): CollectionExternalDiscoveryService =>
        new CollectionExternalDiscoveryService(
          prisma,
          incrementalRepository,
          discoveryClient,
        ),
    },
    {
      // 사람 축(person-axis) 활동 수집 — 스케줄러·관리자 트리거의 세 번째 sweep.
      // 자격증명은 external discovery와 같은 `CollectionDiscoveryClient`(서비스
      // 계정 PAT)를 재사용한다 — installation token이 아니다.
      provide: CollectionUserActivityService,
      inject: [PrismaService, CollectionDiscoveryClient],
      useFactory: (
        prisma: PrismaService,
        discoveryClient: CollectionDiscoveryClient,
      ): CollectionUserActivityService =>
        new CollectionUserActivityService(prisma, discoveryClient),
    },
    {
      provide: CollectionSyncService,
      inject: [
        CollectionIncrementalRepository,
        RUNTIME_CONFIG,
        CollectionPublicTokenProvider,
      ],
      useFactory: (
        incrementalRepository: CollectionIncrementalRepository,
        runtimeConfig: RuntimeConfig,
        publicTokens: CollectionPublicTokenProvider,
      ): CollectionSyncService => {
        // Hoisted separately from `runtimeFactory` (rather than destructured
        // off its returned runtime, as before) because `CollectionSyncRuntime.tokens`
        // is now the narrow `CollectionAppClientTokenProvider` shape
        // (`collection-app.client.ts`) and no longer exposes
        // `getInstallationIdentity()`. `run()` always calls `runtimeFactory()`
        // before `resolveGithubOrganizationId()`, so in practice `orgTokens`
        // is already set by the time it's read below; the lazy fallback here
        // only guards a hypothetical standalone call.
        let orgTokens: CollectionAppTokenProvider | undefined;
        let runtime: CollectionSyncRuntime | undefined;
        const runtimeFactory: CollectionSyncRuntimeFactory = () => {
          if (runtime) return runtime;
          // Lazy: credentials validated on first run, not module bootstrap.
          const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
          orgTokens = new CollectionAppTokenProvider(config);
          const queue = new ProviderRequestQueue();
          runtime = {
            appId: config.appId,
            organizationLogin: config.orgLogin.toLowerCase(),
            tokens: orgTokens,
            client: new CollectionAppClient(
              config,
              orgTokens,
              queue.wrapFetcher(globalThis.fetch),
            ),
            queue,
          };
          return runtime;
        };
        const resolveGithubOrganizationId = async (): Promise<bigint> => {
          if (!orgTokens) {
            const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
            orgTokens = new CollectionAppTokenProvider(config);
          }
          const identity = await orgTokens.getInstallationIdentity();
          return BigInt(identity.organizationId);
        };
        // E1 — external (student-registered public repo) sweep runtime,
        // provisioned independently of the org runtime above. `client` is a
        // `CollectionAppClient` built from the org's existing
        // `CollectionAppConfigValues` — it reads only `apiBaseUrl`/
        // `maxPages`/`deadlineMs` off it, never `appId`/`orgLogin`/
        // `privateKey`, since `publicTokens` (a service-account PAT, not an
        // installation token) authenticates every request here. `queue` is
        // a NEW, separate `ProviderRequestQueue` — org and external
        // credentials carry independent 5,000/hr rate-limit budgets, so
        // sharing a queue would conflate them and needlessly pace external
        // requests behind org ones.
        let externalRuntime: CollectionSyncRuntime | undefined;
        const externalRuntimeFactory: CollectionSyncRuntimeFactory = () => {
          if (externalRuntime) return externalRuntime;
          const config = CollectionAppConfig.fromRuntimeConfig(runtimeConfig);
          const queue = new ProviderRequestQueue();
          externalRuntime = {
            appId: config.appId,
            organizationLogin: config.orgLogin.toLowerCase(),
            tokens: publicTokens,
            client: new CollectionAppClient(
              config,
              publicTokens,
              queue.wrapFetcher(globalThis.fetch),
            ),
            queue,
          };
          return externalRuntime;
        };
        return new CollectionSyncService(
          incrementalRepository,
          runtimeFactory,
          resolveGithubOrganizationId,
          undefined,
          undefined,
          externalRuntimeFactory,
        );
      },
    },
  ],
  exports: [COLLECTION_READ_PORT],
})
export class CollectionModule {}
