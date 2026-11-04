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

## 실행 결과

모든 무거운 실행은 공용 heavy lock 안에서 순차 수행했다.

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

## 화면과 배포 시차

실제 앱의 기존 `program-edit-purge-network.spec.ts`를 사용했다. API는 page.route의 합성 응답이며 저장·인가·DB 증명은 위의 별도 backend 테스트가 맡는다. root 개발 스택은 띄우지 않았다.

확인 창 Before/After를 1440x900과 390x844에서 캡처했다. 완료 안내도 실제 앱에서 확인했다. resize 직후의 화면 합성 문제는 두 animation frame과 대상 스크롤 후 캡처하도록 고쳤다. 이상한 프레임은 공개하지 않았다. 마지막 캡처 실행은 1개 시나리오만 재실행했으며 EXIT=0이다.

소유자가 승인한 기존 공개 릴리스 `v0.24.32`에 PR 전용 이름으로 정상 합성 이미지 7장을 첨부했다. 7개 URL 모두 HTTP 200을 확인했다. 신규 릴리스 발행은 하지 않았다. 각 실행 후 새 Next/Chrome PID 0, 포트 listener 0을 확인했다.

## 요청된 probe

- `stale_state`: 매 통합 실행이 빈 격리 DB에서 전체 migrate deploy를 수행했다. 삭제 이후 재삭제는 NOT_FOUND이며 과거 범위 지문 변경은 409다.
- `dirty_worktree`: 시작 worktree는 지정 브랜치의 clean 상태였다. 이후 변경은 이 단위의 파일이며 main checkout은 수정하지 않았다.
- `misleading_success_output`: suite/test 수와 실제 EXIT를 함께 확인했다. guide는 root workspace에 속하지 않아 `pnpm --dir guide build`로 직접 실행했다. 실패한 셸 실행과 fixture 실행은 성공으로 세지 않았다.
- `flaky_tests`: 제어된 Promise로 경합을 재현했고 sleep을 넣지 않았다. enum fixture의 순서 의존 오류를 수정했고 생성·삭제 대상은 수정 후 재실행했다.
- 그 외 배포·merge·Jenkins probe: 이 단위의 금지 범위이므로 실행하지 않았다.

알려진 경계와 Todo 6의 늦은 파일 정리 공백은 `task-5-contract-findings.md`, 실제 데이터 집계·백업 복원과 리허설은 `task-5-server-rehearsal.md`에 있다. 속도 개선은 주장하지 않는다.
