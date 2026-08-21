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
