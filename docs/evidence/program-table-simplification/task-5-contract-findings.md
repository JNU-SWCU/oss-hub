# Todo 5 상태 삭제 계약

2026-11-04 소유자 확정: Program 삭제는 상태 전환이다. Program과 모든 하위 행을 보존한다. 저장된 파일 바이트만 기존 삭제 큐로 처리한다. 생성 요청 흡수는 준비 릴리스 후 별도 draft retire PR에서 옛 물리 구조를 삭제한다.

## 기존 테스트와의 충돌

기준 커밋 `baed7d753`에서 다음 기대는 새 계약과 충돌한다.

- `program-lifecycle.service.spec.ts:211-250`: 생성 요청, 업로드, 마일스톤 및 프로그램 행 삭제를 요구한다.
- `program-lifecycle.service.spec.ts:741`: 퍼지의 전체 하위 행 삭제와 순서를 요구한다.
- `program-purge.integration.spec.ts:1057-1078,1247`: 모든 하위 테이블 건수 0을 기대한다.
- `program-purge.integration.spec.ts:1367-1406`: 저장소 관계를 끊는 것을 기대한다.
- `program-purge-deletion-matrix.spec.ts:134-151`: 프로그램과 팀의 삭제 연산이 같아야 한다고 요구한다. 팀 삭제는 계속 물리 삭제이고 프로그램은 상태 삭제이므로 이 전제가 성립하지 않는다.

삭제를 유지해 테스트를 통과시키지 않는다. 회귀 검증은 같은 행과 관계의 보존, 목록 제외, 파일 삭제 큐의 완료 및 실패 재시도를 확인하도록 전환한다. 기존 바이트 삭제 작업자는 유지한다.

## 확인 snapshot 뒤에 들어온 행

기존 퍼지는 자식 행 DELETE로 동시 INSERT와 직렬화 충돌을 만들었다. 상태만 바꾸면 두 트랜잭션이 순서대로 실행된 것으로 볼 수 있어 PostgreSQL이 성공을 허용한다. 운영자가 확인하지 못한 행을 물리 삭제하는 위험이 사라졌으므로 소유자는 이 경우의 성공을 승인했다.

`program-purge.integration.spec.ts`의 네 경합 시나리오는 이제 성공, 새 자식 보존, DELETED 상태, 목록과 상세 제외를 함께 확인한다. 목록은 실제 이름으로 검색하고 삭제 전 해당 ID와 1건이 보임을 먼저 확인한다. 확인 전후의 건수·identity 지문 변경은 기존대로 409를 반환한다. 새 잠금 전략이나 자식 쓰기 잠금은 도입하지 않았다.

## 삭제 이후 쓰기

기존 Program 조회·잠금에 DELETED 제외 조건을 추가했다.

- `LockProgramTreeRepository`: 교직원 프로그램·마일스톤·서류 편집.
- `PlatformRepository.lockSubmissionMembership`: 학생 제출.
- 지원의 프로그램 조회·지원 잠금, 학생 취소·재지원 잠금, 팀 프로그램 조회, 팀 이름 변경, 초대 생성, 레거시 제출 심사 대상 조회.
- 교직원 대시보드 목록과 자동·수동 기한 알림의 프로그램 조회에서도 삭제 상태를 제외한다.

실제 DB에서 PUBLISHED·ARCHIVED는 기존 가드를 통과하고 DELETED는 통과하지 않는 것을 검증했다. 퍼지는 이 편집 가드를 사용하지 않으며 PUBLISHED·ARCHIVED를 상태 삭제한다. DELETED 복구 API는 이 작업에 추가하지 않았다.

첫 게이트에서 지적한 아래 경로는 이 준비 릴리스에서 모두 수정했다. 뒤 단계로 넘기지 않는다.

| 경계 | 수정과 실제 DB 증거 |
| --- | --- |
| `BoardService.assertAccess` | 직원의 조기 반환 전 공통 프로그램 존재 검사를 수행한다. 글 생성·수정·삭제·고정, 댓글 생성·삭제 6개 쓰기를 검사한다. |
| `TeamInvitationsRepository` | 팀 잠금과 Program 잠금에 삭제 조건을 적용하고 빈 잠금 결과를 거부한다. 거절의 UPDATE도 팀의 프로그램 조건을 검사한다. 취소·거절·수락 3개 경계를 검사한다. |
| `ProgramTeamsRepository` | 기존 팀 잠금의 공통 조건과 결과 검사로 탈퇴·강퇴·직원 강퇴·위임을 차단한다. |
| 추가 스캔 | 신청 준비의 거절·취소·탈퇴, 팀 삭제, 저장소 URL 변경, 신청 승인, 문서 심사 잠금, 일괄 변경 요청의 프로그램 조회, 저장소 공개 대상 조회도 차단했다. |
| 수집과 관리자 집계 | `platform/platform.repository.ts`의 공통 Prisma 조건을 실제 수집 직전 조회, 외부 수집 목록, 관리자 집계·스트림 상세에서 사용한다. 기존 fact·Contribution·랭킹은 보존한다. Todo 7은 이 조건의 대상 연결 규칙을 이어서 단순화한다. |

`program-deleted-write.integration.spec.ts`는 같은 입력으로 PUBLISHED·ARCHIVED의 기존 성공과 DELETED의 거부를 함께 확인한다. 기존 13개 쓰기는 수정 전 모두 잘못 성공했고, 추가 준비·팀 삭제 4개도 RED를 확인했다. URL 변경·신청 승인·문서/공개 조회의 RED는 각각의 실제 서비스·DB 경계에서 확인했다. 거부 후 보존 대상 행은 수정 전과 같아야 한다.

