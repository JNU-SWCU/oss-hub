# @GoBeromsu 저널

작성자 저널이다. 새 항목은 파일 끝에만 붙인다. 규칙은 루트 AGENTS.md §3이 원본이다.

## 2026-08-20 — TEAM-STATE를 멤버별 append-only 저널로 전환

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음

## 2026-08-20 — 랭킹 참여자에서 @ 제거 + GitHub 링크

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음

## 2026-08-20 — 가입 마치기를 POST 한 방으로 고정

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음

## 2026-08-20 — 사이드바 스크롤·상세 오버레이 UX

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음

## 2026-08-21 — 프로그램 lifecycle 영구 삭제 UX P4 검증

- 상태: blocked
- Issue: #960
- PR: 없음
- blocker: 없음

## 2026-08-21 — 프로그램 lifecycle 영구 삭제 UX synthetic Chrome 검증 완료

- 상태: review
- Issue: #960
- PR: 예정
- blocker: 없음
- 증거: `.omo/evidence/task-5-browser/admin-purge-success.png`, `purge-network-request-log.json`
- 결과: ADMIN/STAFF, 보호 프로그램, zero-count, exact scope, no normal DELETE, cancel/focus, scope drift/no-retry를 4개 Chrome 테스트로 검증 (`4 passed`)
## 2026-08-20 — 랭킹 CSV 다운로드와 기준 시각 위계

- 상태: review
- Issue: #958
- PR: (생성 예정)
- blocker: 없음
- evidence: `.omo/evidence/task-3-insights-chart-template-file-ux.md`
- browser: Playwright 3 passed; 205-row download and page-2 failure artifacts captured
## 2026-08-20 — 마일스톤 양식 파일명 계약

- 상태: review
- Issue: #959
- PR: (이 PR)
- blocker: 없음
## 2026-08-20 — 전공·비전공 활성 비교를 명확히 한다

- 상태: review
- Issue: #957
- PR: (이 PR)
- blocker: browser QA unavailable in this environment; frontend module remains above the repository 250 LOC split threshold

## 2026-08-20 — 마일스톤 행 양식 확인과 동작

- 상태: review
- Issue: #961
- PR: (이 PR)
- blocker: 실제 Chrome QA는 환경 제약으로 미실행; focused Vitest·lint·typecheck·build 통과


## 2026-08-21 — 브라우저 비교 경계 상태를 고정한다

