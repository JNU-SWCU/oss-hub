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
