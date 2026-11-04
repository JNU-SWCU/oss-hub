# Todo 5 준비 릴리스 검증

기준: `baed7d753`, 2026-11-04. ProgramCreateRequest의 물리 삭제는 이 준비 릴리스에 없다.

## 행동 및 실패 증거

- 상태 삭제 테스트는 기존 코드에서 Program 조회가 null이 되는 이유로 RED였다. 이후 Program과 하위 행 보존, 모든 목록 상태 필터와 상세 제외를 확인했다.
- 옛 생성 API의 출처 쓰기를 제거하는 변이에서 USER 대신 LEGACY_UNKNOWN이 반환되어 RED였다. 실제 생성자 저장을 복구한 뒤 실제 DB 검증을 통과했다.
- 교직원 대시보드·기한 알림에서 삭제 Program이 남는 경우를 RED로 확인한 뒤 기존 조회 조건에 삭제 제외를 추가했다.
- 앱 교체 전 옛 퍼지는 새 업로드 FK 때문에 SQLSTATE 23503으로 RED였다. 임시 bridge의 옛 컬럼 명시적 해제 분기를 추가한 뒤 통과했다. 새 코드의 Program 연결 보존 테스트도 함께 통과했다.
- 같은 키 동시 생성은 Program 한 행만 커밋한다. 같은 키·다른 해시는 충돌하고, 삭제 후에도 원래 키는 원래 Program ID를 반환한다.
- 사용자 출처와 멱등 키 쌍의 CHECK 위반 여섯 가지는 SQLSTATE 23514, 다른 생성자의 업로드 연결은 23503으로 거부된다.
- 반복해서 fixture enum을 다시 만들 때 발생한 PostgreSQL prepared statement의 결과 타입 변경 오류는 SELECT enum을 text로 읽어 해결했다. 재시도나 테스트 건너뛰기는 추가하지 않았다.

## 최초 구현의 실행 결과

아래는 최초 HEAD `fa514a6e`의 결과다. 첫 독립 게이트는 삭제 후 쓰기와 배포 시차, 네 경합 테스트의 공허한 검색을 지적해 거절했다. 이 수치를 수정 HEAD의 증거로 대신하지 않는다. 모든 무거운 실행은 공용 heavy lock 안에서 순차 수행했다.

| 검사 | 최종 결과 | EXIT |
| --- | --- | ---: |
| 생성·이관·전체 그래프 상태 삭제 통합 | 3 suites / 45 tests | 0 |
| 프로그램 목록·출처·기한 알림 및 기존 제출 통합 | 2 suites / 17 tests | 0 |
| 역사적 User 이관 회귀 | 1 suite / 11 tests | 0 |
| backend 전체 unit | 390 suites / 6314 tests / 309 snapshots | 0 |
| frontend 관련 Vitest, maxWorkers=2 | 4 files / 71 tests | 0 |
| 삭제 화면 Playwright | 9 tests | 0 |
| lint:structure | knip + scripts lint | 0 |
| format:check | 저장소 전체 대상 | 0 |
| backend lint / typecheck | 각각 실행 | 0 / 0 |
| frontend lint / typecheck | 각각 실행 | 0 / 0 |
| check:file-ledger | 257 paths | 0 |
| guide 전용 build | 42 pages | 0 |

통합 테스트는 `BACKEND_INTEGRATION_TEST_PATTERN`과 `apps/backend/test/run-integration.sh`를 사용했다. 마지막 생성·삭제 패턴은 `(program-create-request-migration|program-authoring.service|program-purge).integration.spec.ts$`, 목록·기존 제출 패턴은 `(program-lifecycle|submissions.service).integration.spec.ts$`다. 이전 실행에서 통과한 관련 팀·초대·심사·편집·커버 시나리오도 유지했다.

전체 unit 첫 실행의 쿼리 기대값 여섯 건과 감사 로그 mock 반환 타입 오류를 고친 뒤 전체 명령을 다시 실행해 위 결과를 얻었다. 삭제 제외 조건을 기대값에 추가했으며 assertion을 완화하지 않았다.