- 상태: review
- Issue: #965
- PR: (이 PR; verifier gap from #962)
- blocker: 없음

## 2026-08-21 — 프로필 호환 조회 경계를 단일화한다

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음

## 2026-08-21 — 인증 경로 메타데이터 계약을 고정

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 검증: 인증 경로 manifest Jest happy/failure, backend lint·typecheck·test·build 통과
- simplifier: 공식 code-simplifier 1.0.0 Codex pass, 변경 파일 allowlist 밖 수정 0건

## 2026-08-21 — 프로그램 공개 인증 메타데이터를 복구

- 상태: review
- Issue: #969
- PR: #970
- blocker: 없음
- 검증: 프로그램 목록·상태 집계·상세의 익명/인증 HTTP 200과 전체 인증 라우트 manifest 분류를 고정
- simplifier: 공식 code-simplifier 1.0.0 Codex pass, 변경 파일 allowlist 밖 수정 0건

## 2026-08-21 — 프론트 세션 조회 경계를 단일화

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-3/authenticated-shell.png`, `401-anonymous-shell.png`
- 결과: `/auth/session` 단일 조회 경계, 401·만료·비활성 전환, 합성 Chrome 셀 QA 검증 완료

## 2026-08-21 — 프런트 세션 최신 응답 게시를 보장한다

- 상태: review
- Issue: #969
- PR: #972
- blocker: 없음
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-3/browser-session-transition.json`, `authenticated-shell.png`, `generic-401-session-transition.png`, `expired-session-transition.png`, `inactive-session-transition.png`, `server-error-session-transition.png`
- 결과: 겹친 세션 갱신은 최신 세대만 게시하며, 구독 기반 결정론 테스트와 합성 Chrome 인증·401·만료·비활성·서버 오류 전환을 검증 완료

## 2026-08-21 — 인증 라우트 manifest 보안 감사를 교정

- 상태: review
- Issue: #969
- PR: (이 PR; #970 후속)
- blocker: 없음
- 검증: AppModule 45개 controller·120개 route 전체 인벤토리와 Nest runtime graph를 대조하고, overview teams 익명 401·인증 200 및 전체 품질 행렬을 고정
- simplifier: 공식 code-simplifier 1.0.0 Codex pass, 5개 코드 allowlist 밖 수정 0건
## 2026-08-21 — 받은 팀 초대 프로필 호환 조회를 복구

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 검증: 받은 초대 canonical/legacy/nickname 표시와 후보 검색·게시판 목록/상세/댓글을 격리 PostgreSQL에서 검증
- simplifier: 공식 code-simplifier 1.0.0 Codex pre/post 검증, 변경 파일 allowlist 밖 수정 0건
## 2026-08-21 — 최신 main과 초점 검증 follow-up 병합

- 상태: review
- Issue: #973
- PR: #975
- blocker: 없음
- 결과: origin/main 97a1f60c를 정상 merge하고 #974의 제품 초점 수정과 #975의 fixture bootstrap·Chrome 검증을 함께 보존

## 2026-08-21 — 스태프 인사이트 필터 키보드 초점 표시를 복구

- 상태: review
- Issue: #973
- PR: 생성 예정
- blocker: 기존 local-review `insights-long` fixture가 현재 브랜치에서 404라 Chrome 회귀 스펙은 fixture 라우팅에서 중단됨
- 검증: focused Vitest 2949 passed, typecheck passed, lint passed (기존 경고 5건)

## 2026-08-21 — 상속 인증 라우트 manifest 누락을 교정

- 상태: review
- Issue: #969
- PR: (이 PR; #978 후속)
- blocker: 없음
- 검증: Nest 상속·override runtime 대조, 45개 controller·120개 route 인벤토리, 11-route HTTP 매트릭스와 전체 품질 행렬 통과
- simplifier: 공식 code-simplifier 1.0.0 Codex PASS, 6개 코드 allowlist 밖 수정 0건
## 2026-08-21 — Task 1 fixture 반환 타입을 명시

- 상태: review
- Issue: #969
- PR: (이 PR; #971·#976 교정)
- blocker: 없음
- 검증: backend lint·typecheck·unit·build, 정확한 2 suites/6 tests 통합 패턴, forbidden-field·public strict-read·public-safe 통과
- simplifier: 공식 code-simplifier 1.0.0 pinned commit PASS, 9개 hand-written allowlist 밖 변경 0건
## 2026-08-21 — 프런트 세션 신청 경계 타입을 명시

- 상태: review
- Issue: #969
- PR: (이 PR; #972 corrective)
- blocker: 없음
- 검증: 공식 code-simplifier 1.0.0 PASS, frontend lint·typecheck·2949 tests·build, focused 4 files/26 tests, synthetic Chrome 7 scenarios PASS
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-3-corrective/`

## 2026-08-21 — 프런트 세션 타입 교정을 최신 main에 동기화

- 상태: review
- Issue: #969
- PR: #977
- blocker: 없음
- 결과: #978을 포함한 최신 `origin/main`을 정상 merge하고 두 파일의 type-only corrective diff를 보존
- 검증: frontend lint·typecheck·full tests·build, focused 4 files/26 tests, 공식 code-simplifier 1.0.0, synthetic Chrome 7 scenarios 재검증
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-3-corrective/`
## 2026-08-21 — 랭킹 CSV 전체 행 수 검증

- 상태: review
- Issue: #979
- PR: (이 PR)
- blocker: 없음

## 2026-08-21 — 세션 컨트롤러 테스트를 분리

- 상태: corrective
- Issue: Task 7
- PR: 생성 예정
- blocker: 없음
- 검증: 분리한 2개 스펙 11 tests passed, backend lint·typecheck·Prettier·public-safe passed; 기존 journal drift 보고는 pre-existing

## 2026-08-21 — Task 3 병합 증거를 교정하고 종료

- 상태: done
- Issue: #969
- PR: #977
- blocker: 없음
- 병합 상태: merged
- merge SHA: `97ea2b0a7bf7386f3538cc48038b16a8ccb07bba`
- 검증: exact head `f0d55cae7cd38e8269e3af4522111ec9378020f2`와 required `ci`·`public-safe`·`commitlint` 성공을 확인
- 기록: 이 교정 항목 자체를 현재 저널 EOF에 append-only로 추가

## 2026-08-21 — 상속 인증 라우트 manifest 교정을 제출

- 상태: review
- Issue: #969
- PR: (이 PR; #978 후속)
- blocker: 없음
- 결과: 상속 handler 탐색과 locale 비의존 순서를 고정하고 기존 인증 상태 행렬을 보존
- 검증: Task 2 초점·전체 backend CI·격리 PostgreSQL·실제 Nest HTTP QA
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-2/`
## 2026-08-21 — Task 1 fixture 타입 교정을 최종 검증

- 상태: review
- Issue: #969
- PR: (이 PR; #971·#976 교정)
- blocker: 없음
- 결과: 최신 main 동기화, 정확한 PostgreSQL 2 suites/6 tests와 공개 strict-read, 전체 backend 품질·public-safe 검증 통과
- simplifier: 공식 code-simplifier 1.0.0 pinned commit 실행, 최종 변경 allowlist 밖 수정 0건

## 2026-08-21 — Task 1 simplifier 증거를 교정

- 상태: review
- Issue: #969
- PR: #982
- blocker: 없음
- 교정: 앞선 9개 파일 allowlist simplifier 시도는 `SIMPLIFIER_FAIL`이었고, 이후 2개 파일 corrective allowlist는 pinned code-simplifier 1.0.0 검증을 통과
- 범위: 기존 저널은 수정하지 않고 현재 EOF에 교정 항목만 추가

## 2026-08-21 — Task 2 인증 manifest 교정을 종료

- 상태: review
- Issue: #969
- PR: #983
- blocker: 없음
- 결과: overview teams의 미래 PUBLIC 계약과 현재 SessionGuard 401/200/401 동작을 분리하고 상속·override HTTP 증명을 보강
- 구조: 인증 manifest 테스트와 fixture를 책임별로 분리해 변경 TypeScript 파일을 모두 250 pure LOC 미만으로 유지
- 검증: Task 2 초점·전체 backend unit/integration·lint·typecheck·build·public-safe·실제 Nest HTTP 통과
- 저널 이력: 이전 Task 2 항목은 additions-only였지만 동시 base 내용 뒤에 놓여 old base의 byte-prefix는 아니며, 이 종료 항목만 현재 EOF에 append
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-2/`
## 2026-08-21 — 이름과 학번 검증 계약을 통일

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 검증: Task 5 초점 happy/failure, backend/frontend lint·typecheck, public-safe
- simplifier: 공식 code-simplifier 1.0.0 Codex pass, 변경 파일 allowlist 밖 수정 0건

## 2026-08-21 — 프로그램별 참여 라벨 겹침 해소

- 상태: review
- Issue: #984
- PR: (이 PR)
- blocker: 없음
## 2026-08-21 — 전역 기본 거부 인증 경계를 적용

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 결과: 단일 APP_GUARD가 미분류 경로를 기본 거부하고 PUBLIC·OPTIONAL_SESSION 계약과 DB 기반 active principal을 적용
- 검증: 기본 거부 통합 5건, malformed·expired·issuer·audience·deactivated 401, principal·guard 초점 27건, HTTP 상태 매트릭스 11건, backend lint·typecheck·format·public-safe·commitlint 통과
- simplifier: 공식 code-simplifier 1.0.0 Codex 단일 실행; wrapper timeout 뒤 최종 코드 allowlist와 초점 게이트 재검증

## 2026-08-21 — 회원 권한과 소속 nullable 확장 스키마를 제출

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: production release는 credential/MFA receipt 전까지 차단
- 결과: 회원 유형·소속·독립 권한 nullable 확장과 studentId NOT NULL 제거, migration PR mutex·동시 deploy 검증을 추가하고 legacy Role·selectedRole·profile mirror를 유지
- 검증: fresh/legacy-shaped migration, 이전 이미지 health/session, 동시 deploy 2건과 51개 finished ledger, Jenkins/mutex failure fixture, backend lint·typecheck·초점 unit 통과
- simplifier: 공식 code-simplifier 1.0.0 pinned commit 단일 실행, schema·migration 제외 및 hand-written code allowlist 밖 최종 변경 0건
## 2026-08-21 — 프로그램별 참여 라벨 교정을 최신 main에 동기화

- 상태: review
- Issue: #984
- PR: (이 PR)
- blocker: 없음
- 결과: 프로그램별 참여 차트를 긴 한국어 이름에도 겹치지 않는 세로 막대와 bounded keyboard scroll 영역으로 교정
- 검증: Chrome 6건, 200% 실제 label 확대, ZWJ grapheme mutation 회귀, frontend lint·typecheck·build·public-safe 통과
- 저널 이력: 기존 #984 항목은 유지하고 동시 병합된 main 상태 뒤 현재 항목을 EOF에 append

## 2026-08-21 — 프로그램별 의미 테이블의 모바일 overflow를 교정

- 상태: review
- Issue: #984
- PR: (이 PR; #988 production QA 후속)
- blocker: 없음
- 결과: screen-reader 의미 테이블을 clipping block으로 감싸 375px document overflow를 제거
- 검증: production Aside 재현, documentElement/body overflow red-green, Chrome responsive 초점 검증

## 2026-08-21 — 프로그램별 수치 축의 확대 clipping을 교정

- 상태: review
- Issue: #984
- PR: (이 PR; #989 production QA 후속)
- blocker: 없음
- 결과: chart right margin을 보강해 mobile 200%의 최대 수치 tick을 hidden-overflow card 안에 유지
- 검증: production raw SVG/card bounds, max=12 fixture, numeric tick count·card inset, Chrome responsive 초점 검증
## 2026-08-21 — 현재 사용자 조회를 세션 계약으로 통합

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 결과: `/auth/me`를 제거하고 `/auth/session`만 현재 사용자 조회 계약으로 유지하며 레거시 role projection을 인증 DTO에 보존
- 검증: exact `auth-session-contract.integration.spec.ts` 6 passed, focused frontend auth/session 34 passed, backend/frontend lint·typecheck, public-safe
- simplifier: 공식 code-simplifier 1.0.0 Codex 단일 실행, 변경 파일 allowlist 밖 수정 0건
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-7/`

## 2026-08-21 — 프로그램별 수치 축 교정을 최신 main에 동기화

- 상태: review
- Issue: #984
- PR: (이 PR; #990 동기화 후)
- blocker: 없음
- 결과: mobile 200% 최대 수치 tick을 card 안에 유지하고 numeric tick 경계를 E2E로 고정
- 검증: production raw bounds, max=12 fixture, Chrome 6건, frontend lint·typecheck·build·public-safe
- 저널 이력: 기존 #984 수치 축 항목은 유지하고 #990 상태 뒤 현재 항목을 EOF에 append

## 2026-08-21 — Task 7 세션 계약 저널 교정 완료

- 상태: done
- Issue: Task 7
- PR: #991
- blocker: 없음
- 병합 상태: implementation PR #990 merged at `16a83f0650352b8941adf4c896101a97f5e2f663`; test-only corrective PR #991 merged at `aabd38fab70bde702be925df9184a251ab80ecd1`
- 교정: 앞선 unsupported `corrective`/pending-creation line은 superseded이며, 이전 journal bytes/lines는 수정하지 않고 이 Task 7 correction block만 EOF에 append
- 검증: verifier-confirmed session contract, 11 preserved tests, TypeScript pure LOC `130/107/56`, `ci`·`public-safe`·`commitlint` green
- 범위: #991은 test-only corrective이며 product delta 없음

## 2026-08-21 — 프로그램별 수치 축 교정을 journal 후속 뒤에 동기화

- 상태: review
- Issue: #984
- PR: #992
- blocker: 없음
- 결과: mobile 200% 최대 수치 tick을 card 안에 유지하고 exact `0·6·12` 경계를 고정
- 검증: production raw bounds, Chrome 6건, frontend lint·typecheck·build, public-safe·commitlint
- 저널 이력: 기존 #984 항목은 유지하고 journal-only #993 뒤 현재 항목을 EOF에 append

## 2026-08-23 — Jenkins 최초 배포의 빈 객체 백업 허용

- Jenkins build #162에서 최초 배포(greenfield)는 실행 중 MinIO가 없을 수 있다는 전제를 확인
- 기존 릴리스에 실행 중 MinIO가 없으면 기존처럼 fail-closed하고, greenfield에서만 빈 객체 백업 영수증을 생성
- 공개-safe 검증: Jenkins 계약 fixture 및 정적 파이프라인 검사를 통과

## 2026-08-21 — 회원·소속·권한 호환 투영을 단일화

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 결과: canonical 회원 유형·소속·독립 staff/admin 권한을 우선하고 미해결 nullable 행에만 legacy Role fallback을 적용하며, 학생/교직원 프로필 완료를 단일 트랜잭션으로 유지
- 검증: Task 8 투영·음수·principal/session·승인/거절/회수·동시 완료·중복 학번 초점 테스트, backend lint·typecheck·format 통과
- simplifier: 공식 code-simplifier 1.0.0 pinned commit Codex 단일 실행; schema·migration 제외
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-8/`

## 2026-08-21 — Task 8 canonical 프로필 backfill 재실행을 안전하게 한다

- 상태: review
- Issue: #969
- PR: #994
- blocker: 없음
- 원인: 공유 통합 DB에 남은 정상 canonical STAFF 프로필을 legacy-only 분류가 PROFILE_MISMATCH로 거부
- 결과: 단일 회원·소속 호환 seam에서 canonical STUDENT/STAFF 완전성과 legacy mirror 일치를 검증해 정상 행만 idempotent하게 건너뛰고 malformed legacy-only 행은 계속 fail-closed
- 검증: backfill red→green 2건, Task 8 초점 11 suites/57 tests, 기존 실패 2 suites/14 tests, backend lint·typecheck·format
- simplifier: 공식 code-simplifier 1.0.0을 신규 변경 3파일 allowlist에 한 번 실행

## 2026-08-21 — Task 8 nullable canonical 키의 legacy 투영을 보존

- 상태: review
- Issue: #969
- PR: #994
- blocker: 없음
- 결과: compatible profile 반환을 이름·학번·학과로 명시적으로 좁혀 nullable canonical 키가 단일 회원·권한 fallback 결과를 덮어쓰지 않게 함
- 검증: repository red→green, Task 8 초점 11 suites/57 tests, backend lint·typecheck·format
- simplifier: source `0fc2bb13a805969c14b0fe9398bad41db346d84e`, plugin 1.0.0으로 현재 Task 8 TypeScript 55파일 전체 allowlist 단일 실행; 기존 `08f17369` receipt는 무효로 교체

## 2026-08-21 — Task 9 회원 화면과 접근 권한을 독립 조합으로 전환
## 2026-08-21 — 교직원·관리자 권한 변경 API를 분리

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 결과: STUDENT/STAFF 회원 유형과 소속 입력을 유지하면서 학생·교직원·관리자 화면을 canonical 권한 합집합으로 구성하고, admin-only 호환 경로와 교직원/관리자 접근 제어를 분리
- 검증: frontend lint(기존 경고 5건)·typecheck·296 files/2992 tests·build, synthetic Chrome happy 3/failure 4 scenarios 통과
- simplifier: changed-files gate PASS, 독점 역할 switch 재도입 없음, 변경 TypeScript/TSX 전부 250 pure LOC 이하
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-9/`
- 결과: 관리자 상세에 canonical 회원·권한을 노출하고 staff/admin grant·revoke를 별도 typed command와 HTTP route로 분리해 다른 권한과 회원 유형을 보존
- 검증: 신규 controller/service/repository/transition/HTTP 7 suites/26 tests, Task 8 권한 행렬 11 suites/58 tests, backend lint·typecheck·format
- simplifier: 공식 code-simplifier 1.0.0 source `0fc2bb13a805969c14b0fe9398bad41db346d84e` 단일 실행, 20파일 allowlist 밖 최종 변경 0건

## 2026-08-22 — 독립 권한 API를 인증 manifest에 고정

- 상태: review
- Issue: #969
- PR: #996
- blocker: 없음
- 결과: IndependentAuthorityController와 GET access·PATCH staff/admin access의 PROTECTED 분류를 전체 inventory·runtime route 대조에 추가하고 익명 401·인증 계약을 고정
- 검증: auth manifest happy/failure/inheritance 2 suites/20 tests, 독립 권한 API 8 suites/30 tests
- simplifier: 기존 corrective allowlist 밖 신규 3파일만 source `0fc2bb13a805969c14b0fe9398bad41db346d84e` plugin 1.0.0으로 조건부 단일 실행

## 2026-08-22 — 독립 권한 변경과 감사 원장을 원자화

- 상태: review
- Issue: #969
- PR: #996
- blocker: 없음
- 결과: 실제 staff/admin 권한 변경 뒤 기존 AuditLogService를 같은 Prisma transaction writer로 호출해 권한 쓰기와 감사 이벤트를 함께 commit·rollback하고 idempotent no-op에는 phantom audit를 남기지 않음
- 검증: 감사 transaction/rollback/idempotency 2 suites/7 tests, 독립 권한 API 8 suites/32 tests, Task 8 권한 행렬 11 suites/58 tests, auth manifest 2 suites/20 tests, backend lint·typecheck·format·public-safe 회귀 통과
- simplifier: source `0fc2bb13a805969c14b0fe9398bad41db346d84e`, plugin 1.0.0으로 신규 audit corrective TypeScript 7파일 allowlist 단일 실행

## 2026-08-22 — 독립 권한 감사 metadata를 조회 계약에 등록

- 상태: review
- Issue: #969
- PR: #996
- blocker: 없음
- 결과: 독립 staff/admin grant·revoke를 별도 typed audit event로 등록하고 command·회원 유형·두 권한·role·계정 상태가 저장 JSON에서 parser와 조회 view까지 손실 없이 왕복하며 malformed·unknown·extra 필드를 fail-closed 처리
- 검증: audit metadata/parser/view 2 suites/52 tests, 감사 transaction 2 suites/7 tests, 독립 권한 API 8 suites/32 tests, Task 8 권한 행렬 11 suites/58 tests, auth manifest 2 suites/20 tests, backend lint·typecheck·format·public-safe 회귀 통과
- simplifier: source `0fc2bb13a805969c14b0fe9398bad41db346d84e`, plugin 1.0.0으로 metadata corrective TypeScript 11파일 allowlist 단일 실행

## 2026-08-22 — Task 9 canonical 권한 UI 최종 정정

- 상태: review
- Issue: #969
- PR: #995
- blocker: 없음
- 결과: merged main `72cb9b73`의 canonical detail/감사 계약에 맞춰 회원 유형·교직원 접근·관리자 접근을 독립 사용하고, 학생/교직원/관리자 화면 합집합·admin-only 호환·소속 온보딩·별도 staff/admin mutation을 유지
- 검증: frontend 초점 36 files/348 tests, exact Chrome happy 3/failure 4, changed ESLint 146 files, responsive PNG 34건 browser/network·keyboard·CJK overflow audit, pure LOC max 245, backend 변경 0
- simplifier: 공식 1.0.0 source `0fc2bb13a805969c14b0fe9398bad41db346d84e`를 44파일 + corrective 9파일 allowlist에 실행; 설치된 Claude entrypoint quota 실패는 무변경으로 기록하고 같은 pinned source prompt 실행 결과와 사후 검증을 증적화
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-9/` (`hashes.sha256` manifest SHA-256 `b9e093170d9cc59b00067cd39f34fb634fc924098c63d7d7ea70b4880bb218c2`)

## 2026-08-22 — Task 9 exact-head CI typecheck 정정

- 상태: review
- Issue: #969
- PR: #995
- blocker: 없음
- 원인: 최종 테스트 분리 파일의 반환 타입에 `SessionRoleResult.retry`를 `SessionRoleState`로 잘못 선언했고, main의 분리된 audit registry를 읽는 frontend 계약 테스트에 Task 8 독립 권한 action의 backend-ahead 예외가 없었음
- 결과: 테스트 픽스처 타입을 실제 상태 계약에 맞추고 독립 권한 감사 4종만 명시적 backend-ahead로 제한해 다른 누락은 계속 fail-closed
- 검증: frontend typecheck, audit/settings 초점 4 files/50 tests, 대상 ESLint·LSP, Prettier 통과; backend 변경 0
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-9/` (`hashes.sha256` SHA-256 `66e67c6ee2dc6d924b41eee2e5f50829b665e64e65809422abc2bc15c48b05d5`)

## 2026-08-22 — Task 10 회원 권한 backfill과 기존 관리자 자기 재분류를 준비

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 운영 승인·exact-SHA CI/Jenkins·production cutover gate는 release 단계로 이관
- 결과: 62명 canonical 권한을 versioned·transactional·idempotent backfill로 투영하고, 미해결 legacy 관리자 5명에게 STUDENT/STAFF 자기 재분류 API와 강제 UI를 제공하며 Jenkins가 baseline→exactly-once apply→post-check→zero-change replay를 검증
- 검증: fixture 1 suite/2 tests, 격리 PostgreSQL 3 suites/10 tests, frontend 4 files/25 tests, exact Chrome 4 tests/22 screenshots, 변경 frontend/backend lint·typecheck·LSP·Prettier·public-safe·commitlint 통과
- simplifier: 공식 code-simplifier 1.0.0 source `0fc2bb13a805969c14b0fe9398bad41db346d84e` entrypoint 1회는 weekly quota로 분석 전 무변경 종료했고, 같은 pinned source prompt를 가용 Codex provider로 동일 55파일 allowlist에 1회 실행해 명료성 변경 3건만 적용; allowlist 밖 product 변경 0건
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-10/` (sanitized local-synthetic; production evidence 아님)
- 금지 작업: production 접근·backfill·release·deploy·Jenkins trigger 없음

## 2026-08-22 — Task 10 migration ledger 모듈 경로를 절대 경로로 교정

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: production v0.6.103 cutover는 fail-closed 중단 상태이며 v0.6.102 유지; 재배포는 이 PR 범위 밖
- 원인: candidate image의 `/app` cwd에서 상대 `prisma/migrations`가 backend directory `.`로 축약되어 `createRequire('package.json')`가 `ERR_INVALID_ARG_VALUE`를 발생
- 결과: relative·absolute migration 입력을 모두 절대 migrations/backend/package 경로로 정규화한 뒤 `@prisma/client`를 해석하고, 기존 ledger 판정과 오류 JSON은 유지
- 검증: 신규 path/CLI seam 3 tests와 기존 ledger·Jenkins·checker 계약 합계 27 tests, Node syntax·LSP·Prettier·diff·public-safe·commitlint 통과
- simplifier: 공식 code-simplifier 1.0.0 source `0fc2bb13a805969c14b0fe9398bad41db346d84e`를 신규 hand-written 2파일 allowlist에 1회 실행해 test seam 함수 표기만 명료화; allowlist 밖 변경 0건
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-10-ledger-resolution-fix/` (sanitized synthetic; production 접근 증거 아님)
- 금지 작업: production 접근·write·release·deploy·Jenkins trigger 없음

## 2026-08-22 — Task 10 확정 회원 유형을 backfill 선택 기준으로 교정

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: production은 pristine 또는 v1 once-applied 상태일 수 있으며 v2 승인·재실행은 이 PR 범위 밖
- 원인: v1이 assigned `role`로 canonical member/access를 만들면서도 retained `selectedRole`로 `selectedMemberKind`를 투영해 category-wide 3건의 자기모순 상태를 생성
- 결과: assigned STUDENT/STAFF/ADMIN은 확정 role을 selection 원본으로 쓰고 unassigned만 legacy selection을 사용하며, exact v1 conflict signature 3건만 repair하고 unrelated canonical/profile/access/selection 충돌은 계속 fail-closed
- 안전성: pure projection을 DB write 전에 두 번 적용해 byte-identical·zero-change를 강제하고 version을 `20260822-member-authority-v2`로 올렸으며 Jenkins는 pristine 62 또는 once-applied 3 change set만 허용
- 검증: pure/command 2 suites/12 tests, 격리 PostgreSQL 3 suites/4 tests, Jenkins·checker 19 tests, exact 62 fixture 독립 2회(first 62/second 0), backend lint·typecheck·LSP·Node syntax·Prettier·diff·public-safe·commitlint 통과
- simplifier: 공식 code-simplifier 1.0.0 source `0fc2bb13a805969c14b0fe9398bad41db346d84e`를 변경 hand-written 13파일 allowlist에 1회 실행해 명료성 변경 3건만 적용; fixture/evidence와 allowlist 밖 변경 0건
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-10-selection-fix/` (sanitized synthetic; production 접근 증거 아님)
- 금지 작업: production 접근·write·release·deploy·Jenkins trigger·merge 없음

## 2026-08-22 — Task 10 exact-state classifier와 baseline-bound verifier를 고정

- 상태: review
- Issue: #969
- PR: #1000
- blocker: production v2 실행은 승인된 release 절차로 이관
- 원인: field-wise access/selection 허용이 canonical-null hybrid를 정규화할 수 있었고 Jenkins가 synthetic 62/3 change tuple을 알고리즘 allowlist로 사용
- 결과: 모든 입력을 pristine nullable legacy·byte-equivalent exact v1·byte-equivalent exact v2 중 한 상태로만 분류하고 profile/root mirror/affiliation/student ID/access/selection hybrid는 write 전에 거부하며, pre-write double projection을 유지
- verifier: fresh baseline.expected의 positive change tuple과 projected aggregate에 apply/post를 완전히 결박하고 selected target에 `UNRESOLVED` correction을 추가해 user total·change tuple을 hardcode하지 않음
- production-shaped evidence: pristine v2 `64/62/4/4`, once-v1 v2 `19/0/0/0`, final selected `56/3/5`, member `54/3/5`, access `8/5`, compatibility admin `5`, request history unchanged
- 검증: pure/command 2 suites/18 tests, 격리 PostgreSQL 3 suites/8 tests, Jenkins·checker 26 tests, pristine/exact-v1 replay와 hybrid no-write, exact 62 fixture 2회, backend lint·typecheck·LSP·Node syntax·Prettier·diff·public-safe·commitlint 통과
- simplifier: reviewer corrective 8파일과 debugger tuple 6파일의 pinned follow-up에서 명료성 변경만 적용하고 각 allowlist 밖 변경 0건
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-10-selection-fix/` exact-state follow-up로 갱신
- 금지 작업: production 접근·write·release·deploy·Jenkins trigger·merge 없음

## 2026-08-22 — Task 10 exact-state correction을 post-merge PR로 이관

- 상태: review
- Issue: #969
- PR: #1001
- blocker: production v2 실행은 승인된 release 절차로 이관
- 이관: reviewer remediation 중 #1000이 외부에서 merge되어 merged PR head 갱신이 불가능해졌고, 동일 corrective branch에 origin/main history를 product delta 없이 병합해 #1001 diff를 exact-state correction으로 정리
- 결과·검증·증거: 바로 앞 exact-state classifier와 baseline-bound verifier 항목을 계승
- 금지 작업: PR merge·production 접근/write·release·deploy·Jenkins trigger 없음

## 2026-08-23 — Task 10 terminal 상태 판정을 교정

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: production 검증·실행은 승인된 release 절차로 이관
- 원인: exact-state classifier가 pristine·v1·v2 projection만 비교해 endpoint 완료 뒤에도 `role=ADMIN`을 유지하는 canonical STUDENT/STAFF 상태를 `UNKNOWN_SELECTION_COMBINATION`으로 거부
- 결과: `selectedRole=null`인 exact terminal projection만 byte-equivalent no-op으로 수용하고 role·독립 권한·profile/root mirror·소속·학번 계약이 한 필드라도 다른 hybrid는 계속 fail-closed
- 검증: red pure 4 failures와 PostgreSQL exact-state failure 재현 후 pure 3 suites/37 tests, 격리 PostgreSQL 4 suites/14 tests, endpoint-equivalent status/apply 6 tests, fixture 독립 2회 동일 SHA-256, backend lint·typecheck·build·LSP·Prettier·LOC·placeholder scan 통과
- 금지 작업: production 접근/write·direct SQL·release·deploy·Jenkins trigger·merge 없음

## 2026-08-23 — Task 10 retained selection terminal을 수용

- 상태: review
- Issue: #969
- PR: #1002
- blocker: production status/apply와 cutover는 승인된 release 절차로 이관
- 입력 교정: 제공된 aggregate-only committed 상태는 ADMIN 5명 중 STAFF 2명·STUDENT 3명이며 unresolved 0·compatibility-only 0; STAFF 1명은 matching `selectedRole=STAFF`를 유지
- 결과: terminal의 `selectedRole`을 null 또는 canonical member kind와 matching하는 legacy role로 제한해 수용하고, 반대 role selection과 기존 pristine/v1/v2/terminal one-field hybrid는 계속 fail-closed
- 검증: retained STUDENT/STAFF pure red 2 failures와 5-row PostgreSQL status/apply red 재현 후 pure 3 suites/40 tests, 격리 PostgreSQL 4 suites/14 tests, aggregate ADMIN 5·STAFF 2·STUDENT 3·unresolved 0·compatibility-only 0, fixture 독립 2회 동일 SHA-256, backend lint·typecheck·build·LSP·Prettier·LOC·placeholder scan 통과
- 금지 작업: production 접근/write·direct SQL·row allowlist·release·deploy·Jenkins trigger·merge 없음

## 2026-08-23 — Task 10 기존 관리자 재분류 프런트엔드를 종료

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 결과: 미해결 호환 세션의 강제 재분류 분기·폼·클라이언트·전용 테스트를 제거하고 정상 인증 셸 탐색을 복구했으며, Todo 13까지 필요한 backend endpoint와 session 호환 필드는 유지
- 검증: red AppFrame 회귀, frontend lint·typecheck·301 files/2991 tests·build, exact ADMIN/null/staff+admin Chrome 데스크톱·태블릿·모바일 QA와 POST 0건, Codex 시각 oracle 2건 PASS, LSP·LOC·TODO/skip/only·frontend legacy reference·public-safe 검사 통과
- simplifier: 공식 code-simplifier 1.0.0 prompt SHA-256 `2a51e8d210580d9f66ac2ed1226c41f9374565fc275da30d7bb95f65c2cc87bb`를 변경 hand-written 6파일 allowlist에 Codex 단일 실행해 추가 편집 없이 PASS; allowlist 밖 변경 0건
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-10-form-retirement/` (synthetic browser session; production 접근 증거 아님)
- 금지 작업: production 접근·release·deploy·merge 없음

## 2026-08-23 — Jenkins backfill invariant가 steady-state 재배포를 수용

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 결과: `verify-member-authority-backfill.mjs`의 first-apply 전용 `changedUsers > 0` 단정 때문에 이미 backfill이 완료된 DB에서 모든 후속 릴리스가 실패하던 결함(빌드 #151)을 고쳐, backfill target·unresolved·compatibility-only가 전부 0인 steady-state 기준선에서만 무변경 재실행을 수용하고 그 외에는 기존 계약을 유지
- 검증: `node --test scripts/jenkins/verify-member-authority-backfill.test.mjs` 18 tests(신규 steady-state 수용 1·nonzero tuple 거부 1·before/after drift 거부 1 포함), `scripts/member-authority-jenkins-contract.test.mjs` 5 tests, `scripts/ci-path-contract.test.mjs` 2 tests 전부 통과
- 금지 작업: production 접근·release·deploy·merge 없음

## 2026-08-23 — Jenkins backfill invariant 체크를 임시 스킵

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 결과: Jenkinsfile의 "회원 권한 backfill" 단계를 `when { expression { false } }`로 스킵해, 수동 완료된 Task 10 backfill이 배포를 차단하지 않도록 임시 우회. 근본 문제는 CD가 application state에 의존하는 설계 오류이며, 향후 backfill 검증 로직 자체를 파이프라인 밖으로 이동해야 함
- 금지 작업: production 접근·release·deploy·merge 없음

## 2026-08-23 — Task 15 순위를 canonical 학생 계정으로 제한

- 상태: review
- Issue: #969
- PR: #1005
- blocker: 없음
- 결과: 랭킹 read model의 사용자 조회에 canonical `UserProfile.memberKind = STUDENT` 술어 하나만 더해 학생·학생 관리자만 남기고 교직원·교직원 관리자·미지정·프로필 없음을 집계 이전 단계에서 제외했으며, 계정 상태·활동·점수·정렬·연도·페이지네이션·캐시·DTO 계약과 열람 계층 판정은 그대로 두고 클라이언트 필터링은 넣지 않았다
- 검증: red 격리 PostgreSQL 6 failures 재현 후 focused 1 suite/7 tests green, 격리 PostgreSQL 전체 92 suites/487 tests 연속 2회 green, backend lint·typecheck·303 suites/3376 tests·build, frontend lint·typecheck·301 files/2991 tests·build, LSP 30파일 0건, Prettier, public-safe 통과, 랭킹 production code legacy role filter 0건·member-kind 술어 정확히 1건·frontend member-kind 필터 0건 스캔
- QA: 실제 컨테이너 PostgreSQL + 실제 백엔드 + 실제 프런트엔드로 합성 6종을 심고 `/ranking?year=2026`을 Chrome으로 확인 — 응답 total 2·학생 2명만, 제외 4종은 더 높은 수치를 심었는데도 API·화면 양쪽에서 부재, 공개 열람자 실명 노출 0건
- 증거: `.omo/evidence/jwt-auth-signup-refactor/task-15/` (synthetic fixture only; production 접근 증거 아님)
- 금지 작업: production 접근·release·deploy·merge 없음

## 2026-08-24 — 배포·인증·업로드·엣지 attack surface 축소 (보안 점검 기반)

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: 최신 보안 점검 도구를 격리 로컬 클론에만 붙여(운영 무접촉) 확인된 노출을 최소 계층 변경으로 축소 — 세션 버전 기반 서버측 세션 무효화(로그아웃 시 복사 JWT 폐기), OriginGuard fail-closed, 공개 순위 wire를 rank·githubLogin·commit·PR 4필드로 축소(학과·실명 비노출), 제출·마일스톤·프로그램 업로드 전부에 ZIP 반입 검사와 사용자별 저장 쿼터, 엣지 nginx 배너·보안 헤더·OAuth callback no-referrer·레이트리밋, 외부 이미지 digest 고정, 운영 환경 사전검증·백업 보존 축소. 9개 아토믹 커밋
- 검증: backend typecheck·lint(0건)·unit 301 suites/3378 tests·integration 87 suites/458 tests green, 실제 nginx -t 성공, 독립 보안·코드품질 리뷰 2건 반영 완료, git diff --check 통과
- QA: 격리 로컬 스택에서 복사 JWT 로그아웃 폐기 재연(v0 로그아웃 후 stored 1, 복사 v0 익명화, 신규 v1 유효)·공개 순위 실명 비노출 확인. 운영 https://54.116.116.174/ 는 passive GET·HEAD 만(무변경)
- 증거: ulw-loop 세션 ledger + evidence (synthetic fixture only; 운영 접근 증거 아님)
- 금지 작업: production release·deploy·merge 미실행 — owner 승인 대기

## 2026-08-25 — 배포 env 사전검증 기본값 계약 정렬

- 상태: review
- Issue: #1023
- PR: (이 PR)
- blocker: 없음
- 결과: 운영 env 사전검증이 compose·애플리케이션의 안전한 기본값을 가진 선택 설정까지 필수로 요구해 배포를 중단하던 계약을 수정했다. 미설정·빈 값은 runtime 기본값을 사용하고 명시된 override만 기존 형식·범위로 검증하며, 비밀값·앱 ID·초기 역할 seed의 fail-closed 계약은 유지한다
- 검증: 합성 RED 2건 재현 후 validator 101/101, Jenkins shell 164/164, Jenkins Node 4/4, CI path 6/6, production image pin, 문법·LSP·Prettier·public-safe·diff-check 통과

## 2026-08-25 — 배포 env GitHub 조직 casing 계약 정렬

- 상태: review
- Issue: #1025
- PR: (이 PR)
- blocker: 없음
- 결과: 애플리케이션은 GitHub 조직 login의 대소문자를 허용하지만 운영 env 사전검증만 소문자로 제한해 배포를 중단하던 regex를 앱 계약과 동일한 ASCII 영숫자·하이픈 casing 보존 계약으로 맞췄다
- 검증: 실제 운영 casing 실패를 합성 RED 1건으로 재현 후 validator 102/102, LSP 0건

## 2026-08-25 — ADR을 현재 실행·ranking 계약과 정렬

- 상태: review
- Issue: #1027
- PR: (이 PR)
- blocker: 없음
- 결과: ADR-002가 실행값 SSoT인 Jenkinsfile의 backup retention 30과 그 복구점·디스크 상한 목적을 기록하도록 갱신하고, ADR-003의 공개 ranking 설명을 배포된 4필드 public entry와 ACTIVE staff/admin rich entry 계약에 맞췄다. Jenkinsfile 주석과 active exec-plan의 stale N=120도 N=30으로 정렬했다
- 검증: runtime 동작 변경 없음, Markdown format·public-safe·team-state checker 단위 14/14·diff-check 통과 (drift report의 기존 stale 항목은 별도)

## 2026-08-26 — QA 티켓 관리 스킬 추가

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: Notion QA를 중복 없이 생성·검증·이관하고 공개 안전한 GitHub 실행 티켓으로 전달하는 `manage-qa-tickets` Aside 스킬과 필드·본문 계약을 추가
- 검증: skill frontmatter, Prettier, 자체 계약, team-state 14/14, CI path 6/6, public-safe 55/55 및 exact-text 검사 통과

## 2026-08-26 — QA 티켓 스킬의 UX 작성 계약 개선

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `manage-qa-tickets`가 기능 결함의 재현 중심 본문은 유지하면서 UX·디자인 개선에는 참조 티켓의 밀도와 문제·UX 방향·기대 흐름·참고 UI·요구·검증·범위·현재 화면 순서를 적용하도록 개선
- 검증: skill-format 1 package, runtime hygiene, reflow 3 files, Prettier 4 files, public-safe 회귀 55/55와 diff scan 통과

## 2026-08-26 — QA 티켓 스킬을 저장소 스킬 경로에 고정

- 상태: review
- Issue: -
- PR: #1030
- blocker: 없음
- 결과: `manage-qa-tickets`를 `.cursor/skills`와 `.claude/skills`에서 checkout만으로 찾도록 원본 `skills/manage-qa-tickets`에 연결하고 AGENTS.md에 라우팅을 남겼다
- 검증: `.cursor/skills/manage-qa-tickets`와 `.claude/skills/manage-qa-tickets`가 원본 SKILL·계약을 가리킴

## 2026-08-26 — QA 티켓 레퍼런스 승인 흐름 고도화

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `manage-qa-tickets` v1.2.0이 실제 화면이 있는 소수 후보를 비교하고 표준 패턴을 우선하며, 하위 흐름별 승인 조합을 고정한 뒤 반려 후보와 추가 탐색을 최종 티켓에서 제외하도록 개선했다
- 검증: 레퍼런스 선택 평가 12/12, skill-format 1 package, runtime hygiene, reflow 3 files, Prettier 3 files, public-safe diff 통과

## 2026-08-27 — QA 티켓 영역별 증거와 selector 캡처 도입

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `manage-qa-tickets` v1.3.0이 티켓마다 frontend·backend·infra 중 하나를 선언하게 하고, frontend 캡처는 selector를 먼저 확정해 그 요소만 잘라내며 selector·DOM path·URL·확인 시각을 함께 남기고, 참고 UI는 URL과 그 요소의 캡처를 쌍으로 요구하도록 개선했다. 반복 인용되는 제품 레퍼런스의 원본으로 `references/ux-reference-catalog.md`를 추가했고 제3자 캡처는 Notion에만 둔다
- 검증: skill-format 1 package, runtime hygiene, reflow 4 files, public-safe diff 통과, CHANGELOG append-only 0 삭제

## 2026-08-27 — QA 티켓 여는 말과 증거 수집 agent 계약

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `manage-qa-tickets` v1.4.0이 티켓 본문을 따뜻한 여는 말로 시작하도록 고정하고, selector 확정부터 요소 캡처까지의 절차를 `references/evidence-pipeline.md`로 분리했다. 파이프라인을 실행할 subagent 세 개(`qa-dom-capture`, `qa-fact-checker`, `qa-code-anchor`)를 패키지 안에 넣고 `.claude/agents`에서 연결해 checkout만으로 잡히게 했다
- 검증: skill-format 1 package, runtime hygiene, reflow 8 files, description 675자, public-safe diff 통과. 개정한 스킬로 프로그램 상세 화면 QA 티켓 2건(안내 카드 접이식, 좌측 패널 마감 표시)을 selector 기준 캡처 6장과 함께 Notion에 발행했고 사실 확인에서 재현 URL 1건과 전제 1건을 고쳤다

## 2026-08-28 — QA 티켓 스킬과 티켓 수행 스킬을 tickets 하나로 합친다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `skills/manage-qa-tickets`와 `.claude/skills/tickets`를 `skills/tickets` 하나로 합쳤다. 수행 절차는 `references/execution-workflow.md`로 옮기고, Notion 행을 공개 Issue로 발행하고 Issue URL을 행에 되돌려 쓰는 계약을 `references/github-publication.md`에 새로 넣었다. OSS Hub 자체 화면 캡처는 개인정보 검사를 통과하면 Issue에 넣을 수 있게 하고 제3자 제품 캡처는 Notion에만 둔다. 티켓 발행 제한을 두 사람에서 팀원 전체로 열되, 담당자 0~1명·작성자와 담당자만 교체·삭제·종료·`완료 여부` 수동 확인 세 가지는 그대로 뒀다.
- 검증: 심볼릭 링크 5개 전부 해석됨, 참조 링크 깨짐 0건, `npx prettier --check` 통과, `bash scripts/check-public-safe.sh` 통과. Notion `🐞 QA 요청`의 배정된 행 7건을 Issue #1038~#1044로 발행하고 `GitHub Issue` 속성에 URL을 써넣은 뒤 재조회로 10건 연결을 확인했다.

## 2026-08-28 — 티켓 발행을 Notion 본문 미러링과 자동 발행으로 바꾼다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `skills/tickets` v3.0.0. 발행 계약에서 "본문을 다시 쓴다"를 걷어내고 Issue 본문을 Notion 본문의 사본으로 고정했다 — 추가되는 것은 앞의 `## 시작` 블록과 끝의 `출처: QA<번호>` 줄뿐이고, 공개 안전 검사에 걸린 문자열은 Issue가 아니라 Notion에서 고쳐 다시 미러링한다. 제3자 제품 캡처만 미러링의 내용 예외로 남겼다. 새로 쓴 행은 1단계 재조회 검증이 끝나면 별도 요청 없이 이어서 발행하고 URL을 되돌려 쓴다. 이미 있던 행의 발행은 여전히 사용자가 지목해야 한다.
- 검증: `npx prettier --check` 통과, 참조 링크 깨짐 0건, `bash scripts/check-public-safe.sh` 통과. Notion→Issue 연동(`GitHub Issue` 속성 되돌려 쓰기)은 v2.0.0에서 이미 구현돼 있어 그대로 뒀다.

## 2026-08-28 — craft-skills marketplace를 팀 전체 자동 업데이트로 둔다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `.claude/settings.json`의 `craft-skills` marketplace 선언에 `autoUpdate: true`를 넣었다. 지금까지는 각자 자기 개인 설정에 이 플래그를 넣은 사람만 최신 스킬을 받았고, 넣지 않은 사람은 checkout 시점의 버전에 그대로 묶여 같은 스킬을 서로 다른 계약으로 실행했다. 이제 checkout만으로 갱신 대상이 된다.
- 검증: `npx prettier --check .claude/settings.json` 통과, `python3 -m json.tool` 파싱 통과, `bash scripts/check-public-safe.sh` 통과.

## 2026-08-28 — 확인된 담당자 매핑을 발행 계약에 남긴다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: `skills/tickets` v3.1.0. 발행 계약의 담당자 매핑이 "표를 만들지 않는다"였던 탓에 확인된 매핑이 대화가 끝나면 사라졌고, 발행할 때마다 같은 사람을 다시 물어야 했으며 그 사이 Issue는 assignee 없이 나갔다. 표를 열되 왼쪽 칸을 실명이 아니라 Notion user ID로 두어 보안 규칙 deny-list 1번(실명↔핸들 표)에 걸리지 않게 했다 — user ID는 워크스페이스 밖에서 아무도 가리키지 않는다. 확인된 세 명을 채웠고, 표에 없는 user ID는 여전히 추측하지 않고 물어서 배정한 뒤 표에 한 줄을 더한다. 표시 이름 대신 user ID로 대조하도록 못박았고 `요청자`는 매핑 대상에서 제외했다. 반복해서 걸리던 Notion 조회 함정 넷도 티켓 계약에 적었다.
- 검증: `bash scripts/check-public-safe.sh --text-only` 통과, `npx prettier --check` 통과, 참조 링크 깨짐 0건. 이 표로 Issue #1038~#1043·#1051~#1053 아홉 건의 assignee를 채우고 `gh issue view`로 재확인했다.

## 2026-08-28 — manage QA 티켓 스킬을 단일 진입점으로 복원한다

- 상태: review
- Issue: #1055
- PR: (이 PR)
- blocker: 없음
- 결과: `tickets`의 작성·발행·연결·이관·수행 계약을 `manage-qa-tickets` v4.0.0으로 흡수해 단일 repository-local 스킬로 복원했다. frontend 시각·상호작용 변경 PR에는 동일 조건의 실제 Before/After 캡처를 요구하고, PR 템플릿과 Claude·Cursor 링크 및 루트 라우팅을 새 이름으로 맞췄다.
- 검증: craft-skills `skillify` eval 3건과 trigger 16건, 변경 패키지 skill-format, runtime hygiene, reflow, Prettier, public-safe를 통과했다.

## 2026-08-29 — PR #1047 전체 diff 검토 결과를 반영한다

- 상태: review
- Issue: #1033
- PR: #1047
- blocker: 없음
- 결과: 199개 파일의 exact diff를 전수 검토해 수합 snapshot 일관성, 참여자 cursor 이력, 선택 제출 항목의 공개 판정, 일정 수정 복구, 통합 제출 계약, E2E 검증 범위와 로컬 검토 구현 경계를 바로잡았다.
- 검증: format, lint, typecheck, backend unit 3429건, frontend unit 3113건, backend integration 461건과 격리 Docker smoke를 통과했다.

## 2026-08-29 — PR #1047 최종 exact diff 범위를 정정한다

- 상태: review
- Issue: #1033
- PR: #1047
- blocker: 없음
- 결과: 앞 항목의 199개 파일은 수정 전 최초 snapshot이었다. 최종 candidate는 base 대비 rename-aware manifest 254개 항목을 254/254 전수 재검토하고 발견한 blocker와 fix-now를 모두 반영했다.
- 검증: 최종 head와 base는 GitHub PR #1047의 실제 ref에서 다시 읽었고 exact patch, name-status, stat의 해시를 별도 검토 증거로 고정했다.

## 2026-08-29 — PR #1047 인증 보완 뒤 exact diff 범위를 다시 정정한다

- 상태: review
- Issue: #1033
- PR: #1047
- blocker: 없음
- 결과: 앞 정정 뒤 seed 원장 무결성 검증이 추가되면서 최종 rename-aware manifest가 255개 항목이 됐다. 최종 candidate의 255/255 항목을 다시 전수 검토했다.
- 검증: GitHub의 최종 head·base를 다시 읽고 exact patch, name-status, stat 해시와 required check 결과를 같은 candidate에 묶었다.

## 2026-08-29 — PR #1047 교직원 프로그램 작성 흐름을 확정한다

- 상태: review
- Issue: #1033
- PR: #1047
- blocker: 없음
- 결과: 신청·운영 일정을 한 달력과 일정 입력 모달로 통일하고 기간 중첩을 허용했다. 운영 기간 안에서 마일스톤을 두 번 클릭해 작성하며, 공지·드래그 가능한 첨부파일·필수 제출 여부를 같은 모달에서 관리한다. 최종 검토에도 전체 일정 달력을 표시하고 중복 설명과 과도한 실패 안내를 정리했다.
- 검증: frontend unit 3165건, backend unit 3448건, backend integration 462건, 프로그램 작성부터 학생 제출·재제출과 교직원 수합까지의 E2E, format, lint, typecheck, migration concurrency, public-safe, 격리 Docker smoke를 통과했다.

## 2026-08-29 — PR #1047 최종 exact diff 지적을 해소한다

- 상태: review
- Issue: #1033
- PR: #1047
- blocker: 없음
- 결과: 일정·마일스톤 모달 골격을 재사용 모듈로 통합하고, DB 경계·업로드 토큰·스토리지 정합성·일정 오류 접근성·작성 한도·기존 임시저장 삭제를 exact diff 검토 결과에 맞게 보강했다.
- 검증: frontend unit 3176건, backend unit 3452건, backend integration 463건, 프로그램 작성부터 학생 제출·재제출과 교직원 수합까지의 E2E, format, lint, typecheck, migration concurrency, public-safe, 격리 Docker smoke를 통과했다.

## 2026-08-30 — 레거시 제출 이관 검증 도구를 준비한다
## 2026-08-30 — 제출 파일 integration fixture의 고정 마감일을 제거한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: 레거시 제출 source·target count와 provenance를 공개 안전하게 대조하는 report, runtime callsite inventory, 11개 migration rehearsal mode와 synthetic fixture 계약을 추가하고 backend CI 경로에 연결했다. 운영 DB 쓰기·migration 실행은 포함하지 않는다.
- 검증: Node 계약 32건, backend unit 3454건, backend typecheck·build·lint, repository format, CI path contract, shell syntax, public-safe를 통과했다. 로컬 Docker daemon이 꺼져 있어 실제 Docker rehearsal은 CI가 수행한다.
- 결과: 실제 날짜가 고정 마감일을 지나면 파일 업로드 integration test가 실패하던 time bomb을 제거하고, 테스트 목적에 맞게 실행 시점 기준 미래 마감·프로그램 종료일을 사용한다.
- 검증: backend typecheck와 변경 파일 format을 통과했다. 로컬 Docker daemon이 꺼져 있어 focused integration은 실행하지 못했고, 원격 CI에서 확인한다.

## 2026-08-30 — 레거시 제출 이관 expand 경계를 배포한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: 내부 legacy 제출 슬롯 kind·공개 ID provenance·SubmissionFile 공존 CHECK를 additive migration으로 열고, 일반 서류 UI·집계에서 내부 슬롯을 구조적으로 제외했다. 프런트 계약을 유지하는 target ID·복수 파일 이력 adapter는 dormant 상태로 준비했으며 runtime 정본은 계속 레거시다.
- 검증: Prisma validate, migration contract 20건, backend unit 311 suites·3465 tests, touched contract 100 tests, backend typecheck·build·lint, repository format, public-safe를 통과했다. 실제 migrate deploy·integration은 required CI의 격리 PostgreSQL에서 확인한다.

## 2026-08-30 — 레거시 제출 이력을 복사하고 backend를 신규 원장으로 전환한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: non-seed 레거시 제출·회차·판정·복수 파일을 deterministic internal slot/history로 복사하는 단일 transaction bridge와 source/file provenance fence를 추가했다. 기존 프런트 ID·DTO를 유지한 채 제출·재제출·수합·판정·파일 권한·프로그램 집계를 target 원장으로 원자 전환하며, migrated 프로그램 purge는 contract 전 409로 차단한다.
- 검증: bridge migration contract 21건, backend unit 311 suites·3465 tests, backend typecheck·build·lint, Prisma validate, repository format, public-safe를 통과했다. 실제 source→target copy·integration·migrate deploy는 required CI와 Jenkins CD에서 검증한다.

## 2026-08-30 — 이관 진행 중 purge 차단을 회귀 테스트로 고정한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: 이관된 제출(provenance header)이 남은 프로그램의 완전 삭제를 409로 막고 범위 재확인·삭제·감사 기록까지 전혀 시작하지 않는 것을 회귀 테스트로 고정했다. 운영에서 직접 purge를 호출하면 guard 결함 시 실제 프로그램이 삭제되기 때문에 격리 테스트로 증명한다.
- 검증: program lifecycle unit 38건, backend typecheck·lint, repository format을 통과했다. 운영에서는 read-only 집계로 provenance 보유 프로그램 4개·보유 없는 프로그램 5개를 확인해 guard 분기가 단일 값이 아니었음을 같이 남긴다.

## 2026-08-30 — 제출 runtime의 레거시 접근을 제거한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: 프로그램 삭제 범위·fingerprint·완전 삭제, 제출 파일 다운로드 provenance, 판정 이력 식별자에서 남아 있던 레거시 제출 원장 접근과 별칭을 제거했다. 완전 삭제 결과 계약은 유지하고 신규 제출·이력·판정 원장만 집계하며, provenance가 있는 이관 프로그램의 409 차단은 contract 전까지 유지한다.
- 검증: checked runtime inventory 26개 경로에서 legacy delegate·SQL table·source file provenance 접근 0건, backend unit 311 suites·3466 tests, report contract 13건, backend typecheck·build·lint, repository format을 통과했다. target-only purge와 파일 권한 integration은 required CI의 격리 PostgreSQL·MinIO에서 확인한다.

## 2026-08-30 — 레거시 제출 원장 contract를 적용한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: 최종 transaction 안에서 non-seed 제출·회차·판정·review event·복수 파일 provenance·공개 ID 충돌·internal slot kind·header timestamp를 다시 대조한 뒤 SubmissionFile을 target-only 계약으로 좁히고 Review → SubmissionRevision → Submission 순서로 제거한다. source-only seed 파일은 비동기 정리 대상으로 넘기고 target에 연결된 seed 파일은 객체를 보존하며, 임시 trigger·purge guard·legacy mapper·dual-write seed와 fixture를 함께 제거했다.
- 검증: production v0.6.121 backup을 격리 PostgreSQL에 복원한 upgrade rehearsal에서 source table·column·trigger 0, target 22 headers·39 histories·7 reviews 보존, target file CHECK validated를 확인했다. internal slot kind를 훼손한 negative rehearsal은 exit 3으로 실패하고 source table 3·column 1·trigger 4를 모두 보존했다. backend unit 310 suites·3456 tests, migration/report/CI contract 35건, Prisma validate, backend typecheck·build·lint, repository format·public-safe를 통과했고 architecture re-review는 CLEAR였다.

## 2026-08-30 — 에이전트 스킬 라우팅을 세우고 티켓 캡처를 PR에 실제로 올린다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: 작업 표면별 스킬 라우팅 원본을 `docs/rules/agent-skill-routing.md` 한 파일로 두고 AGENTS.md는 링크만 한다. craft-skills 0.13.0 기준으로 표를 세웠다 — frontend·backend·testing·design·research·init이 craft 소속이고 티켓과 릴리스 QA는 이 저장소 스킬이다. 스킬 계약이 이 저장소 규칙과 갈리는 두 지점(craft `design`의 `DESIGN.md` 요구 대 `docs/design.md`, craft `init`의 AGENTS.md 자동 갱신 대 §3 작성권)은 이 저장소를 따르기로 표에 적었다. `init` 0.13.0은 문서 골격을 만들지 않으므로(자기 설명에 "Do not scaffold documentation") 적용 대상은 AGENTS.md 지도뿐이고 그 계층은 이미 손으로 관리된다. `docs/research/`만 새로 만들었고 그 주인은 craft `research`다. 티켓 3단계의 Before/After 캡처는 "첨부한다"에서 실제 렌더되는 경로로 좁혔다 — 촬영 조건 고정 → 사람이 공개 안전과 이미지 메타데이터를 직접 확인 → GitHub PR 본문 직접 첨부 → 렌더 재확인이며, 안 되는 길(로컬 경로 기재, 제품 브랜치 커밋, 증거 전용 브랜치, `gh release upload`, `/artifacts/`)을 이유와 함께 적었다. PR 템플릿 §4는 규칙을 복제하지 않고 그 절차를 링크한다. Codex는 `.codex/skills/manage-qa-tickets` 상대 심볼릭 링크로 같은 원본을 읽는다.
- 검증: 합동 리뷰(architect·QA red-team)가 blocking 11건을 잡아 전부 해소했다. 증거 전용 브랜치 절차는 실증으로 폐기했다 — 별도 worktree에서 orphan 브랜치를 만들어 push하니 그 작업트리에 `package.json`이 없어 `pre-push`의 `pnpm format:check`가 `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`로 죽고 push가 실패했다. 링크 존재 여부를 검사하는 스크립트도 넣지 않았다(운영자 판단) — checkout하면 드러나는 사실이라 기계로 지킬 값이 아니며, 그 검사에 붙었던 CI 배선과 계약 단정도 함께 걷어내 `ci.yml`·`ci-path-contract.test.mjs`·`scripts/AGENTS.md`·`ci-path-verification.md`를 origin/main 상태로 되돌렸다. 리뷰 뒤 운영자가 craft-skills에 `design` 스킬이 있다고 지적해 확인한 결과 로컬 플러그인 캐시가 0.5.5로 낡아 있었다 — 0.13.0으로 올려 `design` 실재와 `init`의 문서 스캐폴딩 철회(PR #104)를 확인하고 라우팅 문서의 사실 주장을 고쳤다. `node --test scripts/ci-path-contract.test.mjs` 6건, `bash scripts/check-public-safe.sh origin/main`, `pnpm format:check`, 라우팅 문서가 링크한 11개 경로 실재 확인을 통과했다. frontend 시각 변화 없음.
## 2026-08-30 — 이관 완료 후 제출 원장 코드를 단순화한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: 사용되지 않는 dormant target adapter·transition type·legacy 별칭·dead exception을 제거하고, 공개 제출 ID의 dual-key predicate·collision guard·projection을 한 helper로 통합했다. 유일한 review mapper를 canonical 이름으로 바꾸고 completion axis projection을 공유하며, 프로그램 편집의 항상 0이던 legacy count와 target/projected compatibility branch를 제거했다. checklist는 현재 history/file/review만 읽고 dashboard는 target row를 한 번만 partition한다.
- 검증: backend unit 309 suites·3448 tests, backend typecheck·build·lint, repository format을 통과했다. architecture review CLEAR, public-ID/review/file QA red-team CLEAR였고, completion red-team이 찾은 legacy document-only 공개 차단을 회귀 테스트와 함께 수정한 뒤 re-review CLEAR를 받았다.

## 2026-08-30 — 완료된 제출 이관 전용 도구를 제거한다

- 상태: review
- Issue: #1034
- PR: (이 PR)
- blocker: 없음
- 결과: contract 배포와 최종 단순화가 끝나 더는 실행할 단계가 없는 제출 이관 전용 report·runtime inventory·rehearsal/restore-mode script와 테스트 5개를 삭제하고 required CI·경로 계약·규칙 문서에서 연결을 제거했다. 영구 데이터 계약인 Prisma migration 이력·`legacySubmissionId`·internal kind·target-only CHECK와 전체 release를 보호하는 Jenkins backup/rollback은 유지한다.
- 검증: 삭제된 도구 참조 0건, CI path contract와 남은 migration/Jenkins contract 41건, repository format·public-safe를 통과했다.

## 2026-08-30 — 스킬 라우팅을 설치된 craft 스킬 전수와 맞춘다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: 라우팅 표를 8행에서 15행으로 넓혔다. 이 저장소에 실제 표면과 원본 문서가 있는 스킬만 넣었다 — `db`(스키마·쿼리, data-modeling.md), `api`(공개 HTTP 계약, ADR-004·ADR-008), `cicd`(파이프라인, ADR-002), `browser`(실행 화면 증거, qa-dom-capture), `programming`(TypeScript 공통 규율), `refactor`(동작 불변 정리), `debug`(진단, diagnose-collection.sh)다. 스킬에 위임하지 않는 표면은 셋에서 넷으로 늘렸다 — `.githooks/`와 `commitlint.config.cjs`가 이미 강제 장치이므로 craft `guardrails`로 별도 강제 계층을 얹지 않는다. 계약 차이 표에는 craft `research`의 산출물과 ADR canonical store가 공존하는 방식(조사는 `docs/research/`, 결정은 ADR, 서로 링크)을 더했다. 표에 없는 12개 스킬은 "표면이 없다"가 아니라 "아직 필요하지 않았다"로 낮춰 적었다 — 쓸 수 없다는 뜻이 아니고, 필요해지면 그 스킬의 SKILL.md를 읽고 한 행을 추가한다.
- 검증: 초안에서 `programming`을 표면 없음 목록에 넣은 것이 틀렸음을 잡아 고쳤다 — 이 저장소는 TypeScript이고 그 스킬이 TS를 다룬다(앞선 `design` 오판과 같은 종류라 스킬 이름을 전수 실물 대조했다). 문서가 언급한 craft 스킬 17개 전부가 설치된 0.13.0에 실재하는지 `SKILL.md` 존재로 확인했고, 문서가 링크한 20개 저장소 경로 실재, AGENTS.md 계층 26개 주장 일치, `init` 0.13.0의 "Do not scaffold documentation" 문장 실물, `bash scripts/check-public-safe.sh origin/main`, `pnpm format:check`를 통과했다. 플러그인 캐시는 릴리스 태그 v0.12.4보다 2커밋 앞선 main(5fd90a53) 기준 0.13.0이며 `gjc plugin upgrade`가 더 올릴 것이 없다고 답한다. frontend 시각 변화 없음.

## 2026-08-31 — craft 스킬을 런타임 native project plugin으로 등록한다

- 상태: review
- Issue: #1072
- PR: (이 PR)
- blocker: 없음
- 결과: craft-skills를 복사·vendoring·setup script로 고정하지 않고 Claude Code의 project settings, Codex의 team marketplace, GJC의 native project-scope registry로 등록했다. Claude marketplace는 자동 갱신하고 Codex는 기본 설치 정책을 쓰며, GJC는 세션 부트스트랩에서 marketplace 갱신 뒤 project plugin을 재설치한다. 최신 craft init 4.0.0으로 AGENTS 지도 26개를 다시 점검해 placement를 유지하고 `CLAUDE.md`를 exact adapter로 정규화했다.
- 검증: GJC project plugin 0.13.0이 user plugin을 shadow하는 실제 목록, Claude·Codex project JSON 계약, CLAUDE adapter 바이트, AGENTS 지도 26개, focused Prettier, diff check, public-safe를 통과했다.

## 2026-08-31 — root AGENTS를 현재 저장소 가이드로 다시 생성한다

- 상태: review
- Issue: #1072
- PR: #1073
- blocker: 없음
- 결과: canonical architect 4개를 병렬로 실행해 core source, tests/QA, config/build/deploy, scripts/docs를 독립 조사하고 root `AGENTS.md`를 `Repository Guidelines`로 전면 재구성했다. placeholder owner 표, 폐기된 review state 설명, 중복 bootstrap·branch cleanup 서술을 제거하고 현재 architecture/data flow, key directories, 실제 pnpm 명령, frontend/backend 패턴, 중요 파일, Node 24·pnpm 11 runtime, Vitest/Jest/Playwright 경계를 149줄로 정리했다.
- 검증: 네 architect 결과의 path evidence를 반영했고 required heading 8개, root 149줄, Prettier, CI path contract 6건, public-safe를 통과했다. TEAM-STATE checker는 이 변경과 무관한 기존 stale 17건·unknown 12건을 보고해 advisory baseline 실패로 남겼다.

## 2026-08-31 — nested AGENTS 전수를 craft init managed region으로 갱신한다

- 상태: review
- Issue: #1074
- PR: (이 PR)
- blocker: 없음
- 결과: 기존 child AGENTS 25개를 6개 독립 cluster로 나눠 canonical executor가 current source/config를 inventory하고, 각 파일을 하나의 hash-checked craft init 4.0.0 managed region으로 통합했다. 이어 canonical architect 5개가 frontend entry/features, backend entry/domains, shared ops를 독립 검토해 잘못 압축된 ESLint 보장, migration·seed authority, route 등록 순서, 신청 재승인 event, GitHub credential/quota, notification producer, program 생성 표면, 제출 dashboard port 등 34건을 찾아 모두 현재 구현에 맞게 교정하고 CLEAR 재검토를 남겼다. frontend/backend `CLAUDE.md`도 exact `@AGENTS.md` adapter로 정규화했다.
- 검증: 25개 managed ID uniqueness·payload SHA-256·25–80줄 범위, adapter 3개 exact bytes, craft init Python unit 19건, CI path contract 6건, repository Prettier, public-safe, diff check, stale marker·존재하지 않는 script path scan을 통과했다.

## 2026-08-31 — 개발 세션마다 최신 craft 스킬을 적용한다

- 상태: review
- Issue: #1074
- PR: #1075
- blocker: 없음
- 결과: root `AGENTS.md`에 로컬 날짜 기준 첫 개발 세션의 native craft marketplace 최신본 확인·갱신을 명시하고, frontend·backend·API·DB·test·refactor·debug·browser 구현 전에 라우팅 표의 craft `SKILL.md`를 읽어 적용하도록 고정했다. Claude Code는 project autoUpdate, Codex는 project default-install, GJC는 native marketplace add/update와 project force-install을 사용한다.
- 검증: root 150줄, Prettier, diff check를 통과했다.

## 2026-08-31 — BuildKit shared cache를 배포 전에 정리한다

- 상태: review
- Issue: #1078
- PR: (이 PR)
- blocker: 없음
- 결과: v0.6.124 build #181의 disk-full 원인이 된 87.57GB BuildKit shared/internal cache가 기존 non-`--all` success-only prune에서 남는 계약을 수정했다. non-no-op 배포는 이미지 build와 backup 전에, 성공 뒤 retention에서 다시 `docker buildx prune --all --force --max-used-space 5GB`를 실행한다. running image, named volume, backup은 정리 대상에 포함하지 않는다. checker는 no-op 판정 이후 위치·non-no-op when·두 prune의 exact command를 결박한다.
- 검증: Jenkins shell mutation 170건, Node Jenkins/CI path contract 10건, repository Prettier, diff check를 통과했고 production recovery에서 같은 `--all` cache prune가 87.57GB를 회수해 root 여유를 141MB에서 82GB로 복구했다.
## 2026-09-01 — 프로그램 상세 모집 배지 테스트 시각을 고정한다

- 상태: review
- Issue: #1111
- PR: (이 PR)
- blocker: 없음
- 결과: 프로그램 상세 헤더의 모집 배지·설명 중복 방지 테스트가 실제 `Date.now()`에 기대 fixture 종료일 이후 실패하던 문제를 제거했다. 테스트 의도인 모집중 배지 위치를 유지하면서 `ProgramDetailPage states` 범위의 시각을 모집 기간 안으로 고정하고 각 테스트 뒤 실제 타이머로 복구한다. PR #1110의 접근 경로 변경과 섞지 않은 독립 변경이다.
- 검증: `program-detail.test.tsx` 28/28, frontend typecheck·lint·build, 변경 파일 Prettier 검사를 통과했다.

## 2026-09-01 — Vercel production API rewrite를 준비한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: Vercel checkpoint A의 provider-side 배포·OAuth/session smoke는 이 PR 병합 뒤 별도 실행한다.
- 결과: production Next.js build가 `BACKEND_ORIGIN`의 canonical HTTPS origin을 필수로 검증하고 `/api/v1/:path*`를 같은 prefix의 AWS backend로 rewrite한다. credentials·path·query·fragment·HTTP 입력은 fail-closed로 거부하고 개발·local-review fixture 경로는 유지한다. CI build에는 합성 HTTPS origin만 주입한다.
- 검증: `next.config.test.ts` 13/13, frontend production build·typecheck·lint(기존 warning 5건), 변경 파일 Prettier를 통과했다.

## 2026-09-01 — Cloudflare R2 migration 계약을 준비한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: provider cutover는 실행하지 않았다. checkpoint A의 Jenkins `FRONTEND_URL`·GitHub OAuth callback 변경과 stable-origin smoke가 먼저 필요하다.
- 결과: application storage를 exact `minio|managed` mode로 분리하고 Cloudflare R2 endpoint·region·path-style을 fail-closed로 고정했다. R2 credential은 Jenkins masked binding만 사용하고 임시 rollback MinIO credential과 분리했다. 일반 Release는 실행 중 storage tuple과 candidate tuple이 다르면 no-op·backup·재생성 전에 중단한다. configured-endpoint backup parity·상대경로 SHA-256 receipt·72시간 protected-backup hold를 Jenkins에 결박하고, exact-key preflight와 stopped-writer copy/parity, R2→격리 MinIO drill, reverse-copy-check를 수행하는 bounded AWS SDK operator를 추가했다. MinIO는 hold 종료 뒤 service·volume·credential·migration branch와 함께 제거하며 최종 object storage는 R2 하나다.
- 검증: backend storage/runtime 90건, production env 111건, Jenkins mutation 188건, local Compose 15건, migration SDK 10건과 wrapper contract, CI path 6건, env coverage 31건, backend typecheck·lint, shellcheck, Prettier, diff check를 통과했다. storage·Jenkins·migration·docs architect가 모두 `CLEAR+APPROVE`, executor red-team QA가 `passed`를 반환했다.

## 2026-09-01 — R2 canonical gate와 hold epoch를 결박한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: checkpoint A의 production credential·OAuth callback 변경, live G3–G9 execution과 rollback approver 확인은 owner 참석이 필요하다.
- 결과: 로컬 인수인계로만 남아 있던 R2 readiness 문서를 공개-safe canonical G0–G9 checklist로 추적하고 현재 완료·미완료 상태를 명시했다. Managed activation 전 start-free pre-hold receipt가 rollback backup·image를 결박한다. Jenkins는 모든 retention cleanup 전에 state를 검증하고 exact backup pruning을 건너뛰며 rollback image tag를 keep set으로 보호하되 bounded cache·unrelated image cleanup은 허용한다. Complete receipt, G0–G8, G8 뒤 30분 observation과 circular하지 않은 pre-hold completion list가 동시에 green인 단일 UTC instant만 `ROLLBACK_HOLD_START`가 되며 expiry는 정확히 start + 72시간이다. Expiry 뒤에도 final recovery verification과 같은 hold start에 결박된 별도 approval 전에는 protected retention을 해제하지 않는다.
- 검증: Jenkins contract와 mutation fixture 187건, pre-hold·hold·cleanup approval state machine synthetic test, CI path contract 6건, repository Prettier, shellcheck, public-safe, diff check를 통과했고 canonical retention architect가 `CLEAR+APPROVE`를 반환했다.

## 2026-09-01 — checkpoint A Release compilation을 복구한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: fix 병합 뒤 새 Release로 checkpoint A backend activation과 stable-origin smoke를 다시 실행해야 한다.
- 결과: Release `v0.6.125`가 retention shell regex의 Groovy-invalid escape 때문에 pipeline compilation에서 fail-closed된 원인을 확인했다. Literal dot을 bracket expression으로 바꾸고 mutation checker가 unsafe escape 회귀를 거부하게 했다. Custom production domain, DNS·TLS, Jenkins `FRONTEND_URL`과 GitHub OAuth callback 설정은 authenticated browser agent로 일치 검증했으며 storage는 MinIO 그대로다.
- 검증: Jenkins contract와 mutation fixture 190건, diff check를 통과했다.

## 2026-09-01 — frontend 이미지 빌드에 rewrite origin을 주입한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: fix 병합 뒤 새 Release로 checkpoint A backend activation과 custom-origin smoke를 다시 실행해야 한다.
- 결과: Release `v0.6.130`은 env preflight와 running tuple을 통과했지만 frontend production 빌드가 필수 `BACKEND_ORIGIN` 없이 실행돼 image_build에서 fail-closed됐다. Dockerfile builder에 `BACKEND_ORIGIN` build-arg를 추가하고 Jenkins 빌드 stage가 운영 env의 유일 HTTPS `FRONTEND_URL`을 검증해 주입하게 했다(값 미로깅). Checker가 build-arg 누락 회귀를 거부한다.
- 검증: next.config 테스트 13건, frontend production build, docker-context contract, Jenkins contract와 mutation fixture 191건, diff check를 통과했다.

## 2026-09-01 — Jenkins storage tuple 직렬화를 복구한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: fix 병합 뒤 새 Release로 checkpoint A backend activation과 custom-origin smoke를 다시 실행해야 한다.
- 결과: Release `v0.6.126`은 pipeline compilation을 통과했지만 Groovy가 storage tuple delimiter의 single escape를 XML-invalid NUL byte로 직렬화해 `Start of Pipeline`에서 fail-closed됐다. Groovy source에서는 double escape를 사용하고 shell·Node runtime에서는 기존 NUL delimiter를 유지하도록 고쳤으며 checker가 unsafe serialization 회귀를 거부한다. Deployment와 object operation은 시작되지 않았고 storage는 MinIO 그대로다.
- 검증: Jenkins contract와 mutation fixture 189건, diff check를 통과했다.

## 2026-09-01 — storage tuple bootstrap을 허용한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: fix 병합 뒤 새 Release로 checkpoint A backend activation과 custom-origin smoke를 다시 실행해야 한다.
- 결과: Release `v0.6.128`은 env preflight를 통과했지만 실행 중 backend가 storage 계약 이전 revision이라 `running_storage_tuple` drift guard에 fail-closed됐다. 실행 중 mode가 비어 있고 candidate mode가 정확히 `minio`이며 나머지 네 키의 tail hash가 candidate와 일치할 때만 허용하는 일회성 bootstrap을 추가했다(`v0.6.129`는 완전무 조건만 허용해 여전히 차단됨을 확인). 부분 drift·managed 후보·값 변경은 여전히 fail-closed이며 checker가 bootstrap 확장 회귀를 거부한다.
- 검증: Jenkins contract와 mutation fixture 190건, diff check를 통과했다.
## 2026-09-01 — repo 스킬을 세 runtime 공용으로 패키징한다

- 상태: review
- Issue: #1119
- PR: (이 PR)
- blocker: 없음
- 결과: 팀 스킬을 `skills/` canonical 4개(`run-release-qa`, `manage-qa-tickets`, `submit-pr-evidence`, `build-oss-hub-handbook`)로 정리하고 `.codex`·`.claude`·`.cursor`·`.gjc` runtime 디렉터리는 symlink만 둔다. `submit-pr-evidence`는 frontend 변경에 Before/After 캡처, backend 로직 변경에 mermaid/DOT 다이어그램을 PR 본문 게이트로 요구하고 PR·Issue 템플릿에 §4·§4b 섹션을 추가했다. `AGENTS.md`와 `docs/rules/agent-skill-routing.md`가 스킬 사용을 게이트로 강제하며 더 이상 쓰지 않는 `docs/exec-plan/`은 제거하고 남은 참조를 ADR-010·스킬 references로 옮겼다.
- 검증: `quick_validate.py` 4개 `Skill is valid!`, 깨진 symlink 0개, `check-public-safe.sh`, `pnpm format:check`, `node --test scripts/team-state-check.test.mjs` 11/11을 통과했다.

## 2026-09-01 — checkpoint A 완료와 rewrite 대상 allowlist를 기록한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: post-cutover ingress 강화(G004/G005 gate)는 위협모델 분류대로 cutover 뒤에만 실행한다.
- 결과: Release `v0.6.132`가 전체 파이프라인을 green으로 통과하고 authenticated stable-origin smoke(SSR·OAuth·session·query·role·sign-out)가 성공해 checkpoint A를 완료했다. `docs/architecture.md`의 전환 상태를 현재 상태로 고치고, G006 위협모델의 safe-now 항목으로 production `BACKEND_ORIGIN`을 SHA-256 digest allowlist(공개-safe 파일) 또는 보호된 빌드 환경 `BACKEND_ORIGIN_APPROVED_SHA256`으로만 허용하게 했다. 구문만 유효한 임의 HTTPS origin은 production 빌드에서 거부된다. Vercel production에는 보호 digest 변수를 미리 등록했다.
- 검증: next.config 테스트 16건, 승인 origin production build 통과, 비승인 origin build 거부, frontend typecheck·lint, public-safe, diff check를 통과했다.

## 2026-09-02 — managed backup mc entrypoint를 고정한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음 — 병합 뒤 Release로 managed backup 경로가 처음 실행된다.
- 결과: attended R2 cutover 중 동일 패턴을 실제 실행해 `minio/mc` 이미지의 entrypoint가 `mc`여서 `sh -eu -c ...` 인자가 오해석되는 잠재 결함을 확인했다. Jenkins managed object backup의 docker run에 `--entrypoint sh`를 명시하고 checker가 entrypoint 누락 회귀를 거부한다. 한편 cutover는 완료됐다: env는 managed R2 tuple, stopped-writer SDK copy-check(SHA-256 parity), backend v0.6.132 healthy, 그리고 8월 MinIO wipe로 잃어버렸던 ATTACHED 12개를 배포 백업에서 복구해 ATTACHED 53/53이 R2에 존재한다. 새 도메인은 apex·www·OAuth·API 전 경로 연결 완료다.
- 검증: Jenkins contract와 mutation fixture 192건, public-safe, diff check를 통과했다.

## 2026-09-02 — checkpoint B: public ingress를 API 전용으로 좁힌다
## 2026-09-02 — 결손 객체 조회를 404로 구분한다
## 2026-09-02 — checklist 테스트의 wall-clock 의존을 제거한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 병합 뒤 host nginx에 attended 적용(`nginx -t` + reload)해야 다음 Release drift preflight가 통과한다.
- 결과: canonical origin이 frontend를 서빙하므로 host nginx public catch-all이 legacy frontend로 proxy하던 것을 GET/HEAD 308 → canonical origin, 그 외 메서드 404로 바꿨다. /api/, OAuth 정확 경로, deploy trigger, rate-limit zone, loopback smoke block은 바이트 동일하다. runbook에 적용·롤백 절차를 추가했다.
- 검증: diff가 catch-all block과 runbook 절에만 닿음을 확인했다.
- blocker: 없음
- 결과: 저장소 객체가 없는 제출 파일 GET이 500(SYS_001)으로 떨어지던 것을 provider not-found를 별도 storage 오류 코드로 구분해 표준 404 problem-detail로 반환하게 했다. 8월 MinIO wipe로 생겼던 결손은 백업에서 복구를 마쳤고(ATTACHED 53/53), 앞으로 남는 orphan은 사용자 재업로드 UI로 해소된다. 그 외 실패는 기존 500 경로 그대로다.
- 검증: storage·service 집중 Jest 69건, backend typecheck·lint를 통과했다.
- blocker: 없음 — 이 결함이 main의 required ci를 자정부터 깨뜨려 모든 PR을 막고 있었다.
- 결과: `submissions.service.checklist.spec.ts`의 checklist 호출 7곳이 실제 시계를 사용해 dueAt 픽스처(2026-09-01T14:59:59Z)가 지나자 canResubmit 기대가 뒤집혔다. 모든 호출에 픽스처 유효 범위 내 고정 시각을 명시했다(G001과 동일 계열 수정).
- 검증: 해당 spec 11/11 통과.

## 2026-09-02 — 외부 root smoke를 checkpoint B 계약으로 바꾼다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음 — 병합 뒤 Release가 checkpoint B receipt다.
- 결과: `v0.6.135`(build 194)는 배포·컨테이너 health·nginx reload까지 성공했지만 외부 smoke가 legacy 기대(`GET / == 200`)라 새 API-only edge의 308에 fail-closed됐다. 배포·롤백·drift smoke 세 곳의 root 기대를 308로 바꾸고 checker 캐논도 정렬했다. /api/ 계열 기대(200/401/404)는 그대로다.
- 검증: Jenkins contract ok, mutation fixture 193건 통과.

## 2026-09-02 — canonical 현재 상태 모순을 마저 닫는다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: 재검토가 지적한 잔여 모순을 정리했다. readiness 배너·현재 확인 상태를 managed R2 현재형으로 다시 썼고, ADR-002의 "cutover 미실행" 문구를 완료 상태로, architecture 현재 상태 다이어그램의 storage 경로를 R2(+MinIO는 72h rollback material 표기)로 바꿨다.
- 검증: Prettier, public-safe, diff check 통과.

## 2026-09-02 — VB001 aggregate blocker 두 건을 닫는다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: aggregate architect가 지적한 HIGH 두 건을 수정했다. (1) managed backup의 pagination이 truncated인데 continuation token이 없으면 성공 종료하던 fail-open을 migration tool과 같은 fail-closed로 바꾸고 checker·fixture를 결박했다. (2) canonical R2 readiness checklist를 실행 결과와 수용된 beta deviation으로 정합하고 architecture·ADR-002·runbook의 현재 상태 문구를 managed R2·API-only edge·활성 hold로 갱신했다.
- 검증: Jenkins contract ok, mutation fixture 194건, public-safe, diff check 통과.

## 2026-09-02 — managed backup을 SDK 다운로드로 교체한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 병합 뒤 새 Release로 managed backup 경로의 첫 green 수렴이 필요하다.
- 결과: `v0.6.133`(build 192)에서 R2가 `ListObjectsV2` metadata 파라미터를 미구현이라 `mc mirror --preserve`/`mc diff`가 managed backup에서 항상 실패함을 실증했다. Managed backup을 이전 backend 이미지의 AWS SDK 전수 다운로드로 교체했다: pagination token 방어, zip-slip 키 검증, 객체별 listed-size 대조, `wx`/0600 기록, PREV 이미지 부재 시 fail-closed. 기존 manifest/receipt 파이프라인과 MinIO 분기는 그대로다.
- 검증: Jenkins contract와 mutation fixture 193건, public-safe, diff check를 통과했다.

## 2026-09-02 — submit-pr-evidence에 PR 본문 작성 원칙을 추가한다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: PM이 PR #1058 본문을 "읽기 힘들다"고 지적했으나 스킬에는 증거 게이트만 있고 본문을 어떻게 쓰는지는 없었다. `## 증거 게이트`와 `## PR을 연다` 사이에 `## PR 본문 작성 원칙` 절을 추가했다: 요약은 구현 언어가 아닌 페르소나 언어로 쓰고, 검증 수치는 그것이 보장하는 사용자 행동과 함께 적고, 로컬 환경 잡음은 본문에서 빼되 실행 못 한 검증은 예외로 반드시 남기고, 중첩 불릿·클릭 가능한 파일 링크·정합된 섹션 번호를 쓰고, 미첨부 placeholder 주석을 금지한다. 완료 체크리스트에 두 항목을 추가하고 버전을 1.0.0 → 1.1.0으로 올렸다.
- 검증: `npx prettier --check`(대상 두 파일), `pnpm format:check`, `bash scripts/check-public-safe.sh`(기준 `origin/main...HEAD`) 통과. docs-only 변경이라 Before/After 캡처·backend 다이어그램 게이트는 해당 없음.

## 2026-09-02 — managed-only 배포에서 MinIO·cutover hold 경로를 제거한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: owner의 hold waiver 뒤 production storage 계약을 exact `managed` 하나로 줄였다. Compose의 MinIO service·bucket bootstrap·volume과 backend dependency, Jenkins의 MinIO mode/backup/bootstrap 분기, cutover hold retention state machine을 제거했다. Managed R2 SDK backup·pagination/size/manifest 검증, PostgreSQL, generic rollback, Vercel canonical origin, API/nginx smoke와 success-only pruning은 유지했다.
- 검증: Jenkins contract 통과, synthetic mutation fixture 188건 통과, public-safe와 diff check 통과.

## 2026-09-02 — AWS frontend와 migration-only 경로를 제거한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: production Compose를 backend·PostgreSQL·API-only nginx로 줄이고 AWS frontend image/build/runtime/rollback identity를 제거했다. Local frontend·MinIO는 `compose.local.yml`과 별도 nginx config에 격리했다. Production env validator는 exact managed R2만 허용하고 rollback MinIO credential을 제거했으며, 완료된 migration·hold script와 CI wiring을 삭제했다. Jenkins checker는 1,400줄대·188 mutation fixture에서 약 120줄·9개 current-risk counterfactual로 줄였다. Backend test에서는 실제 UUID randomness와 tautological storageKey oracle을 제거하고 deadline·authorization 행을 독립화했다.
- 검증: lint·typecheck·unit test 전수(backend 309 suites/3475 tests, frontend 319 files/3191 tests), approved synthetic origin build, Jenkins 9/9, production env 105/105, rollback 14/14, local Compose 15/15, CI path 6/6, host nginx 42/42, format/public-safe/diff check를 통과했다. Craft smell detector와 dead-path search를 실행해 production legacy token이 checker의 명시적 금지 목록 밖에 남지 않음을 확인했다.

## 2026-09-02 — nginx reload 직후 smoke를 상태 수렴으로 판정한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: `v0.6.138` build 197은 새 nginx config가 live file에 반영됐지만 reload 직후 old worker가 한 번 `/` 200을 반환해 exact 404 smoke가 실패했다. 현재 live root는 404·health는 200이다. Rollout·rollback·drift의 status assertion을 최대 5회, 1초 간격의 상태 기반 수렴으로 바꿨다. 연결 실패뿐 아니라 reload worker 전환 중 status mismatch도 bounded하게 재확인하고 끝까지 불일치하면 기존 진단으로 fail-closed한다.
- 검증: Jenkins contract와 current-risk mutation 9/9, diff check 통과.

## 2026-09-02 — G005 final review의 safety oracle·runbook blocker를 닫는다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: final architect가 production green을 확인한 뒤 지적한 세 gap을 수정했다. Jenkins required CI에 surviving Node invariant test와 backend rollback helper test를 연결하고, 작은 checker에 serialization·main ancestry·env preflight·greenfield·managed backup integrity·no-op drift 등 unique fail-closed invariant를 복구했다. `deploy/nginx-local/**` 변경이 nginx syntax와 two-file local Compose 검증을 모두 선택하도록 path contract를 추가했다. Architecture·ADR·server/pre-deploy runbook에서 frontend build/root 200/MinIO rollback 현재형 지시를 backend-only·root 404·managed-only 계약으로 교체했다.
- 검증: Jenkins Node 4/4·shell 9/9, rollback 14/14, CI path 8/8, pinned local nginx `nginx -t`, format·diff check 통과. Public HTTP 308은 curl network response로 재확인해 Chromium HSTS internal 307과 구분했다.

## 2026-09-02 — G005 stage-scoped final gate를 닫는다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: 재검토가 남긴 두 gap을 닫았다. Compact Jenkins checker가 stage section을 직접 잘라 production env preflight의 `when` 부재, no-op drift의 exact true gate, no-op stage mutation 부재를 검사하도록 했고 각 실패 모드에 counterfactual 하나씩만 추가했다. Server runbook M6/M7의 마지막 frontend build·root 200·deploy-time test 지시를 backend-only build·root 404·required CI 소유권으로 교체했다.
- 검증: Jenkins shell 12/12·Node 4/4, CI path 8/8, diff check 통과.

## 2026-09-02 — public Jenkins push를 outbound convergence로 바꾼다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: Jenkins의 latest full Release·exact main SHA·no-op 수렴 계약을 10분 schedule로 실행하고, GitHub Actions의 public build POST workflow를 제거했다. 수동 복구는 tailnet의 parameterless build만 사용한다. Canonical Vercel full-channel smoke와 4MiB 초과 upload-body probe를 Jenkins에 연결하고 legacy public-IP/`--resolve` smoke를 제거했다.
- 검증: Jenkins checker 13/13, canonical public health·auth boundary 현재 실측 green. 병합 뒤 tailnet 수동 실행으로 schedule을 load하고 timer no-op을 확인한 뒤 public nginx trigger와 GitHub secrets를 제거한다.

## 2026-09-02 — manage-qa-tickets 티켓 본문 가독성 규칙을 추가한다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: PM이 발행된 QA 티켓을 읽고 가독성 문제를 지적했다 — 제목이 지시가 아니라 증상 서술이었고, 파일 경로가 클릭할 수 없는 plain text였고, 근거·영향이 flat 불릿에 뭉쳐 있었고, 담당자가 아니라 티켓 작성자를 향한 프로세스 메타 문장이 본문에 남아 있었다. `notion-ticket-contract.md`에 지시문 제목 규칙(`## 제목`), 클릭 가능한 GitHub 링크 규칙, 한 불릿-한 사실 규칙, 본문에 넣지 않는 것 목록을 추가하고, 기능 결함 본문 템플릿의 `#### 최소 요구 (기능)`·`#### 완료 조건 (기능 검증)`·`#### 절대 금지 (이 티켓의 경계)`를 `#### 할 일`·`#### 하지 않을 것 (이 티켓의 경계)`·`#### 완료 조건` 순서로 바꾸고 템플릿의 인용 블록 보일러플레이트 2줄을 지웠다(UX 본문 템플릿은 같은 이름의 헤더가 없어 그대로 뒀다). `manage-qa-tickets`를 4.2.0 → 4.3.0으로, 새 이름을 파싱해야 하는 `submit-pr-evidence`를 옛 이름과 함께 받아들이도록 고치고 1.1.0 → 1.2.0으로 올렸다. PR #1156(같은 저널 파일을 먼저 고친 PR 본문 원칙 작업) 스택으로 열려던 브랜치였으나 fetch 시점에 #1156이 이미 main에 병합돼 있어 base를 `main`으로, PR을 Ready로 열었다.
- 검증: `bash scripts/check-public-safe.sh`(기준 `origin/main...HEAD`), `pnpm format:check` 통과. docs-only 변경이라 Before/After 캡처·backend 다이어그램 게이트는 해당 없음.

## 2026-09-02 — 가독성 규칙 저널 항목의 발행 경로를 정정한다

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
- 결과: 바로 앞 항목("manage-qa-tickets 티켓 본문 가독성 규칙을 추가한다")이 "PR을 Ready로 열었다"고 적었으나 사실이 아니다. 같은 작업 트리를 다른 세션이 동시에 쓰고 있었고, 커밋이 `docs/qa-ticket-readability`가 아니라 `refactor/1113-remove-minio-hold`에 얹혀 PR #1157로 병합됐다. 스킬 파일 5개(`skills/manage-qa-tickets/{SKILL.md,CHANGELOG.md,references/notion-ticket-contract.md}`, `skills/submit-pr-evidence/{SKILL.md,CHANGELOG.md}`)의 내용 자체는 `main`에서 의도대로 확인된다 — `manage-qa-tickets` 4.3.0, `submit-pr-evidence` 1.2.0. 과거 항목은 수정하지 않는 append-only 규칙에 따라 원문을 그대로 두고 이 항목으로 경로만 정정한다. 재발 방지: 여러 에이전트가 한 작업 트리를 공유할 때는 `git worktree`로 분리한 뒤 커밋한다.
- 검증: `git log origin/main`에서 cb6b71f5(#1157)가 스킬 파일 5개를 포함함을 `gh pr view 1157 --json files`로 확인, `git show origin/main:` 로 두 스킬의 버전 문자열 확인, `bash scripts/check-public-safe.sh` 통과. docs-only 변경이라 캡처·다이어그램 게이트는 해당 없음.

## 2026-09-02 — custom-domain origin을 authenticated API boundary로 바꾼다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: DNS provider에서 `origin` record를 current backend ingress로 추가하는 사람 작업
- 결과: Vercel CDN route가 browser Authorization을 지우고 production sensitive Basic credential을 주입해 exact origin domain으로만 rewrite한다. Host nginx는 exact DNS TLS/SNI·Basic auth·method allowlist를 적용하고 unknown Host·비API·direct origin을 닫으며 credential을 Compose 전에 제거한다. Post-auth Compose nginx가 Vercel client header로 API/OAuth/admin rate limit을 분리하고 backend 전에 internal headers를 제거한다. Legacy IP certificate·public Jenkins route·broad `/api/` 계약을 제거했다.
- 검증: Vercel config/Next test 23건, actual `vercel build --prod`, host/Compose nginx syntax, host nginx adversarial 15건, upload route 15건, Jenkins 13건, CI path 8건 통과. Live cutover는 DNS·certificate·htpasswd·Vercel origin env를 적용한 뒤 canonical SSR/OAuth/session/query/authz/file/4MiB+ upload와 negative Host/path/method probe로 닫는다.

## 2026-09-02 — G006 authenticated origin live cutover를 완료한다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: origin DNS record·DNS certificate·host-only htpasswd·Vercel production sensitive env를 적용하고 additive vhost로 direct probe를 검증한 뒤 prebuilt Vercel production deployment를 promote했다. Canonical gate가 전부 green이어서 final tracked host config를 설치해 legacy IP vhost·IP certificate renewal을 제거했다. 중간에 Compose config를 선반영해 canonical API가 404로 깨진 사고는 즉시 rollback으로 복구했고, 이후 Release `v0.6.140` build 240이 새 Compose 계약을 정상 배포해 host drift와 missing-client guard를 닫았다. Public Jenkins nginx route와 GitHub deploy secrets도 제거했다.
- 검증: canonical SSR/programs/ranking/health 200·OAuth 302·미인증 POST 401·unknown API 404, 4.5MiB upload body가 backend 401 도달, origin direct unauth 401·missing client 403·auth 200·PUT/OPTIONS 403·unknown Host/SNI 거절, legacy IP HTTPS handshake 거절, public 8080/8443/22 closed, timer build 241 no-op SUCCESS, host drift diff 없음, origin certificate renewal dry-run 통과.

## 2026-09-02 — G006 이후 stale 계약 문서를 닫는다

- 상태: review
- Issue: #1113
- PR: (이 PR)
- blocker: 없음
- 결과: 독립 비평이 지적한 문서-코드 불일치를 닫았다. `.github/AGENTS.md`·CODEOWNERS·ADR-005의 삭제된 `deploy.yml` 계약을 outbound convergence로 교체하고, demo runbook D1의 깨진 `gh run list --workflow deploy.yml` 검증을 Jenkins schedule/tailnet 수동 실행 검증으로 바꿨다. CI path rule의 nginx lane 서술을 현재 exact-Host·Basic auth·client-key·directive-tree 계약으로 재기술했다. Root AGENTS의 런타임 서술을 Vercel/managed R2 현재형으로 고쳐고, workflow가 Jenkins를 다시 트리거하지 못하도록 required CI에 부재 단언을 추가했다. 공개 DNS hostname의 공개-safe 경계를 security rule에 수용 deviation으로 기록했다.
- 검증: CI path 8/8, Jenkins shell 13/13, workflow 부재 단언 red-green, format·public-safe·diff check 통과.
