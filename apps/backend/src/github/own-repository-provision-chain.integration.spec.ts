import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ApplicationsErrorCode } from '../applications/applications-error-code.enum';
import { ApplicationsStaffGuard } from '../applications/applications-staff.guard';
import { ApplicationsRepository } from '../applications/applications.repository';
import { ApplicationsService } from '../applications/applications.service';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConsentsRepository } from '../consents/consents.repository';
import { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  GithubAppClient,
  GithubPublicRepositoryMetadata,
  GithubRepositoryMetadata,
} from './github-app.client';
import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { RepositoriesRepository } from './repository/repositories.repository';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionStateRepository } from './repository/repository-provision-state.repository';
import { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { RepositoryOwnEnrollmentService } from './service/repository-own-enrollment.service';
import { OwnRepositoryUrlValidationService } from './service/own-repository-url-validation.service';

// allow: SIZE_OK — OWN 저장소 승인→편입 사슬이 하나의 격리 PostgreSQL lifecycle을 공유한다.
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

// 이 스펙은 applications 승인 판정과 github 편입 worker를 잇는 사슬을 검증한다.
// applications/domain의 승인 액션(현재 리터럴 'APPROVE')은 github zone의
// module-zone-boundary(ADR-003 DEC-42) 아래서 internalDirs로 막혀 import할 수
// 없으므로, decide()의 contextual typing에 맡겨 리터럴을 그대로 쓴다.
const prisma = new PrismaService();
const repository = new ApplicationsRepository(prisma, {
  TEAM_JOIN_CODE_SECRET: 'synthetic-own-provision-chain-secret',
});
const service = new ApplicationsService(
  repository,
  new AuditLogService(new AuditLogRepository(prisma)),
);
const staffGuard = new ApplicationsStaffGuard(prisma);
const outbox = new RepositoryOutboxConsumer(new RepositoriesRepository(prisma));
const jobs = new RepositoryProvisionJobRepository(prisma);
const state = new RepositoryProvisionStateRepository(prisma);

const STAFF_ACTOR_ID = 'synthetic-own-chain-staff';
const STAFF_GITHUB_ID = 8_400_000_000_001n;
const STUDENT_ACTOR_ID = 'synthetic-own-chain-student-actor';
const STUDENT_ACTOR_GITHUB_ID = 8_400_000_000_002n;
const APPLICANT_ID = 'synthetic-own-chain-applicant';
const APPLICANT_GITHUB_ID = 8_400_000_000_003n;
const NO_CONSENT_APPLICANT_ID = 'synthetic-own-chain-no-consent-applicant';
const NO_CONSENT_APPLICANT_GITHUB_ID = 8_400_000_000_004n;
const ORG_OWN_APPLICANT_ID = 'synthetic-own-chain-org-applicant';
const ORG_OWN_APPLICANT_GITHUB_ID = 8_400_000_000_005n;
// #9 QA econovation 배치 — 제출 시점 URL 사전 검증 감사용 신청자.
const PRECHECK_APPLICANT_ID = 'synthetic-own-chain-precheck-applicant';
const PRECHECK_APPLICANT_GITHUB_ID = 8_400_000_000_006n;
// #9 QA econovation 배치 — 외부 ORGANIZATION이 소유한(Econovation식) 공개
// repo를 자기 계정(nickname)과 다른 조직 이름으로 제출하는 신청자 — owner가
// 신청자 자신의 개인 GitHub 계정이 아니라 제3자 org라는 점이 CHAIN_APPLICATION_ID
// 시나리오(신청자 자신의 repo)와 갈린다.
const ORG_OWNER_EXTERNAL_APPLICANT_ID =
  'synthetic-own-chain-org-owner-external-applicant';
const ORG_OWNER_EXTERNAL_APPLICANT_GITHUB_ID = 8_400_000_000_007n;

const CHAIN_APPLICATION_ID = 'synthetic-own-chain-application';
const NO_CONSENT_APPLICATION_ID = 'synthetic-own-chain-no-consent-application';
const ORG_OWN_APPLICATION_ID = 'synthetic-own-chain-org-application';
const PRECHECK_MISSING_APPLICATION_ID =
  'synthetic-own-chain-precheck-missing-application';
const PRECHECK_PRIVATE_APPLICATION_ID =
  'synthetic-own-chain-precheck-private-application';
const ORG_OWNER_EXTERNAL_APPLICATION_ID =
  'synthetic-own-chain-org-owner-external-application';
const APPLICATION_IDS = [
  CHAIN_APPLICATION_ID,
  NO_CONSENT_APPLICATION_ID,
  ORG_OWN_APPLICATION_ID,
  PRECHECK_MISSING_APPLICATION_ID,
  PRECHECK_PRIVATE_APPLICATION_ID,
  ORG_OWNER_EXTERNAL_APPLICATION_ID,
] as const;

const OWN_GITHUB_REPOSITORY_ID = 8_520_100_001n;
const OWN_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-repo';
const OWN_REPOSITORY_URL = `https://github.com/${OWN_NAME_WITH_OWNER}`;

const NO_CONSENT_GITHUB_REPOSITORY_ID = 8_520_100_002n;
const NO_CONSENT_NAME_WITH_OWNER =
  'synthetic-own-chain-student/synthetic-own-chain-no-consent-repo';
const NO_CONSENT_REPOSITORY_URL = `https://github.com/${NO_CONSENT_NAME_WITH_OWNER}`;

// mock github client의 organization과 같아야 ORGANIZATION 경로로 판정된다
// (resolveOwnGithubRepository — repository-provision.github.ts:47).
const ORG_OWN_ORGANIZATION = 'synthetic-own-chain-org';
const ORG_GITHUB_REPOSITORY_ID = 8_520_100_003n;
const ORG_OWN_NAME_WITH_OWNER = `${ORG_OWN_ORGANIZATION}/synthetic-own-chain-org-repo`;
const ORG_OWN_REPOSITORY_URL = `https://github.com/${ORG_OWN_NAME_WITH_OWNER}`;

// #9 QA econovation 배치 — 실제 계획의 Econovation 2026 외부 org 이름(JNU-econovation)을
// 본뗐 시나리오로 쓴다 — 이 organization은 mock github client의 organization도,
// 신청자의 nickname도 아닌 제3자라서 ORGANIZATION 경로(findRepository)가 아닌
// EXTERNAL 경로(findPublicRepository)로만 판정된다.
const ECONOVATION_ORGANIZATION = 'JNU-econovation';
const ECONOVATION_GITHUB_REPOSITORY_ID = 8_520_100_004n;
const ECONOVATION_NAME_WITH_OWNER = `${ECONOVATION_ORGANIZATION}/eco-knock-be-central`;
const ECONOVATION_REPOSITORY_URL = `https://github.com/${ECONOVATION_NAME_WITH_OWNER}`;

type ProvisionGithubClient = jest.Mocked<
  Pick<
    GithubAppClient,
    | 'findRepository'
    | 'createRepository'
    | 'ensureCollaborator'
    | 'findPublicRepository'
    | 'organization'
  >
>;

describe('OWN 저장소 연결·생성 사슬 통합', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: STAFF_ACTOR_ID,
          githubId: STAFF_GITHUB_ID,
          nickname: 'synthetic-own-chain-staff',
          role: Role.STAFF,
        },
        {
          id: STUDENT_ACTOR_ID,
          githubId: STUDENT_ACTOR_GITHUB_ID,
          nickname: 'synthetic-own-chain-student-actor',
          role: Role.STUDENT,
        },
        {
          id: APPLICANT_ID,
          githubId: APPLICANT_GITHUB_ID,
          nickname: 'synthetic-own-chain-applicant',
          role: Role.STUDENT,
        },
        {
          id: NO_CONSENT_APPLICANT_ID,
          githubId: NO_CONSENT_APPLICANT_GITHUB_ID,
          // github 로그인 형식 계약(39자 이하, 영소문자/숫자/하이픈)을 지킨다 —
          // outbox payload의 collaboratorGithubLogins가 이 nickname으로 채워지고
          // RepositoryOutboxConsumer가 그 계약을 검증한다.
          nickname: 'synthetic-own-chain-no-consent',
          role: Role.STUDENT,
        },
        {
          id: ORG_OWN_APPLICANT_ID,
          githubId: ORG_OWN_APPLICANT_GITHUB_ID,
          nickname: 'synthetic-own-chain-org-applicant',
          role: Role.STUDENT,
        },
        {
          id: PRECHECK_APPLICANT_ID,
          githubId: PRECHECK_APPLICANT_GITHUB_ID,
          nickname: 'synthetic-own-chain-precheck-applicant',
          role: Role.STUDENT,
        },
        {
          id: ORG_OWNER_EXTERNAL_APPLICANT_ID,
          githubId: ORG_OWNER_EXTERNAL_APPLICANT_GITHUB_ID,
          // 신청자의 개인 GitHub 계정(nickname)이 외부 org(ECONOVATION_ORGANIZATION)와
          // 다르다는 것이 이 시나리오의 핵심이다 — repo owner는 신청자가 아니라
          // 팀/대회 조직이다.
          nickname: 'synthetic-own-chain-org-owner-external',
          role: Role.STUDENT,
        },
      ],
    });
    // 편입은 현재 동의를 요구한다(RepositoryOwnEnrollmentService) — 정책 버전은
    // 서비스가 알려주는 값을 쓴다. 상수를 복사하면 정책이 올라갈 때 이 스펙만
    // 조용히 옛 버전을 붙들고 통과한다.
    const { policy } = await new ConsentsService(
      new ConsentsRepository(prisma),
    ).getCurrent(APPLICANT_GITHUB_ID);
    await prisma.consent.create({
      data: { userId: APPLICANT_ID, policyVersion: policy.policyVersion },
    });
    await prisma.consent.create({
      data: {
        userId: ORG_OWNER_EXTERNAL_APPLICANT_ID,
        policyVersion: policy.policyVersion,
      },
    });
    // NO_CONSENT_APPLICANT_ID는 의도적으로 동의 행을 만들지 않는다.
  });

  afterEach(async () => {
    await prisma.githubRepository.deleteMany({
      where: {
        githubRepositoryId: {
          in: [
            OWN_GITHUB_REPOSITORY_ID,
            NO_CONSENT_GITHUB_REPOSITORY_ID,
            ORG_GITHUB_REPOSITORY_ID,
            ECONOVATION_GITHUB_REPOSITORY_ID,
          ],
        },
      },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    // #617 단계 D 이후 applicationId로 만든 행과 githubRepositoryId로 만든 행이
    // 같은 GithubRepository 테이블의 같은 행이다 — 위에서 이미 지웠으므로 여기서
    // applicationId로 다시 지우는 건 중복이다(비어 있는 deleteMany는 안전한 no-op).
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.notification.deleteMany({
      where: { type: 'APPLICATION_DECISION' },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({
      where: { id: { in: APPLICATION_IDS.map((id) => `${id}-team-member`) } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(teamIdFor) } },
    });
    await prisma.program.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(programIdFor) } },
    });
  });

  afterAll(async () => {
    await prisma.consent.deleteMany({
      where: {
        userId: { in: [APPLICANT_ID, ORG_OWNER_EXTERNAL_APPLICANT_ID] },
      },
    });
    // #547 이후 판정이 AuditLog 행을 남긴다 — append-only 트리거가 삭제를 막고
    // actor를 FK(restrict)로 잡으므로 합성 사용자는 지우지 않는다. 통합 DB는
    // run마다 버려지는 컨테이너다.
    await prisma.$disconnect();
  });

  describe('ApplicationsStaffGuard', () => {
    it('실 DB의 STAFF actor를 허용하고 처리자 ID를 붙인다', async () => {
      const request: { sessionGithubId: bigint; applicationActorId?: string } =
        { sessionGithubId: STAFF_GITHUB_ID };
      const context = new ExecutionContextHost([request]);
      context.setType('http');

      await expect(staffGuard.canActivate(context)).resolves.toBe(true);
      expect(request.applicationActorId).toBe(STAFF_ACTOR_ID);
    });

    it('실 DB의 STUDENT actor를 판정 전용 403으로 거부한다', async () => {
      const context = new ExecutionContextHost([
        { sessionGithubId: STUDENT_ACTOR_GITHUB_ID },
      ]);
      context.setType('http');

      await expect(staffGuard.canActivate(context)).rejects.toMatchObject({
        errorCode: { code: ApplicationsErrorCode.STAFF_ONLY, status: 403 },
      });
    });
  });

  it(
    '권한 확인→승인 판정→outbox 소비→worker 편입까지 실 DB로 완주해 ' +
      'owner/repo와 defaultBranch를 가진 수집 행을 남긴다',
    async () => {
      // Given — STAFF actor가 권한 확인을 통과하고, OWN 신청이 승인 대기 중이다.
      const guardRequest: { sessionGithubId: bigint } = {
        sessionGithubId: STAFF_GITHUB_ID,
      };
      const guardContext = new ExecutionContextHost([guardRequest]);
      guardContext.setType('http');
      await expect(staffGuard.canActivate(guardContext)).resolves.toBe(true);

      await createOwnApplication(
        CHAIN_APPLICATION_ID,
        APPLICANT_ID,
        OWN_REPOSITORY_URL,
      );

      // When — 실 서비스로 승인 판정을 내린다.
      const decision = await service.decide(
        STAFF_ACTOR_ID,
        CHAIN_APPLICATION_ID,
        STAFF_GITHUB_ID,
        { action: 'APPROVE' },
      );

      // Then — outbox 이벤트가 생겼다.
      expect(decision.kind).toBe('APPROVED');
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({
          where: {
            idempotencyKey: `repository-provision:${CHAIN_APPLICATION_ID}`,
          },
        }),
      ).resolves.toMatchObject({ status: 'PENDING' });

      // When — outbox를 job으로 소비한다.
      await expect(
        outbox.consumeNext('own-chain-outbox-worker', new Date()),
      ).resolves.toMatchObject({ kind: 'CONSUMED' });

      // When — worker가 job을 처리한다(GitHub 경계만 mock, 편입 서비스는 real+real DB).
      const github = githubClient();
      github.findPublicRepository.mockResolvedValue(
        ownRepositoryMetadata(OWN_GITHUB_REPOSITORY_ID, OWN_NAME_WITH_OWNER),
      );
      const worker = new RepositoryProvisionWorker(
        jobs,
        state,
        github,
        ownEnrollment(),
      );
      const result = await worker.runNext(
        'own-chain-provision-worker',
        new Date(),
      );

      // Then — 편입 서비스가 owner/repo, defaultBranch를 가진 수집 행을 real DB에 남긴다.
      expect(result.kind).toBe('SUCCEEDED');
      await expect(
        prisma.githubRepository.findFirstOrThrow({
          where: { githubRepositoryId: OWN_GITHUB_REPOSITORY_ID },
        }),
      ).resolves.toMatchObject({
        source: 'EXTERNAL_PUBLIC',
        nameWithOwner: OWN_NAME_WITH_OWNER,
        defaultBranch: 'main',
        presence: 'PRESENT',
      });
      // recordRepository(provision)와 enrollExternalRepository(수집 관찰)가
      // applicationId/githubRepositoryId로 각각 찾아도 같은 통합 행으로 수렴한다.
      await expect(
        prisma.githubRepository.findUniqueOrThrow({
          where: { applicationId: CHAIN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        githubRepositoryId: OWN_GITHUB_REPOSITORY_ID,
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { applicationId: CHAIN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
  );

  it(
    'Econovation식 외부 ORGANIZATION이 소유한 공개 repo(신청자 개인 계정과 다른 owner)로 ' +
      'OWN 지원 → 승인 → worker 편입까지 완주해 EXTERNAL_PUBLIC 행을 남긴다',
    async () => {
      // Given — repo owner(JNU-econovation)가 신청자의 GitHub 로그인·설정된
      // 내부 org(synthetic-own-chain-org) 어느 쪽과도 다른 제3자 조직이다.
      await createOwnApplication(
        ORG_OWNER_EXTERNAL_APPLICATION_ID,
        ORG_OWNER_EXTERNAL_APPLICANT_ID,
        ECONOVATION_REPOSITORY_URL,
      );

      // When — 실 서비스로 승인 판정을 내린다.
      const decision = await service.decide(
        STAFF_ACTOR_ID,
        ORG_OWNER_EXTERNAL_APPLICATION_ID,
        STAFF_GITHUB_ID,
        { action: 'APPROVE' },
      );
      expect(decision.kind).toBe('APPROVED');

      // When — outbox를 job으로 소비한다.
      await expect(
        outbox.consumeNext(
          'own-chain-org-owner-external-outbox-worker',
          new Date(),
        ),
      ).resolves.toMatchObject({ kind: 'CONSUMED' });

      // When — worker가 job을 처리한다. owner가 설정된 조직과 다르므로
      // findPublicRepository(EXTERNAL 경로)만 호출되고 findRepository(ORGANIZATION
      // 경로)는 호출되지 않는다.
      const github = githubClient();
      github.findPublicRepository.mockResolvedValue(
        ownRepositoryMetadata(
          ECONOVATION_GITHUB_REPOSITORY_ID,
          ECONOVATION_NAME_WITH_OWNER,
        ),
      );
      const worker = new RepositoryProvisionWorker(
        jobs,
        state,
        github,
        ownEnrollment(),
      );
      const result = await worker.runNext(
        'own-chain-org-owner-external-provision-worker',
        new Date(),
      );

      // Then — 외부 org 소유 공개 repo가 EXTERNAL_PUBLIC 수집 대상으로 등록된다
      // (전역 랭킹·수집 스윕이 재사용하는 것과 같은 source 값).
      expect(result.kind).toBe('SUCCEEDED');
      expect(github.findRepository).not.toHaveBeenCalled();
      expect(github.findPublicRepository).toHaveBeenCalledWith(
        ECONOVATION_ORGANIZATION,
        'eco-knock-be-central',
      );
      await expect(
        prisma.githubRepository.findFirstOrThrow({
          where: { githubRepositoryId: ECONOVATION_GITHUB_REPOSITORY_ID },
        }),
      ).resolves.toMatchObject({
        source: 'EXTERNAL_PUBLIC',
        nameWithOwner: ECONOVATION_NAME_WITH_OWNER,
        defaultBranch: 'main',
        presence: 'PRESENT',
        applicationId: ORG_OWNER_EXTERNAL_APPLICATION_ID,
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { applicationId: ORG_OWNER_EXTERNAL_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
  );

  it('현재 동의가 없으면 job은 재시도 가능 실패로 끝나고 수집 관찰 필드는 채워지지 않는다', async () => {
    // Given — 동의 없는 신청자의 OWN 신청이 승인되어 job까지 만들어졌다.
    await createOwnApplication(
      NO_CONSENT_APPLICATION_ID,
      NO_CONSENT_APPLICANT_ID,
      NO_CONSENT_REPOSITORY_URL,
    );
    await service.decide(
      STAFF_ACTOR_ID,
      NO_CONSENT_APPLICATION_ID,
      STAFF_GITHUB_ID,
      { action: 'APPROVE' },
    );
    await expect(
      outbox.consumeNext('own-chain-no-consent-outbox-worker', new Date()),
    ).resolves.toMatchObject({ kind: 'CONSUMED' });
    const github = githubClient();
    github.findPublicRepository.mockResolvedValue(
      ownRepositoryMetadata(
        NO_CONSENT_GITHUB_REPOSITORY_ID,
        NO_CONSENT_NAME_WITH_OWNER,
      ),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      ownEnrollment(),
    );

    // When
    const result = await worker.runNext(
      'own-chain-no-consent-provision-worker',
      new Date(),
    );

    // Then — 동의 선행조건(RepositoryOwnEnrollmentService.requireCurrent)에 막혀
    // job은 재시도 가능 실패로 끝난다. recordRepository(provision)는 동의 확인보다
    // 먼저 실행되고 #617 단계 D 이후로는 provision과 수집 관찰이 같은
    // GithubRepository 행을 쓰므로, 행 자체는 만들어진다 — 다만 뒤이은
    // enrollExternalRepository가 동의 부재로 던지면서 수집 관찰 필드는 생성
    // 시점 기본값(defaultBranch: null 등)에 머문다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    await expect(
      prisma.githubRepository.findFirstOrThrow({
        where: { githubRepositoryId: NO_CONSENT_GITHUB_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({
      applicationId: NO_CONSENT_APPLICATION_ID,
      source: 'EXTERNAL_PUBLIC',
      defaultBranch: null,
      lastSuccessAt: null,
    });
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId: NO_CONSENT_APPLICATION_ID },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
    });
  });

  it(
    'org sweep이 먼저 applicationId:null로 관찰해 둔 저장소를 OWN+ORGANIZATION ' +
      '연결이 채택해 성공한다(#617 단계 D 회귀 — recordRepository가 applicationId ' +
      '기준으로만 upsert하면 githubRepositoryId unique 제약과 충돌해 항상 실패했다)',
    async () => {
      // Given — org 전체 sweep(collection-sync.service.ts)이 이 조직 저장소를
      // 이미 관찰해 applicationId: null인 GithubRepository 행을 만들어 놨다.
      await prisma.githubRepository.create({
        data: {
          githubRepositoryId: ORG_GITHUB_REPOSITORY_ID,
          nameWithOwner: ORG_OWN_NAME_WITH_OWNER,
          defaultBranch: null,
          archived: false,
          visibility: RepositoryVisibility.PRIVATE,
          source: 'ORG_PROVISIONED',
          presence: 'PRESENT',
        },
      });

      await createOwnApplication(
        ORG_OWN_APPLICATION_ID,
        ORG_OWN_APPLICANT_ID,
        ORG_OWN_REPOSITORY_URL,
      );
      await service.decide(
        STAFF_ACTOR_ID,
        ORG_OWN_APPLICATION_ID,
        STAFF_GITHUB_ID,
        { action: 'APPROVE' },
      );
      await expect(
        outbox.consumeNext('own-chain-org-outbox-worker', new Date()),
      ).resolves.toMatchObject({ kind: 'CONSUMED' });

      // When — worker가 job을 처리한다. ORGANIZATION 경로는 findRepository로 해석되고,
      // 동의 확인(enrollExternalRepository)은 EXTERNAL 경로에서만 일어나므로 여기선
      // consent 행이 없어도 된다.
      const github = githubClient();
      github.findRepository.mockResolvedValue(
        orgRepositoryMetadata(
          ORG_GITHUB_REPOSITORY_ID,
          ORG_OWN_NAME_WITH_OWNER,
        ),
      );
      const worker = new RepositoryProvisionWorker(
        jobs,
        state,
        github,
        ownEnrollment(),
      );
      const result = await worker.runNext(
        'own-chain-org-provision-worker',
        new Date(),
      );

      // Then — 새 행을 만드는 대신 sweep이 만든 행을 채택해 성공한다.
      expect(result.kind).toBe('SUCCEEDED');
      await expect(
        prisma.githubRepository.findUniqueOrThrow({
          where: { githubRepositoryId: ORG_GITHUB_REPOSITORY_ID },
        }),
      ).resolves.toMatchObject({
        applicationId: ORG_OWN_APPLICATION_ID,
        source: 'ORG_PROVISIONED',
        presence: 'PRESENT',
      });
      await expect(
        prisma.repositoryProvisionJob.findUniqueOrThrow({
          where: { applicationId: ORG_OWN_APPLICATION_ID },
        }),
      ).resolves.toMatchObject({
        status: RepositoryProvisionJobStatus.SUCCEEDED,
      });
    },
  );
  describe('제출 시점 URL 사전 검증 — 승인 시점 편입 판정과 같은 GitHub 경계 규칙을 재사용한다', () => {
    it('존재하지 않는 외부 저장소 URL은 신청 제출 시점에 repositoryUrl 필드 오류로 거부되고 Application 행을 만들지 않는다', async () => {
      // Given — 열린 프로그램과 팀에 소속된 학생, GitHub에 없는 저장소 URL.
      const programId = programIdFor(PRECHECK_MISSING_APPLICATION_ID);
      await createOpenOwnProgram(PRECHECK_MISSING_APPLICATION_ID);
      const github = githubClient();
      github.findPublicRepository.mockResolvedValue(null);
      const precheckService = new ApplicationsService(
        repository,
        new AuditLogService(new AuditLogRepository(prisma)),
        new OwnRepositoryUrlValidationService(github),
      );

      // When
      const attempt = precheckService.create(
        PRECHECK_APPLICANT_GITHUB_ID,
        programId,
        {
          answers: { title: '제목', summary: '요약' },
          teamName: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          repositoryUrl:
            'https://github.com/synthetic-missing-org/synthetic-missing-repo',
        },
        new Date('2026-07-15T00:00:00.000Z'),
      );

      // Then
      await expect(attempt).rejects.toMatchObject({
        errorCode: {
          code: ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE,
          status: 400,
        },
        extensions: {
          fieldErrors: [expect.objectContaining({ field: 'repositoryUrl' })],
        },
      });
      await expect(
        prisma.application.count({ where: { programId } }),
      ).resolves.toBe(0);
    });

    it('비공개 외부 저장소 URL도 승인에 도달하지 못하고 제출 시점에 거부된다', async () => {
      // Given
      const programId = programIdFor(PRECHECK_PRIVATE_APPLICATION_ID);
      await createOpenOwnProgram(PRECHECK_PRIVATE_APPLICATION_ID);
      const github = githubClient();
      github.findPublicRepository.mockResolvedValue({
        githubRepositoryId: 8_520_100_099n,
        nameWithOwner: 'synthetic-private-org/synthetic-private-repo',
        defaultBranch: 'main',
        archived: false,
        name: 'synthetic-private-repo',
        url: 'https://github.com/synthetic-private-org/synthetic-private-repo',
        visibility: RepositoryVisibility.PRIVATE,
        description: null,
      });
      const precheckService = new ApplicationsService(
        repository,
        new AuditLogService(new AuditLogRepository(prisma)),
        new OwnRepositoryUrlValidationService(github),
      );

      // When
      const attempt = precheckService.create(
        PRECHECK_APPLICANT_GITHUB_ID,
        programId,
        {
          answers: { title: '제목', summary: '요약' },
          teamName: null,
          applicationTemplateVersion: 1,
          isRepositoryPublicationPlanned: true,
          repositoryConnectionMode: RepositoryConnectionMode.OWN,
          repositoryUrl:
            'https://github.com/synthetic-private-org/synthetic-private-repo',
        },
        new Date('2026-07-15T00:00:00.000Z'),
      );

      // Then
      await expect(attempt).rejects.toMatchObject({
        errorCode: {
          code: ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE,
        },
      });
      await expect(
        prisma.application.count({ where: { programId } }),
      ).resolves.toBe(0);
    });
  });
});

function programIdFor(applicationId: string): string {
  return `${applicationId}-program`;
}

function teamIdFor(applicationId: string): string {
  return `${applicationId}-team`;
}

async function createOwnApplication(
  applicationId: string,
  applicantId: string,
  repositoryUrl: string,
): Promise<void> {
  const programId = programIdFor(applicationId);
  const teamId = teamIdFor(applicationId);
  await prisma.program.create({
    data: {
      id: programId,
      name: `program-${applicationId}`,
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId,
      name: `team-${applicationId}`,
      joinCodeDigest: `digest-${applicationId}`,
      leaderId: applicantId,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: `${applicationId}-team-member`,
      teamId,
      programId,
      userId: applicantId,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId,
      applicantId,
      teamId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl,
    },
  });
}

/**
 * `createOwnApplication`과 달리 Application은 물론 Team도 미리 만들지 않는다 —
 * 제출 시점 검증은 `ApplicationsService.create()`가 직접 1인 팀을 만들면서
 * 일어나는 일이라, 열린 프로그램만 선행해 준비한다.
 */
async function createOpenOwnProgram(applicationId: string): Promise<void> {
  const programId = programIdFor(applicationId);
  await prisma.program.create({
    data: {
      id: programId,
      name: `program-${applicationId}`,
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
    },
  });
}

function ownEnrollment(): RepositoryOwnEnrollmentService {
  return new RepositoryOwnEnrollmentService(
    new ConsentsService(new ConsentsRepository(prisma)),
    new CollectionIncrementalRepository(prisma),
  );
}

function githubClient(): ProvisionGithubClient {
  return {
    findRepository: jest.fn().mockResolvedValue(null),
    createRepository: jest.fn(),
    ensureCollaborator: jest.fn(),
    findPublicRepository: jest.fn().mockResolvedValue(null),
    organization: 'synthetic-own-chain-org',
  };
}

function ownRepositoryMetadata(
  githubRepositoryId: bigint,
  nameWithOwner: string,
): GithubPublicRepositoryMetadata {
  return {
    githubRepositoryId,
    nameWithOwner,
    defaultBranch: 'main',
    archived: false,
    name: nameWithOwner.split('/')[1] ?? nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    visibility: RepositoryVisibility.PUBLIC,
    description: 'synthetic-own-chain-description',
  };
}

function orgRepositoryMetadata(
  githubRepositoryId: bigint,
  nameWithOwner: string,
): GithubRepositoryMetadata {
  return {
    githubRepositoryId,
    nameWithOwner,
    name: nameWithOwner.split('/')[1] ?? nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    visibility: RepositoryVisibility.PRIVATE,
    description: 'synthetic-own-chain-org-description',
  };
}