## 게이트 수정과 실패 능력

- 게시판 6개, 초대 3개, 멤버 변경 4개는 실제 DB에서 정상 Program의 성공과 DELETED의 잘못된 성공을 대조해 13개 RED를 확인했다.
- 추가 스캔에서 신청 준비 거절·취소·제거와 팀 삭제 4개, 저장소 URL 변경 1개, 신청 승인·문서/공개 조회 4개의 RED를 확인하고 기존 공통 조회·잠금에 조건을 추가했다. 준비팀은 향후 제거 예정이지만 현재 API의 상태 경계도 이 릴리스에서 보호한다.
- `program-deleted-write.integration.spec.ts`는 20개 경계에 PUBLISHED·ARCHIVED·DELETED를 각각 적용한다. 쓰기 거부 후에는 게시글·댓글·팀·멤버·초대·준비팀 행 전체가 전과 같다. 별도 URL/신청 승인 테스트는 연결과 상태, 이력·outbox 보존을 검사한다.
- 네 경합 테스트는 Program의 실제 이름으로 검색하고 삭제 전 해당 ID와 count 1을 확인한다. 상태 삭제가 새 자식을 보존하므로 기존 물리 삭제의 409 전제가 사라졌다는 이유를 공통 `it.each` 제목과 PR에 적었다. 소유자가 `local/no-comments`와 충돌하는 주석 요구를 제목·본문으로 바꾸도록 확정했으며 lint 규칙은 그대로다.
- SQL 목록 필터의 `all` 조건을 `TRUE`로 바꾼 변이에서 정확히 네 경합 테스트가 실패했다(4 failed / 19 passed, EXIT=1). 조건을 복구한 전체 퍼지 통합은 23 tests, EXIT=0이다.
- 수집·관리자 집계 두 종류(조직/외부)는 삭제 Program에서 계속 수집되는 RED를 확인했다. 공통 대상 조건 적용 뒤 수집 SKIPPED, 집계 1 감소, 상세 제외, 기존 fact·Contribution·랭킹 동일을 실제 DB로 확인했다.
- 수정 통합: 6 suites / 137 tests, EXIT=0. 팀·초대 경합·신청 준비·URL의 선행 관련 회귀도 5 suites / 80 tests, EXIT=0이다.
- 수정 대상 단위 회귀: 88 suites / 1691 tests, EXIT=0.
- 공통 Prisma 조건의 수집·관리자·platform 영향 대상은 4 suites / 127 tests다. config의 Prisma import 금지와 repository의 상수 export 금지를 모두 지키도록 기존 `PlatformRepository.collectionTargetWhere()`에 둔다. 코드 주석 금지도 완화하지 않았다.
- 수정 후 backend 전체 단위: 390 suites / 6314 tests / 309 snapshots, EXIT=0. 첫 전체 실행에서 잠금 순서 fixture가 JOIN의 Program 이름을 잠금 대상으로 오인한 3개 실패를 확인했다. `FROM "Program"`을 구별하도록 fixture를 수정한 뒤 원래 순서·인수 assertion을 유지하고 해당 5개와 전체를 재실행했다.

인계 검증에서 공통 조건의 static 메서드가 `architecture/injectable-role-class`에 걸려 backend lint EXIT=1을 확인했다. `PlatformRepository.collectionTargetWhere()`를 인스턴스 메서드로 바꾸고 수집·관리자 repository의 생성자로 주입했다. 트랜잭션 repository도 같은 인스턴스를 전달한다. 조건과 테스트 assertion은 바꾸지 않았다. 변경 후 대상 단위 4 suites / 127 tests, 전체 단위 390 suites / 6314 tests / 309 snapshots 및 backend lint를 다시 통과했다(각 EXIT=0).