## 독립 배포 순서

준비 PR의 apps/frontend와 guide 전체는 기준 커밋과 같다. 기존 화면으로 새 삭제 응답을 소비한 E2E 실행 증거는 보존하고, fixture 변경도 후속 frontend PR로 분리한다. 새 숨김·파일 정리 안내와 캡처는 별도 frontend PR에서만 배포한다. 순서는 기존 화면/기존 backend, 기존 화면/새 backend, 새 backend가 운영 중임을 확인한 뒤 새 화면/새 backend다. 새 화면/기존 backend 조합은 지원하지 않고 후속 PR을 draft로 잠근다. 기존 화면은 삭제 동작의 종전 문구를 유지하지만, 새 backend가 도메인 기록을 보존한다는 새 약속은 후속 화면에서만 노출한다.

물리 구조 retire는 prepare backend가 옛 구조를 읽고 쓰지 않는 것을 운영에서 확인한 뒤 별도 릴리스로 적용한다. frontend 후속 PR과 retire PR은 모두 prepare에 쌓되 서로를 한 배포의 전제라고 가정하지 않는다.

## 늦게 연결된 파일: Todo 6으로 넘긴 공백

정리 대상 snapshot 뒤에 커버나 양식 파일이 연결되면 해당 바이트는 이번 퍼지의 큐에 포함되지 않는다. `program-authoring-upload.repository.ts:133-143`의 작업자는 만료 PENDING과 DELETE_PENDING만 선택한다. ATTACHED는 선택하지 않는다. `prisma-storage-reference.repository.ts:78-83,135-142`는 보존된 커버·양식 메타데이터를 계속 live reference로 보기 때문에 고아 정리도 수거하지 않는다.

SubmissionFile에는 기존 만료 정리 경로가 있지만 커버·양식에는 이 보장이 없다. 소유자가 이 공백의 해결을 Todo 6에 배정했다. 이 PR은 새 작업자를 만들지 않는다. 현재 큐에 들어간 파일의 삭제 및 재시도, 두 번째 실행의 0건 처리는 실제 저장소 테스트로 검증했다.

## 옛 생성 API와 출처

`programs.controller.ts:113-126`의 `POST /programs`는 유지한다. 이 경로는 원래 ProgramCreateRequest를 만들지 않았지만 호출자의 신원은 알고 있으므로 USER와 실제 생성자를 저장한다. 키와 해시는 둘 다 없고 임의 키를 만들지 않는다. CHECK는 USER의 생성자 필수, LEGACY_UNKNOWN의 생성자 없음, 키·해시 둘 다 있음 또는 둘 다 없음을 강제한다.

프론트의 생성 호출은 `apps/frontend/src/features/programs/authoring/program-authoring-api.ts:51-55`의 `program-authoring/programs`다. 저장소 프론트에서 옛 POST /programs 호출은 찾지 못했다. 옛 경로는 컨트롤러와 `programs.create.service.spec.ts`, `programs.controller.spec.ts`의 회귀 계약에 남아 있다. 외부 클라이언트의 호출 여부는 관측하지 않았으며 엔드포인트 폐지는 후속 판단이다.

삭제 상태를 새 프론트 값으로 노출하지 않는다. 목록·상세·편집·개요는 삭제 Program을 반환하지 않고, 생성 멱등 재시도의 HTTP 응답은 ProgramIdResponseDto의 id뿐이다. 삭제 응답의 기존 deletedCounts 키도 배포 시차를 위해 유지하며 도메인 행 삭제 건수는 0이다.

prepare의 임시 업로드 bridge는 옛 앱이 createRequestId를 명시적으로 NULL로 바꾸는 경우에만 새 programId도 해제한다. 그래야 마이그레이션 직후 아직 교체되지 않은 옛 퍼지가 새 FK에 막히지 않는다. 새 앱은 옛 컬럼을 쓰지 않으므로 상태 삭제와 파일 작업자 실행 뒤에도 Program 연결을 보존한다. 두 경우를 서로 다른 실제 DB 테스트로 검증했으며 bridge는 retire에서 제거한다.

## 검증 도구의 기존 공백

기존 삭제 E2E fixture에 `/consents/current` 응답이 없어 변경 전 화면 진입부터 실패했다. 현행 동의·프로그램 개요 응답과 실제 삭제 응답 형태로 fixture를 보정했다. 준비 PR은 기존 문구와 새 응답의 호환을 검증하고, 화면 후속 PR은 새 문구에 맞춰 같은 검증을 이어 간다. 제품 인증 동작을 우회하거나 바꾸지 않았다.

git-master가 참조하는 `docs/reference/github-attachment-upload.md`는 현재 저장소에 없다. 소유자의 지시대로 저장소 submit-pr-evidence 경로를 사용해 이미 공개된 릴리스의 asset에 합성 캡처만 올렸으며, 새 릴리스나 브라우저 세션은 만들지 않았다.

역사적 User 마이그레이션 harness는 옛 User 스키마 뒤에 현재 Program 모델을 붙인다. 사라진 ProgramCreateRequest 타입을 가리키지 않도록 fixture의 역관계 이름만 createdPrograms로 바꿨다. 저장된 User 필드와 User 마이그레이션 SQL은 바꾸지 않았으며 기존 이관 회귀 11건을 통과했다.
