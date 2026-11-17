const githubPaging =
  'GitHub API 페이지 커서를 앞 응답에서 받아야 다음 요청을 보낼 수 있다. 최대 페이지 수로 묶인 수집 작업이며 HTTP 읽기 경로가 아니다.';
const httpRetry =
  '401이면 토큰을 비우고 한 번만 다시 보내는 2회 재시도다. 앞 시도의 결과에 따라 다음 시도를 정한다.';
const collectionBudget =
  '수집 작업이 실행 예산과 마감 시간을 확인하며 저장소를 하나씩 처리한다. 순서와 중단 시점이 의미이며 HTTP 읽기 경로가 아니다.';
const provisionLease =
  '저장소 초대 작업이 매 초대 전에 작업 임대를 갱신하고 GitHub 호출 결과를 바로 기록한다. 임대를 잃으면 즉시 멈춰야 하므로 순서대로 처리한다.';
const transactionWrite =
  '한 트랜잭션 안에서 항목별 쓰기를 순서대로 한다. 쓰기 경로이며 항목 수는 요청 본문이 정한다.';

export const awaitInLoopAllowlist = {
  'src/github/collection-app.client.ts': {
    'CollectionAppClient.collectRepositoryContributions': githubPaging,
    'CollectionAppClient.send': httpRetry,
  },
  'src/github/collection-discovery.client.ts': {
    'CollectionDiscoveryClient.fetchUserActivityMetrics': githubPaging,
    'CollectionDiscoveryClient.request': httpRetry,
  },
  'src/github/collection-sync.service.ts': {
    'CollectionSyncService.sweep': collectionBudget,
    'CollectionSyncService.probe': collectionBudget,
    'CollectionSyncService.collect':
      '기여 종류 4개를 한 트랜잭션에서 차례로 기록하는 고정 반복이다. 수집 작업이며 HTTP 읽기 경로가 아니다.',
  },
  'src/github/collection-user-activity.service.ts': {
    'CollectionUserActivityService.runSweep':
      '사용자마다 GitHub 활동을 관측하는 예약 수집 작업이다. 사용자별 실패를 따로 세며 GitHub 요청 속도를 넘지 않도록 순서대로 보낸다.',
  },
  'src/github/github-app.client.ts': {
    'GithubAppClient.revokeCollaborator':
      '같은 로그인으로 남은 초대만 골라 GitHub에서 취소한다. 초대 목록은 페이지 한도로 묶이며 HTTP 읽기 경로가 아니다.',
    'GithubAppClient.listInvitations': githubPaging,
  },
  'src/github/repository-outbox-consumer.service.ts': {
    'RepositoryOutboxConsumerService.runBatch':
      '아웃박스 이벤트와 작업을 배치 크기만큼 하나씩 가져온다. 비면 멈추며 같은 작업을 두 번 잡지 않도록 순서대로 처리한다.',
  },
  'src/github/repository-provision-worker.service.ts': {
    'RepositoryProvisionWorkerService.processInvitations': provisionLease,
  },
  'src/notifications/deadline-digest.service.ts': {
    'DeadlineDigestService.sendDeadlineDigests':
      '마감 알림 예약 작업이 프로그램마다 메일을 보내고 결과를 기록한다. 메일 발송을 순서대로 해야 하며 HTTP 읽기 경로가 아니다.',
  },
  'src/platform/prisma-serialization-retry.repository.ts': {
    'PrismaSerializationRetryRepository.withSerializationRetry':
      '직렬화 실패 때만 대기 후 다시 실행하는 재시도 반복이다. 앞 시도가 실패해야 다음 시도를 한다.',
  },
  'src/platform/s3-object-inventory.client.ts': {
    'S3ObjectInventoryClient.listObjects':
      '저장소 정리 작업이 접두어마다 객체 목록을 읽는다. 접두어 수는 코드에 고정되어 있다.',
    'S3ObjectInventoryClient.listObjectsByPrefix':
      'S3 목록의 이어받기 토큰을 앞 응답에서 받아야 다음 페이지를 읽을 수 있다.',
  },
  'src/programs/file-cleanup.service.ts': {
    'FileCleanupService.runDue':
      '삭제할 파일을 하나씩 임대해 지운다. 같은 파일을 두 작업이 지우지 않도록 임대 후 처리하며 배치 크기로 묶인다.',
    'StorageOrphanReconciliationService.reconcile':
      '지우기 직전마다 키가 아직 참조되지 않는지 다시 확인한다. 확인과 삭제 사이 경쟁을 줄이려고 키마다 순서대로 처리하는 운영 명령이다.',
  },
  'src/programs/files.repository.ts': {
    'ProgramAuthoringUploadTransactionRepository.consumePendingProgramAuthoringUploads':
      transactionWrite,
  },
  'src/programs/program-editor.repository.ts': {
    'ProgramEditorRepository.applyMilestoneEditIn': transactionWrite,
  },
  'src/programs/programs.service.ts': {
    'ProgramAuthoringService.createInTransaction':
      '프로그램 생성 트랜잭션에서 마일스톤을 만든 뒤 그 id로 서류와 양식을 만든다. 앞 쓰기의 id가 다음 쓰기에 필요하다.',
  },
  'src/programs/requirements.repository.ts': {
    'RequirementsRepository.applyDocumentOrderIn': transactionWrite,
  },
  'src/programs/requirements.service.ts': {
    'ProgramDocumentChangeRequestsService.requestChanges':
      '변경 요청 대상 제출물마다 검토 기록과 상태를 같은 트랜잭션에서 쓴다. 쓰기 경로다.',
  },
  'src/programs/team-history.repository.ts': {
    'TeamHistoryRepository.recordTeamInvitationsDeleted':
      '팀 삭제 트랜잭션에서 남은 초대마다 닫힘 이력을 쓴다. 쓰기 경로다.',
  },
  'src/programs/team-invitations.repository.ts': {
    'TeamInvitationsRepository.acceptTeamInvitationTransaction':
      '초대 수락 트랜잭션에서 같은 학생의 다른 초대를 하나씩 닫고 실제로 닫힌 것만 이력에 남긴다. 쓰기 경로다.',
  },
  'src/programs/team.repository.ts': {
    'ApplicationsRepository.listTeamManagementForProgram':
      '읽기 경로지만 상태 묶음 두 개를 도는 고정 반복이다. 앞 묶음의 개수로 다음 묶음의 skip과 take를 정하므로 데이터가 늘어도 쿼리 수가 늘지 않는다(query-growth 스펙으로 확인).',
  },
  'src/users/consents.service.ts': {
    'ConsentsService.getCurrent':
      '읽기 경로지만 정책 버전 목록(현재 1개, 호환 2개)을 우선순위대로 확인하는 고정 반복이다. 데이터가 늘어도 쿼리 수는 최대 3개다.',
  },
};