관련 생성자 호출부까지 넓힌 통합 실행은 21 suites / 247 tests 중 관리자 상세 1건이 실패했다. 공유 fixture가 suite마다 다른 ID와 같은 저장소 표시 이름을 남겨 다른 프로그램의 저장소를 오인한 것이 원인이다. 해당 회귀의 표시 이름에 이미 고유한 저장소 ID를 넣고, 같은 이름의 삭제 전 존재와 삭제 후 제외를 검사하도록 수정했다. 공통 수집 필터나 부정 assertion을 완화하지 않았다.

수정 후 같은 통합 범위 21 suites / 247 tests가 모두 통과했다(EXIT=0). backend typecheck, lint:structure, format:check, check:file-ledger도 EXIT=0이다. 새 통합 DB의 전체 migrate deploy와 실행기의 컨테이너·볼륨·네트워크 정리를 포함한다.

prepare SQL SHA-256은 서버 리허설의 `525ab8522b64a26a48ad637edb7e394114bbf62033f9de5f062db07e7454bb6f`와 같다. 게이트 수정은 SQL을 바꾸지 않아 리허설을 반복하지 않았다.

## 화면과 배포 시차

실제 앱의 기존 `program-edit-purge-network.spec.ts`를 사용했다. API는 page.route의 합성 응답이며 저장·인가·DB 증명은 위의 별도 backend 테스트가 맡는다. root 개발 스택은 띄우지 않았다.

prepare의 apps/frontend와 guide 전체는 기준 커밋 그대로다. 기존 확인 문구로 새 backend 응답(도메인 삭제 0건, 파일 정리 건수)을 소비한 9개 Playwright 시나리오의 실행 증거는 보존하고 fixture 변경도 후속 frontend PR로 분리했다. 당시 1440x900·390x844의 확인 창과 완료 화면을 직접 확인했다. 이 화면은 새 기록 보존 약속을 하지 않으며 기존 문구를 유지한다. 기존 화면과 새 backend의 API 호환을 증명하는 것이지, 기존 문구가 새 저장 모델을 설명한다고 주장하지 않는다.

새 숨김·파일 정리 문구와 guide 캡처는 별도 draft frontend PR이다. prepare backend가 운영 중인 것을 확인한 다음에만 이 PR을 배포한다. 새 화면/기존 destructive backend는 허용하지 않는다. 물리 구조 retire 역시 별도 draft와 다음 릴리스로 유지한다.

소유자가 승인한 기존 공개 릴리스 `v0.24.32`에 기존 7장 외에 prepare 시차 증거 4장을 첨부했고 각 URL HTTP 200을 확인했다. 신규 릴리스 발행은 하지 않았다. prepare QA 후 새 Next/Chrome PID 0, 포트 listener 0이다. 새 화면의 기존 9개 E2E와 71개 Vitest 및 guide build 42 pages는 후속 화면 변경의 기존 증거이며 prepare 제품 화면 변경으로 표시하지 않는다.

## 요청된 probe

- `stale_state`: 매 통합 실행이 빈 격리 DB에서 전체 migrate deploy를 수행했다. 삭제 이후 재삭제는 NOT_FOUND이며 과거 범위 지문 변경은 409다.
- `dirty_worktree`: 시작 worktree는 지정 브랜치의 clean 상태였다. 이후 변경은 이 단위의 파일이며 main checkout은 수정하지 않았다.
- `misleading_success_output`: suite/test 수와 실제 EXIT를 함께 확인했다. guide는 root workspace에 속하지 않아 `pnpm --dir guide build`로 직접 실행했다. 실패한 셸 실행과 fixture 실행은 성공으로 세지 않았다.
- `flaky_tests`: 제어된 Promise로 경합을 재현했고 sleep을 넣지 않았다. enum fixture의 순서 의존 오류를 수정했고 생성·삭제 대상은 수정 후 재실행했다.
- 그 외 배포·merge·Jenkins probe: 이 단위의 금지 범위이므로 실행하지 않았다.

알려진 경계와 Todo 6의 늦은 파일 정리 공백은 `task-5-contract-findings.md`, 실제 데이터 집계·백업 복원과 리허설은 `task-5-server-rehearsal.md`에 있다. 속도 개선은 주장하지 않는다.
