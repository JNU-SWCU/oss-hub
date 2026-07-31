# TEAM-STATE — 팀 상태 스냅샷

> **이 문서는 스냅샷이다.** as-of 시각 기준의 과거이며 실시간이 아니다.
> `generated_at`에서 48시간이 지났으면 신뢰하지 말고 `gh pr list` · `gh issue list`로 직접 확인한다.
> 읽기 순서·작성권·상태 규칙은 [AGENTS.md](../../AGENTS.md)가 원본이다.
> 이 회차(4차)도 수동 생성했다. 색인 스크립트 도입 여부는 계속 보류다 —
> 이번 회차 생성만으로도 gh 조회 20여 회가 필요했다. 다음 체크포인트에서 재판정한다.

## 메타

| 항목 | 값 |
| --- | --- |
| generated_at | 2026-07-29T19:05:58+09:00 |
| source_commit | abde4af (origin/main, Release v0.4.1 자동 배포·구 Jenkins 경로 회수 포함) |
| 조회 성공 소스 | issues, prs, ci, decisions, exec-plan, branch-protection, project-board |
| 조회 실패 소스 | 없음 |

## 지난 회차 이후 바뀐 결정

지난 스냅샷(2026-07-17T12:47, b85f021) 이후 merge된 결정·계약 변경. 커밋 130여 개가
쌓였으므로 코드 변경 전부가 아니라 **결정·계약 수준 변경만** 추린다.

- **Feature Owner 배분 승인(#56 코멘트, PR 없음)** — PM이 4개 영역·Outcome Owner 경계를
  승인했다: Access & GitHub Platform(@Lumiere001) · Program & Intake(@Geuin04) ·
  Participation & Showcase(@jinsol1190-rgb) · Product Definition & Operations(@GoBeromsu).
  "의존성 체인 = 한 사람" 원칙, SSOT를 GitHub Issues로 이관(Notion Tasks 대체), 단계·순서
  기반 보드 운영에 합의했다. 승인 이후 접수 흐름 티켓(#98–#108)과 후속 웨이브(#109–#134),
  2차 웨이브(#151–#157) 총 40건이 이 배분 기준으로 발행됐다. 발행 전 2인 검수는 생략하고
  사후 검수(코멘트)로 대체하기로 합의됐다.
- **owner 전속 경로 예외 절차 추가(AGENTS.md §3, PR #148)** — PM이 명시 승인한 경우에
  한해 비소유자가 owner 전속 경로를 수정할 수 있다. PR 본문에 승인 근거를 명시하고 owner가
  사후 확인 코멘트로 추인한다.
- **정체성 User 단일화(#67, PR #69)** — 미등록 Member 모델·members 모듈을 dead code로
  제거했다. `/auth/me`의 role은 DB `User.role`이 유일 소스다(관리자 부트스트랩 자동 승격
  포함, PR #139).
- **코어 스키마 1·2차 병합(#109·#113, PR #139·#140)** — 프로그램 참여·제출·검토·저장소
  자동화 모델 16종이 merge됐다. Participation & Showcase·Access & GitHub Platform 영역
  백로그(제출·검토·저장소 자동화 티켓)가 이 스키마를 전제로 착수 가능해졌다.
- **CI: public-safe Issue·댓글 스캔 확장(#68, PR #150) → commitlint 이벤트 가드 수정(PR #159)** —
  PR #150이 `issues`·`issue_comment` 이벤트에 `public-safe-issue` job을 추가했다. 그 회귀로
  issue 이벤트에서 `commitlint` job이 `GITHUB_BASE_REF` 없이 실행돼 실패하던 버그를 PR #159
  (머지 커밋 494ac12)가 이벤트 가드(`if: github.event_name == 'pull_request'`)로 수정했다.
  issue 이벤트에서는 `public-safe-issue`만 실행된다 — 494ac12 이후 `ci` 워크플로 2회 연속
  success로 확인.
- **Release 기반 Jenkins 배포 확정(#199)** — JNU 운영 AWS 서버와 Tailscale/SSM 접근을
  수령했다. 별도 staging 서버는 두지 않고 main은 Jenkins build·test 검증만, production은
  공개 GitHub Release 발행을 승인 지점으로 사용한다. Jenkins·Docker·Node 실행 기반과
  localhost 관리 경계는 준비됐으며, exact SHA·no-op·backup·이미지 rollback 계약을 구현 중이다.
- **frontend 디자인 파운데이션·B-6 공통 컴포넌트 완결(#73·#74·#78·#80·#82·#84·#86·#136 등)** —
  Tailwind v4 + shadcn/ui 프리미티브, 레이아웃/폼/카드/테이블형 공용 컴포넌트, 랜딩 페이지,
  라우트 골격 15종, 로그인 후 역할 홈 nav 링크(자동 리다이렉트는 back-trap 문제로 제거,
  #144 후속 #147)까지 merge 완료.
- **TEAM-STATE 갱신 로컬 pre-push 가드 추가(PR #160, 선행 Issue 없음)** — `.githooks/pre-push`가
  push되는 커밋 범위에 `docs/handoff/TEAM-STATE.md` 변경이 포함됐는지 오프라인으로 검사한다.
  `main` direct push·브랜치 삭제 push는 제외하고, `TEAM_STATE_SKIP=1`로 우회하되 PR 본문에
  사유를 남긴다. AGENTS.md §3에 "PR 제출 전 TEAM-STATE 해당 행을 이 브랜치에서 갱신" 규칙이
  추가됐다. `bash scripts/setup-hooks.sh`(부트스트랩 6번)로 기존 `post-merge`와 함께 자동 활성화.

## 기능 상태

<!-- 상태 5종: planned / active / blocked / review / done. done은 PR merged + CI 통과 확인 시에만. -->

drift 검사기는 문서 전체에서 이 형식의 표 하나만 인식한다.
기존 완료 기능과 학생용 수집 App, Feature Owner 배분(#56) 확정 이후 발행된 영역별 백로그 상태를 한 표에 담고, 부분 갱신으로 남은 불일치는 아래 `CONFLICT · stale` 절에 명시한다.
같은 영역이라도 실제 진행 단계가 다르면 상태별 행으로 나눈다.

| 기능 | owner | 상태 | parent Issue | PR | CI | blocker (unblock owner) |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub OAuth 로그인 | @Lumiere001 | done | #9 | #13 (+#22) | pass | 없음 |
| GitHub 활동 수집기 | @Lumiere001 | done | #10 | #14 | pass | 없음 |
| 중첩 AGENTS 가이드 | @Lumiere001 | done | #11 | #12 (+#20) | pass | 없음 |
| public repo 보안·CI 하드닝 | @Lumiere001 | done | #31 #32 #34 #35 #38 | #39–#46 | pass | 후속 범위는 #44로 분리(완료) |
| Agent-Driven Review Cycle ADR | @GoBeromsu | done | #24 | #25 (+#50) | pass | 없음 |
| 권한 모델 개정 — 단일 accept·배포 계약 경로 PM 전속·free-role 작성권(ADR-005/ADR-002 canonical, PR A) | @GoBeromsu | review | #274 #199 | PR pending | - | 구 규칙(PM+Tech Lead 이중 accept)으로 병합 · 후속 PR B(병합 게이트 코드)·PR C(릴리스 게이트) 대기(unblock: @Lumiere001) |
| 에이전트 병합 게이트 — merge-policy required check 자동화 | @Lumiere001 | review | [#226](https://github.com/JNU-SWCU/oss-hub/issues/226) | [#225](https://github.com/JNU-SWCU/oss-hub/pull/225) merged · [#239](https://github.com/JNU-SWCU/oss-hub/pull/239) | 판정기 fixture 39/39 local pass · simulate 증거는 #239 본문 | 병합 후 실 PR dry-run 관찰 → branch protection required 등록·admin no-bypass·발행 App 전환은 ops/후속(unblock: @GoBeromsu) |
| 권한 모델 개정 — 단일 accept·배포 계약 경로 PM 전속·긴급 경로 폐지(#274, #199) | @GoBeromsu | review | [#274](https://github.com/JNU-SWCU/oss-hub/issues/274), [#199](https://github.com/JNU-SWCU/oss-hub/issues/199) | [#300](https://github.com/JNU-SWCU/oss-hub/pull/300) Draft | 판정기 fixture 47/47 local pass | ADR-005 amendment(PR A) 선병합 필요 · 이 PR 자체는 구 이중 accept 규칙으로 병합(unblock: @GoBeromsu, @Lumiere001) |
| 에이전트 병합 게이트 — check run 발행 idempotent화(required 등재 선행 조건) | @GoBeromsu | review | [#384](https://github.com/JNU-SWCU/oss-hub/issues/384) | [#386](https://github.com/JNU-SWCU/oss-hub/pull/386) | 판정기 fixture 56/56 local pass(발행 계획 9건 신규) · `--simulate` dry-run 정상 · 기존 판정 47건 무변경 통과 | 없음 — branch protection required 등재는 실 PR에서 갱신 결정론성 관찰 후 별건(unblock: @GoBeromsu) |
| PR #256 일회성 긴급 PM 코드 승인 정책 | @GoBeromsu | review | [#257](https://github.com/JNU-SWCU/oss-hub/issues/257) | [#259](https://github.com/JNU-SWCU/oss-hub/pull/259) Draft | 최초 amendment merge SHA `1b541306ef96ac0ddc17681541bd6538e5412382`의 checker는 긴급 경로 비활성 · #259 fixture 44/44 local pass | 권한 모델 개정 PR(위 행)이 긴급 경로 코드를 완전히 제거하므로 #256/#259 긴급 경로는 폐지 예정(unblock: @GoBeromsu) |
| ADR-005 병합 증거 형식 — 재현 가능한 계약 검증·검증 수단 우선순위 | @GoBeromsu | review | [#373](https://github.com/JNU-SWCU/oss-hub/issues/373) | [#375](https://github.com/JNU-SWCU/oss-hub/pull/375) | prettier·`merge-policy` fixture 47/47·public-safe 로컬 pass | 없음 — 후속 검사기 축소(dto pre-commit 훅 제거·env 계약 AST 스캔 축소)는 이 정의 개정 병합에 의존 |
| 교직원 제출 현황 매트릭스 | @Lumiere001 | review | [#124](https://github.com/JNU-SWCU/oss-hub/issues/124) | [#244](https://github.com/JNU-SWCU/oss-hub/pull/244) | backend unit 451·통합 96·frontend 247 local pass | 브라우저 QA는 OAuth 로그인 필요(unblock: @GoBeromsu 또는 사람 QA) · 셀 링크 대상 #125 검토 화면은 후속 |
| 검사기 단순화 — 환경변수 소비 지점을 manifest 하나로 lint 강제 | @GoBeromsu | review | [#381](https://github.com/JNU-SWCU/oss-hub/issues/381) | [#383](https://github.com/JNU-SWCU/oss-hub/pull/383) | backend lint exit 0(기존 위반 0건)·typecheck exit 0 · RED 4형태(멤버·계산·구조분해·동적) 발화 · GREEN 4건(인자 전달 2·spec 예외·runtime-config 예외) 통과 | 없음 — 후속 env 계약 검사기 AST 스캔 제거가 이 규칙에 의존한다 |
| Docker build context 보호 | @Lumiere001 | done | #44 | #48 | pass | 없음 |
| 정체성 User 단일화(Member dead code 제거) | @GoBeromsu | done | #67 | #69 | pass | 없음 |
| 코어 스키마 1·2차(제출·검토·저장소 자동화 16모델) | @GoBeromsu | done | #109 #113 | #139 #140 | pass | 없음 |
| 시드 데이터·역할별 테스트 계정 | @GoBeromsu | done | #110 | #142 | pass | 없음 |
| 로컬 실행 prod 정합·역할 시드 env 일원화 | @GoBeromsu | done | [#286](https://github.com/JNU-SWCU/oss-hub/issues/286) [#287](https://github.com/JNU-SWCU/oss-hub/issues/287) | [#288](https://github.com/JNU-SWCU/oss-hub/pull/288) [#289](https://github.com/JNU-SWCU/oss-hub/pull/289) [#290](https://github.com/JNU-SWCU/oss-hub/pull/290) [#291](https://github.com/JNU-SWCU/oss-hub/pull/291) merged | merge 후 main 재검증 — backend unit 801·integration 132·lint·typecheck·frontend typecheck·format pass · 전역 legacy 참조 0건 | ADR-005 이중 accept 미충족 상태에서 PM 지시로 병합(AGENTS.md §3 사후 추인 경로, #286에 요청) · Jenkins credential에 `AUTH_INITIAL_ROLES` 추가 대기 · 3계정 실로그인은 GitHub 기기 인증 필요로 미검증 |
| onboarding.md 한 장 | @GoBeromsu | done | #111 | #137 | pass | 없음 |
| 라우트 골격·역할별 패널 셸 | @GoBeromsu | done | #136 | #138 | pass | 없음 |
| 온보딩 재개 — 로그인 후 가입 미완료자를 이어가게 한다 | @Lumiere001 | review | 선행 Issue 없음 — 회차 점검 중 발견 | PR 제출 | backend 804 tests(118 suites, 신규 4건)·backend lint pass · frontend 520 tests(85 files, 신규 9건)·lint·typecheck·format pass | OAuth 콜백이 `isNew`(이번 로그인에서 계정이 처음 생겼는가)로 착지 지점을 갈라서, **첫 로그인에서 온보딩을 끝내지 못한 사용자는 두 번째 로그인부터 랜딩으로 떨어졌다** — 가입을 이어갈 경로가 화면에 드러나지 않았고, 실제로 역할이 비어 있는 계정이 관측돼 확인했다. `role`(온보딩 마지막 단계의 결과)로 갈라 재개 지점(`/consent`)으로 보낸다 — 그 화면이 완료된 단계를 건너뛰고 다음으로 전달하므로 중단 지점이 어디든 입구 하나로 재개된다. 각 단계를 개별 조회하지 않는 이유는 auth가 consent 모듈을 직접 참조하지 않기 위해서다(ADR-003). 리뷰 반영: 초기 역할이 설정된 신규 가입자(AUTH_INITIAL_ROLES)가 동의를 건너뛰던 결함을 고쳤다 — isNew 또는 role 비어 있음 중 하나라도 맞으면 입구로 보낸다. 함께: 동의·프로필·역할 세 화면에 진행 단계 표시를 추가했다(PRD §2.3 확정사항 미구현분) — 연속 3개 폼에서 끝이 보이지 않으면 중간 이탈한다. 완료 표시는 색만으로 구분하지 않고 텍스트 대안을 붙였다. 남은 것: 세 화면의 브라우저 확인은 로그인 세션이 필요해 사람 QA 몫 |
| 디자인 파운데이션(Tailwind v4·shadcn·B-6 컴포넌트) | @GoBeromsu | done | #74 #78 #80 #82 #84 | #77 #90 | pass | 없음 |
| 공통 셸 — 세션 조회 실패를 비로그인과 구분 | @Lumiere001 | review | 선행 Issue 없음 — 회차 점검 중 발견 | PR 제출 | frontend 514 tests(84 files, 신규 3건)·lint·typecheck pass · 브라우저 실측(backend 중단·정상 두 조건) | `useSessionRole`이 조회 실패를 `anonymous`로 접어 넣어 로그인한 사용자가 네트워크 단절·5xx에서 랜딩으로 밀려났다. 화면상 로그아웃처럼 보이지만 세션은 살아 있어 원인 파악도 재시도도 불가능했다. `/auth/session`은 비로그인일 때도 200으로 `isAuthenticated:false`를 돌려주므로 예외는 전부 진짜 실패다 — `error` 상태를 신설해 구분하고 재시도 수단을 붙였다. 영향 범위가 넓다(공통 훅이므로 게이트를 쓰는 화면 전체). 역할 요청 조회 실패도 `error`로 둔다 — `unassigned`로 흘리면 승인 대기 중인 사용자에게 역할 선택 화면을 보여주고 중복 요청을 유도한다. 리뷰 반영 2건: ① 게이트가 셋(auth·role·onboarding)인데 onboarding-gate가 새 `error`를 처리하지 않아 `확인 중…`에 갇혔다 — 공유 union에 값을 추가하면 모든 소비자가 소진해야 한다는 지적이 맞았다. ② 재시도가 소비자마다 지역 상태여서 본문은 복구되는데 헤더는 `GitHub으로 로그인`을 유지했다 — 한 화면에서 인증 표시가 모순됐다. 인증 세션을 `features/auth`의 모듈 수준 저장소 하나로 옮겨 모든 소비자가 `useSyncExternalStore`로 같은 스냅샷을 구독하게 했다(쿼리 캐시 라이브러리 도입 없음). 역할 요청 조회는 `features/roles` 소관이라 feature 간 직접 의존 금지 규칙에 따라 app 계층이 조합한다. 실측: 백엔드 중단 시 4경로 전부 오류·재시도 표시, `확인 중` 갇힘 0, 헤더 로그인 버튼 0 / 백엔드 정상 시 비로그인은 `/`로 이동(회귀 없음). 미해결: 미인증 사용자 차단 시 이유 표시와 로그인 후 원래 목적지 복귀는 이 PR 범위 밖(후속) |
| 접근성 — 보조색·상태 배지 명도비 | @Lumiere001 | review | [#349](https://github.com/JNU-SWCU/oss-hub/issues/349) | PR 제출 | frontend 511 tests·lint·typecheck·format pass · axe 재스캔(/programs·/archive 0건) · `text-accent` 계산색 `rgb(0,122,52)` 실측 | 보조색 `--accent`(green-500)가 흰 전경과 4.05:1로 AA 미달이었다. 배경 위 흰 글씨(role-select focus)와 밝은 배경 위 글씨·아이콘(`text-accent`) 두 형태가 같은 값이라 한 단계 내려 함께 해소했다(green-600 5.48:1). sojoong.kr anchor에서 한 칸 이동한 것이라 브랜드 판단이 필요해 Tech Lead 확인 후 진행했다 — 비텍스트 용도(`--chart-2`)는 3:1 기준이라 anchor 유지. 상태 배지는 10조합(5상태 × 라이트·다크)을 전수 계산해 **대기만 양쪽 3.99:1 미달**임을 확인하고 `--palette-amber-800`(#805814)을 신설해 해소했다(5.74:1). 대기 전경은 배지 밖 독립 텍스트로도 쓰여 흰 배경에서도 4.39:1로 미달이었다(amber-800 6.32:1) — 배지 짝만 확인하면 놓치는 조합이다. 남은 것: 이 브랜치는 main 기준이라 #340이 고치는 `--muted-foreground` 미달 4건이 랜딩에 아직 보인다. 두 PR 병합 후 0건이 된다 |
| 접근성 — `--destructive`·`--muted-foreground` 표면별 명도비 | @Lumiere001 | review | [#282](https://github.com/JNU-SWCU/oss-hub/issues/282) | [#340](https://github.com/JNU-SWCU/oss-hub/pull/340) | frontend 511 tests(84 files)·lint·typecheck pass · `@axe-core/playwright` 14경로 × 2뷰포트 WCAG 2.1 AA 위반 96→0 | 이슈 본문에 없던 결함 2건을 함께 해소함: `--destructive`의 **다크 표면 미달(3.98:1)** — 이슈는 흰 배경만 지적했으나 양쪽 표면이 같은 palette 단계(red-500)를 참조해 둘 다 미달이었고, 라이트만 어둡게 내리면 다크가 악화되므로 표면별로 red-600(라이트 5.92:1)·red-300(다크 페이지 6.81:1·카드 5.54:1)로 분리했다. `--muted-foreground`(gray-500)가 `bg-muted`(gray-50) 위에서 4.30:1 — 흰 배경(4.61:1)만 보고 정한 값으로 보이며, 카드 내부 보조 텍스트 패턴이 있는 전 화면에 해당해 gray-600(6.24:1)으로 내렸다. `docs/design.md`에 표면별 명도비 규칙 절을 신설해 재발 조건(한쪽 표면만 확인하고 같은 단계 재사용)을 명시했다. 스캔 하네스는 저장소 밖에서 실행해 신규 의존성 없음. 리뷰 반영: destructive Button variant는 배경을 같은 토큰의 반투명 tint로 만들어(`bg-destructive/10`·`hover:bg-destructive/20`) 텍스트까지 같은 토큰이면 대비가 상한에 갇혔다 — 합성 결과 라이트 hover 4.27:1·다크 카드 hover 3.28:1로 AA 미달이었다. `--destructive-on-tint`(라이트 red-700 · 다크 red-50)를 신설해 텍스트를 tint 반대 방향으로 한 단계 더 밀었고, alpha 합성을 재현하는 계산 테스트로 4개 표면의 base·hover를 고정했다(최저 4.82:1). 미해결: `pending` 배지(amber-50/amber-700) 3.99:1은 이 PR 범위 밖 — amber 램프에 더 어두운 단계 신설이 필요하며 red와 동일한 해법이 적용 가능하다(후속) · `--ring` 스코프 비대칭(#281) 그대로 열려 있음 |
| 랜딩 페이지 + 로그인 role-home nav 배선 | @GoBeromsu | done | #86 (+#136 연계) | #87 #144 #145 #146 #147 | pass | 없음 |
| 로그인·로그아웃·승인 대기 안내를 사용자 언어로 정리 | @Lumiere001 | review | [#348](https://github.com/JNU-SWCU/oss-hub/issues/348) | PR 제출 | frontend 519 tests(85 files, 신규 8건)·lint·typecheck·format pass · 브라우저 실측(`?loggedOut=1` 안내 렌더·GitHub 로그아웃 링크·role=status) | 전역 계정 메뉴가 한국어 서비스에서 영어("Signed in as / Settings / Sign out")로 노출되던 것을 로그인 계정·설정·로그아웃으로 바꿨다 — 전역 레이아웃이 공유하는 컴포넌트라 전 라우트에 반영된다. 로그아웃 후 다른 계정으로 로그인할 수 없던 문제(#348)는 GitHub 세션 잔존이 원인이고 GitHub OAuth에 계정 선택 강제 수단이 없어 코드로 해결할 수 없다 — 로그아웃 성공 시 랜딩에 표식을 붙여 "다른 계정으로 로그인하려면 GitHub에서도 로그아웃해야 한다"는 안내와 링크를 노출하는 방식으로 처리했다. 승인 대기 화면은 누가·언제 승인하는지와 **별도 알림이 발송되지 않는다는 사실**을 명시했다 — 알림 미발송을 숨기면 사용자가 알림을 기다리며 무한 대기한다. 남은 것: 승인 시 메일 알림은 운영 발신 계정 이전(#250)과 엮여 후속 |
| 랜딩 페이지 그래프 히어로 개편(승인 시안 포팅) | @GoBeromsu | review | [#271](https://github.com/JNU-SWCU/oss-hub/issues/271) | [#275](https://github.com/JNU-SWCU/oss-hub/pull/275) | frontend 498(랜딩 스모크 10건, 6섹션 전부) · lint/typecheck/build/format pass · `hero-*` 유틸리티 6종 토큰 해석 교차 확인 | Chrome DevTools Protocol로 브라우저 시각 QA 완료 — 6섹션 렌더, inverted-CTA 명도차, reduced-motion 정적 프레임, `?authError=1` role=alert 가독, 390px 뷰포트 가로 스크롤 없음 확인 · 시안의 히어로 내부 dark nav는 별도 PR로 분리 · 푸터 정책 링크 2건은 대응 라우트 부재로 생략(후속) |
| 320px 공용 내비게이션 단일 행 정렬 | @GoBeromsu | done | [#219](https://github.com/JNU-SWCU/oss-hub/issues/219) | [#223](https://github.com/JNU-SWCU/oss-hub/pull/223) merged | pass | 없음 |
| NavBar 라우터 의존 분리(`src/components` 라우터 독립) | @GoBeromsu | done | [#272](https://github.com/JNU-SWCU/oss-hub/issues/272) | [#273](https://github.com/JNU-SWCU/oss-hub/pull/273) | `grep -rn "from 'next/" apps/frontend/src/components/` 0건 · frontend 495(신규 `linkComponent` 2건 포함) · lint/typecheck/build/format pass · 브라우저 QA pass(주입된 `Link`가 client-side navigation 유지 — 클릭 후 `window` 마커 생존, pathname `/programs` 전환) · `linkComponent`에 `href` 계약을 타입으로 강제해 잘못된 주입이 컴파일에서 걸리는지 probe로 확인 | 공용 경로(#136 셸)이므로 독립 소형 PR로 분리 |
| 셸 nav 아카이브 추가 + 히어로 내부 반전 nav(`[data-surface='inverted']` 토큰 스코프) | @GoBeromsu | review | [#276](https://github.com/JNU-SWCU/oss-hub/issues/276) | [#283](https://github.com/JNU-SWCU/oss-hub/pull/283) | frontend 84 files/507 tests pass(`shell-nav.test.tsx` 3건 · `login-button.test.tsx` `data-surface="default"` 단언 추가 · 신규 `globals.css.test.ts` 표면 토큰 불변식 4건 포함) · lint/typecheck/build(`/archive` 정적 생성 확인 · 신규 `ShellNav`가 라우트 21개 전부 정상 빌드)/format:check pass | 반전 표면 결함 3건 해결함(전부 단위 테스트로는 보이지 않는 CSS 결함 — vitest는 `environment: 'node'`라 CSS를 평가하지 않는다): (1) `[data-surface='inverted']`가 `color: var(--foreground)`를 직접 선언해 `ghost` 버튼 등 색을 선언하지 않는 자손이 조상(`body`)의 계산값 대신 반전된 색을 상속하도록 고침. (2) 계정 메뉴 패널에 `data-surface="default"`를 붙이고 `[data-surface='inverted'] [data-surface='default']` 리셋 블록(명시도 0-2-0)을 추가해 반전 스코프 안에 중첩된 밝은 패널을 `:root` 값으로 되돌림 — 조상 한정 셀렉터라 반전 스코프 밖에는 영향 없음. (3) 스코프가 덮지 않던 `--destructive`를 `--hero-danger`로 매핑 — 랜딩에서 로그아웃 실패 시 `role="alert"` 텍스트가 `--palette-red-500`(어두운 히어로 위 3.38–4.40:1, AA 미달)로 렌더되던 것을 #275가 같은 목적으로 도입·검증한 토큰(9.65–12.6:1)으로 교체. **리셋 불변식을 주석에서 테스트로 옮김**: 리셋이 반전 스코프와 정확히 같은 var 집합을 되돌린다는 조건이 코드 주석만으로 지켜지고 있었다 — 9번째 var 추가 시 결함 2가 테스트 전부 초록인 채 재발하는 구조였다. `globals.css.test.ts`가 두 블록의 프로퍼티 집합 일치·양쪽 `color` 선언·리셋의 palette primitive 사용을 검사하고, 리셋에서 `--destructive`와 `color`를 각각 지워 실패를 눈으로 확인한 뒤 복원해 검증했다. **브라우저 QA 완료**(Chrome DevTools Protocol, 격리 worktree dev 서버, 1440x900·390x844): 결함 1 수정 확인(`ghost` 로그인 계산색 `rgb(255,255,255)`, 19.3:1/14.8:1) · 결함 2·3은 세션이 필요해 실제 패널과 동일한 className을 4개 위치에 주입해 비교(반전 안+리셋 = 반전 밖 평상시로 **완전 일치**, 리셋 없는 경우만 결함 재현) · 다크 모드는 `<html>`에 `.dark`를 직접 얹어 실측(반전 밖은 `.dark` 값 유지 → 리셋 누출 없음, 명시도 0-2-0 확인) · 포커스 지시자는 실제 Tab 키(`Input.dispatchKeyEvent`) 후 확인, 불투명 `border-ring` 4.04:1로 WCAG 1.4.11 통과(중간에 `outline-color` 계산값으로 1.87:1 미달 판정했다가 3배 확대 스크린샷으로 정정 — Chrome은 `outline-style: auto`에서 지정 색을 무시하고 자체 2색 링을 그린다) · `/programs`는 `data-surface` attribute 자체가 없음(`hasAttribute() === false`) · 클라이언트 전환 마커 생존. **AGENTS.md §3**: @Lumiere001 소유 경로 `apps/frontend/src/features/auth`를 5줄 수정했다(패널 `data-surface="default"` + 주석 + 테스트 단언) — PM 승인 근거를 PR 본문에 명시했고 owner 사후 확인 코멘트 대기. 후속 분리: #280(디자인 divergence — 외곽선형 로그인 버튼·GitHub 마크·nav 활성 상태) · #281(`--ring` 비대칭) · #282(`--destructive` 흰 배경 4.38:1) |
| design-sync 정합(`--status-*` 토큰 분리 · Tailwind 스캔 범위 고정 · preview 20종) | @GoBeromsu | review | 선행 Issue 없음 | [#285](https://github.com/JNU-SWCU/oss-hub/pull/285) | lint/typecheck/format:check/test pass — backend 793(126 스위트) · frontend 511(84 파일, `globals.css.test.ts` 상태 토큰 충돌 회귀 4건 추가) · `package-validate.mjs` "bundle is complete"(render hash 45/45 · render check 45/45 · 토큰 216 정의/140 참조) · 20/20 컴포넌트 grade "good" · public-safe pass(deny-list 히트 3종 — preview 4종의 학번 형태 placeholder · 백틱 at-rule에 조사가 붙어 생긴 주소 형태 후보 · 한 줄로 적힌 경로 별칭 매핑 — 은 전부 실제 히트라 스캐너가 아니라 내용을 고쳐 해소했고 `scripts/check-public-safe.sh`는 건드리지 않았다) | `--status-recruiting-*`와 `--status-approved-*`가 라이트·다크 양쪽에서 같은 값이라 "모집중"·"승인됨" 배지가 동일 색으로 렌더되던 결함을 recruiting을 navy 계열로 분리해 고쳤다 — 옛 값으로 되돌리면 신규 테스트 4건이 충돌 프로퍼티명을 지목하며 실패하는 것을 확인했다. design-sync 쪽은 `@source` 지시자가 스캔 범위를 좁힌다는 문서 서술이 사실이 아니어서(bare `@source` 지시자는 소스를 추가할 뿐 자동 탐지를 대체하지 않는다) 스캐너가 문서 산문의 클래스 이름까지 읽어 phantom 규칙을 만들고 있었다 — `source(none)`으로 자동 탐지를 끄고 conventions.md §2 어휘를 수정 후 CSS 기준으로 재생성했다. owner 전속 경로 비해당(§3 표·CODEOWNERS 대조) · §51 착수 전 Issue 선점 미이행은 PR 본문에 명시하고 판정 대기. 알려진 제약: AppShell 캡처 footer 잘림은 gitignore된 캡처 하네스 결함이라 저장소 내 수정 불가(업스트림 대상) · `pending` 배지(amber-50/amber-700) 3.99:1로 AA 미달 — amber 팔레트에 더 어두운 단계가 없어 디자인 판정 필요 |
| work-ticket 이슈 템플릿 | @GoBeromsu | done | #71 | #72 | pass | 없음 |
| ADR-004 REST 예시 도메인 교체(members→users) | @GoBeromsu | done | #76 | #91 | pass | 없음 |
| 에이전트 병합 게이트 — codeowners 단독 소유로 자동 review 요청 제거 | @GoBeromsu | review | [#396](https://github.com/JNU-SWCU/oss-hub/issues/396) | - | codeowners `@Lumiere001` 0건 · 경로 패턴 25개 동일 · `parseCodeownersPatterns` 결과 변경 전후 일치 · 판정기 fixture 69/69 pass · actor 상수 무변경 | 없음 — tech lead의 merge_ready·accept 권한과 free-role 작성권은 유지된다 |
| CI: public-safe Issue·댓글 스캔 + commitlint 이벤트 가드 | @GoBeromsu | done | #68 | #150 #159 | pass | 없음 |
| CI: public-safe 이메일 후보 도메인 형태 요건(GitHub 멘션 오탐 제거) + UTF-8 로케일 fail-closed 고정 | @GoBeromsu | review | [#304](https://github.com/JNU-SWCU/oss-hub/issues/304) | [#301](https://github.com/JNU-SWCU/oss-hub/pull/301) | `bash scripts/check-public-safe.test.sh` 52/52 pass · 멘션 문장 통과·실주소 차단 실동작 확인 | 없음 — main 병합으로 #367의 deny-list 8번(자격증명 메모·개인키 파일명 차단)과 이 PR의 후보 요건을 함께 유지함을 회귀로 고정 |
| 학생용 수집 App(private repo 포함, read-only) | @Lumiere001 | planned | #15 | - | - | 정책 전제 4건 미확정: 산정 범위·개인 repo 보존·동의 절차·App 소유·운영(unblock: @GoBeromsu). #120/#123(조직 소유 자동화 App, write 권한)과는 별개 앱임을 #15/#120 코멘트로 명확화함 — 대체 관계 아님 |
| Access & GitHub Platform 백로그(9건: 로그인 이력·시스템 상태·저장소 자동화·webhook 확장 등) | @Lumiere001 | planned | #99 #107 #108 #120 #121 #122 #123 #133 #157 | - | - | #156 설정 페이지는 #242 merge로 분리·완료 · GitHub App 인증 ADR(#120)이 저장소 자동 생성(#121)·webhook 확장(#123)의 선행 |
| 에이전트 병합 게이트 — jenkins script 추출 경로에 배포 승인 보호 확장 | @GoBeromsu | review | [#387](https://github.com/JNU-SWCU/oss-hub/issues/387) | [#388](https://github.com/JNU-SWCU/oss-hub/pull/388) | 판정기 fixture 52/52 local pass(신규 5건) · `scripts/jenkins/**` 재귀 PM 전속·인접 경로 비매칭 확인 | 없음 — 이 보호 확장이 병합된 뒤에만 P1 추출 PR을 시작한다 |
| 학생 내 저장소 조회 | @jinsol1190-rgb | review | [#122](https://github.com/JNU-SWCU/oss-hub/issues/122) | [#261](https://github.com/JNU-SWCU/oss-hub/pull/261) Draft | backend unit 7 · frontend 16 · full unit frontend 397/backend 635 · lint/typecheck/build pass | Docker CLI 부재로 신규 ownership integration spec 로컬 실행 불가 · PR CI와 owner 사후 확인 필요 |
| 관리자 사용자·역할 관리 | @GoBeromsu | done | #131 | [#231](https://github.com/JNU-SWCU/oss-hub/pull/231) merged | pass | 없음 |
| 관리자 감사 로그 | @GoBeromsu | active | #132 | - | local pass | owner-path 연동은 @Lumiere001 사후 확인 필요 |
| 공통 온보딩 프로필 입력 | @GoBeromsu | done | #153 | [#220](https://github.com/JNU-SWCU/oss-hub/pull/220) merged | pass | 없음 |
| 관리자 콘솔 개편 — UserProfile 확장 호환 전환(PR 1/12) | @GoBeromsu | review | [#402](https://github.com/JNU-SWCU/oss-hub/issues/402) | [#403](https://github.com/JNU-SWCU/oss-hub/pull/403) | backend unit 976·integration 146·frontend 542·lint/typecheck/build/format/public-safe local pass · migration 완료/미완료/invalid-partial/invalid-complete/astral/duplicate fixture pass · profile-first 관리자 이름 정렬·동시 완료·P2002 rollback pass | DB schema·backfill HIGH_RISK — exact-head MERGE_READY와 manual accept 필요 |
| 관리자 콘솔 개편 — 불변 감사 원장(PR 2/12) | @GoBeromsu | active | — | feat/admin-console-pr02-audit-ledger | backend unit 981·integration 151·lint/typecheck/build/format/public-safe local pass · append-only DB trigger·discriminated metadata schema·REACTIVATE audit write·rollback proof·tied-timestamp pagination gap/duplicate pass | DB schema migration + append-only trigger HIGH_RISK |
| 프로필 완료 전 역할 선택 차단 | @Lumiere001 | done | [#212](https://github.com/JNU-SWCU/oss-hub/issues/212) | [#221](https://github.com/JNU-SWCU/oss-hub/pull/221) merged | pass | 없음 |
| 신규 가입 OAuth 직후 동의 진입 | @GoBeromsu / @Lumiere001 | done | [#218](https://github.com/JNU-SWCU/oss-hub/issues/218) | [#222](https://github.com/JNU-SWCU/oss-hub/pull/222) merged | pass | 없음 |
| User GitHub 핸들 필드명 정리 | @Lumiere001 | done | [#224](https://github.com/JNU-SWCU/oss-hub/issues/224) | [#227](https://github.com/JNU-SWCU/oss-hub/pull/227) merged | pass | 없음 |
| 에이전트 병합 게이트 — pm 작성 pr의 review·accept 면제 | @GoBeromsu | review | [#390](https://github.com/JNU-SWCU/oss-hub/issues/390) | [#391](https://github.com/JNU-SWCU/oss-hub/pull/391) | 판정기 fixture 55/55 local pass(면제 8건 신규) · pm 작성은 배포 계약 경로도 통과 · tech lead·제3자·identity 부재는 비면제 · sha 형식·default branch 검사 유지 | 없음 — 남는 통제는 required ci·public-safe와 release accept 바인딩이다 |
| GitHub App 최소 권한·live smoke 계약 | @Lumiere001 | review | #205 | [#208](https://github.com/JNU-SWCU/oss-hub/pull/208) | #208 pass | Collection App REST read 데이터 최소화·권한 allowlist 계약 리뷰 반영 중 · 실제 실증은 비운영 App 준비 대기 |
| 관리자 수집 시스템 상태 | @Lumiere001 | review | #133 | [#260](https://github.com/JNU-SWCU/oss-hub/pull/260) | backend unit 793 · integration 127 · frontend 493 · lint/typecheck/build/format/public-safe · authenticated Aside pass · 실수집 NORMAL 실증 | PM path exception · owner @Lumiere001 사후 확인 필요 |
| webhook 처리 결과 관측 지표 | @Lumiere001 | review | #215 | [#216](https://github.com/JNU-SWCU/oss-hub/pull/216) | unit 347 · integration 64 · build pass | #221 병합 후 최신 main 재배치 완료 · 새 head CI와 재리뷰 대기 |
| 공통 랜딩 세션별 진입 CTA | @jinsol1190-rgb | done | #98 | #201 | pass | 없음 |
| 프로그램 편집·마일스톤 | @Geuin04 | review | #101 | [#228](https://github.com/JNU-SWCU/oss-hub/pull/228) | unit 387 · frontend 188 · integration 66 · lint/typecheck/build pass | 현재 로컬 환경에서 브라우저 시각 QA 불가 |
| 공개 프로그램 목록 | @Geuin04 | done | #102 | [#191](https://github.com/JNU-SWCU/oss-hub/pull/191) merged | pass | 없음 |
| Program & Intake 계획 백로그(5건: 신청·팀 구성·신청자 목록·신청 폼·운영 대시보드) | @GoBeromsu | done | #104 #105 #106 #117 #118 | [#252](https://github.com/JNU-SWCU/oss-hub/pull/252) merged | pass | PM path exception · owner @Geuin04 사후 확인 요청 · #119 승인 UI는 별도 |
| 신청 승인·반려와 저장소 생성 트리거 | @Lumiere001 | review | #119 | [#260](https://github.com/JNU-SWCU/oss-hub/pull/260) | backend unit 793 · integration 127 · frontend 493 · lint/typecheck/build/format/public-safe · authenticated Aside pass | [백엔드 #176](https://github.com/JNU-SWCU/oss-hub/pull/176) merged · 승인/반려 UI·authoritative reload·저장소 작업 상태 projection 구현 · PM path exception · owner @Lumiere001 사후 확인 필요 |
| 교직원 프로그램 생성 | @Geuin04 | done | #100 | [#189](https://github.com/JNU-SWCU/oss-hub/pull/189) merged | pass | 없음 |
| 공통 프로그램 상세 조회 | @Geuin04 | done | #103 | [#195](https://github.com/JNU-SWCU/oss-hub/pull/195) merged | pass | 없음 |
| 프로그램 생성 이탈 보호·동작 계약 | @Lumiere001 | done | #196 | #200 | pass | 없음 — 실제 브라우저 접수 E2E는 #128 통합 QA에서 수행 |
| 마일스톤 최초 제출(TEXT·REPOSITORY_RELEASE) | @Lumiere001 | done | #115 | [#217](https://github.com/JNU-SWCU/oss-hub/pull/217) merged | pass | FILE은 `Program.endAt` + private storage 후속 |
| 마일스톤 FILE 제출·보존 수명주기 | @Lumiere001 | review | #115 | [#260](https://github.com/JNU-SWCU/oss-hub/pull/260) | PostgreSQL+MinIO integration · backend unit 793 · frontend 493 · lint/typecheck/build/format/public-safe · authenticated Aside pass | production S3-compatible smoke 대기(unblock: @GoBeromsu) · PM path exception · owner @Lumiere001 사후 확인 필요 |
| 제출 체크리스트·보완 재제출 | @Lumiere001 | review | [#116](https://github.com/JNU-SWCU/oss-hub/issues/116) | [#243](https://github.com/JNU-SWCU/oss-hub/pull/243) | backend unit 460·통합 90·frontend 259 local pass | 브라우저 QA는 OAuth 로그인 필요(unblock: @GoBeromsu 또는 사람 QA) · GET checklist는 #232 선행 |
| Participation & Showcase 백로그(내 대시보드·운영 대시보드·매트릭스·검토·공개 아카이브·공개 프로필) | @jinsol1190-rgb | planned | #114 #115 #124 #125 #126 #134 #155 | - | - | #127 알림은 #242 merge로 분리·완료 · production v0.1.3 QA에서 미구현 #124 `/submissions` CTA의 404 확인 · 실제 matrix page/API 전까지 CTA 비노출 hotfix 진행 |
| 학생 마일스톤 타임라인 FILE 제출 차단 | @jinsol1190-rgb | done | [#155](https://github.com/JNU-SWCU/oss-hub/issues/155) | [#262](https://github.com/JNU-SWCU/oss-hub/pull/262) merged | frontend 408 · timeline focused 9 · lint/typecheck/build pass | 없음 — #115 FILE 업로드는 후속 |
| 학생 내 대시보드 조회 API | @jinsol1190-rgb | done | [#114](https://github.com/JNU-SWCU/oss-hub/issues/114) | [#263](https://github.com/JNU-SWCU/oss-hub/pull/263) merged | backend 650(신규 dashboard 10 포함) · frontend 408 · required merge-policy PASS | 없음 — owner 사후 확인 요청 |
| Program.endAt 종료일 필드 | @GoBeromsu | done | [#264](https://github.com/JNU-SWCU/oss-hub/issues/264) | [#265](https://github.com/JNU-SWCU/oss-hub/pull/265) merged | backend 654 · frontend 전체 · lint/typecheck/build pass | 없음 — Tech Lead 사후 확인 요청 |
| 공개 쇼케이스 allowlist projection | @GoBeromsu | done | [#266](https://github.com/JNU-SWCU/oss-hub/issues/266) | [#267](https://github.com/JNU-SWCU/oss-hub/pull/267) merged (+[#268](https://github.com/JNU-SWCU/oss-hub/pull/268) fixture hotfix) | backend 663 · CI integration 124/124 green | 없음 — Tech Lead 사후 확인 요청 |
| 공개 아카이브 목록·상세 | @jinsol1190-rgb | done | [#126](https://github.com/JNU-SWCU/oss-hub/issues/126) | [#269](https://github.com/JNU-SWCU/oss-hub/pull/269) merged | backend 669 · frontend 78 files · CI green(integration 포함) | 없음 — 익명 브라우저 QA는 #128 · owner 사후 확인 요청 |
| 공개 프로필 | @jinsol1190-rgb | review | [#134](https://github.com/JNU-SWCU/oss-hub/issues/134) | PR pending | backend 674(신규 profiles 5) · frontend 79 files(신규 public-profile) · lint/typecheck/build pass | projection-only 익명 API · 미존재/공개0건 구분 불가 404 · owner 사후 확인 필요 |
| Participation 핵심 모듈 AppModule 합성 보존 | @jinsol1190-rgb | review | [#255](https://github.com/JNU-SWCU/oss-hub/issues/255) | [#260](https://github.com/JNU-SWCU/oss-hub/pull/260) | format·lint·typecheck·build·backend unit 793·통합 127 pass | 보존 spec 중복 제거·Showcase/Profiles 포함 8개 모듈 단언은 #260에 포함 · owner 사후 확인 필요 |
| 학생 활동 타임라인 | @jinsol1190-rgb | review | #154 | [#210](https://github.com/JNU-SWCU/oss-hub/pull/210) | #210 pass | [프런트엔드 #198](https://github.com/JNU-SWCU/oss-hub/pull/198) merged · 백엔드 조회 API #210 리뷰 대기 |
| Cross-cutting E2E 스모크(접수 흐름·전체 루프) | @GoBeromsu | planned | #128 #129 | - | - | 상위 화면 티켓들 merge 진행에 따라 순차 검증 |
| 마감 알림 메일 + 수신 이메일 설정 | @GoBeromsu | done | #127 | [#242](https://github.com/JNU-SWCU/oss-hub/pull/242) merged | pass (CLI 실발송 · Aside settings) | 후속 발신 주체 이전 #250 (사업단 Gmail env 교체) |
| 공통 설정 페이지(내 정보 수정) | @GoBeromsu | done | #156 | [#242](https://github.com/JNU-SWCU/oss-hub/pull/242) merged | pass (Aside UI) | `/settings`·계정 메뉴·프로필 부분 PATCH·알림 API 본인 개방 |
| 마감 알림 발신 사업단 프로바이더 이전 | @GoBeromsu | planned | #250 | - | - | #242 파일럿 Gmail 유지 · 운영 From만 secret/env 교체 |
| Product Definition & Operations 백로그(Release 배포·Notion PRD·IA 동기화) | @GoBeromsu (결정) / @Lumiere001 (#199 구현) | active | #112 #130 #199 | [#241](https://github.com/JNU-SWCU/oss-hub/pull/241) | local verification pending | Release trigger·공개 PM override·공인 EIP TLS 종단 연결 완료 · v0.1.1 stale Prisma lint 수정 · v0.1.2는 backup/migration 뒤 backend CMD와 `dist/src/main.js` 불일치로 smoke 실패, 정상 상태 미기록 · entrypoint hotfix 및 v0.1.3 재시도 진행 · Jenkins Release 승인 게이트를 @GoBeromsu 단독 `RELEASE_ACCEPT role=PM`으로 단일화하고 `RELEASE_ACCEPT role=TECH_LEAD`·`RELEASE_OVERRIDE role=PM`을 폐지(PR C, 근거: #274·#199 2026-07-28 결정, 선행 ADR 개정 PR A 전제) |
| Jenkinsfile thinning 실행 계획 | @GoBeromsu | planned | #380 | #385 | - | G0 확인 완료 — `scripts/jenkins/**`에 deploy-contract 보호가 없었다. 보호 확장 [#388](https://github.com/JNU-SWCU/oss-hub/pull/388) 병합이 P1~P5 착수 조건 · 후속 추출 PR 전부 HIGH_RISK·@GoBeromsu PM_ACCEPT 필요 |
| Jenkins rollback 이미지 사전 검증 스크립트 추출 | @GoBeromsu | done | [#379](https://github.com/JNU-SWCU/oss-hub/issues/379) | [#393](https://github.com/JNU-SWCU/oss-hub/pull/393) merged | 스크립트 계약 18/18 · checker 94/94 · Jenkinsfile 700→641줄 · v0.5.0 실배포에서 `bash scripts/jenkins/validate-rollback-images.sh` → `ROLLBACK_PREFLIGHT=ok`, build #29 `Finished: SUCCESS` · 실행 이미지 OCI revision=15804dd 일치, backend·frontend healthy | 없음 |
| 환경 변수 응집·배포 파이프라인 단순화 | @GoBeromsu | done | [#305](https://github.com/JNU-SWCU/oss-hub/issues/305) closed | 관련 PR #306·#307·#309·#310·#311·#312·#313·#314·#316·#317·#318·#319·#321·#322·#323·#324·#325·#326·#327·#328·#329 merged · #315 superseded closed | GitHub Actions Release run 30439226526 attempt 2 SUCCESS · Jenkins #27 SUCCESS · production v0.4.1 exact revision healthy·restart 0 · loopback root·health pass · host nginx 27/27 | root `Jenkinsfile` 단일 parameterless latest-Release pipeline · exact `/build`만 공개 · `/buildWithParameters` 회수 · 제출 upload는 off-host backup gate까지 403 유지 |
| GitHub 저장소 주기 수집 스케줄러 | @GoBeromsu | review | #151 | [#260](https://github.com/JNU-SWCU/oss-hub/pull/260) | E1 실증 pass(App 4394956 설치·공개/비공개 fixture·2-instance lease·live smoke 멱등 digest) · C2 legacy/webhook runtime 제거 · backend unit 793 · integration 127 · frontend 493 · lint/typecheck/build/format/public-safe | production 배포 시 Collection App secret 주입 필요 · legacy 관측 테이블은 M3 제거 전까지 inert |
| OSS 활성화 랭킹 | @jinsol1190-rgb | review | #152 | [#194](https://github.com/JNU-SWCU/oss-hub/pull/194) | local pass | 공개 적격성 projection 부재로 endpoint·nav fail-closed 비노출 |
| 공개 랭킹 저장소 소유권 projection | @jinsol1190-rgb | done | #197 | #202 | pass | 없음 |
| 프로덕션 제출 파일 object storage(자체 호스팅 MinIO) | @GoBeromsu | done | [#292](https://github.com/JNU-SWCU/oss-hub/issues/292)·[#293](https://github.com/JNU-SWCU/oss-hub/issues/293) closed | [#302](https://github.com/JNU-SWCU/oss-hub/pull/302) merged | production `minio`·`minio-bucket` healthy · private bucket 초기화 · v0.3.1·v0.4.1 배포 성공 | `minio_data` off-host backup 완료 전 제출 upload 공개 금지 · 서버 route 403 fail-closed |
| GitHub App 개인키 파일 입력 전환 · 호스트 hot reload dev 계약 | @GoBeromsu | active | [#366](https://github.com/JNU-SWCU/oss-hub/issues/366) | Wave 1 [#367](https://github.com/JNU-SWCU/oss-hub/pull/367) merged · Wave 2 [#369](https://github.com/JNU-SWCU/oss-hub/pull/369) merged · Wave 3 [#370](https://github.com/JNU-SWCU/oss-hub/pull/370) open | Wave 1 public-safe 회귀 37/37 · Wave 2 coverage 63/63(신규 스캔 경계 2건)·backend health 200·HMR 재시작 관측 · Wave 3 backend 132 suites·958 tests(신규 29건: 로더 15·우선순위 14)·coverage 계약 exit 0·`compose config` rc=0에서 `*_FILE` 빈 값·legacy 값 유지 확인(운영 무변화) · Wave 4 드릴 8항목 실측 완료 | 7 wave 중 1·2 merged·3 open·4(드릴) 완료 · Wave 3는 파일 입력을 **수용만** 하고 `secrets:` 마운트·Jenkins 설치는 Wave 5 담당 — legacy 두 키는 `:?` 필수 유지라 R1 배포 후에도 운영은 문자열 경로로 동작(rollback 안전판) · 드릴 결론은 `SECRETS_DIR` `jenkins:1000` `2750`(setgid)+파일 `0640` — jenkins(uid 105)에 chown 권한이 없어 계획의 `1000:1000 0600`은 실현 불가, symlink 교체는 실행 중 컨테이너에 반영되지 않아 회전 시 force-recreate 필수 · Wave 3(backend `collection`·`repositories` 파일 로더)은 @Lumiere001 소유 경로 변경이라 free-role 예외로 진행(AGENTS.md §3, 원본 ADR-005) · Wave 3·5는 배포 계약 경로라 exact head/base `PM_ACCEPT` 필요 · Wave 5 착수 전 Jenkins file credential 2건 등록 + `SECRETS_DIR` root 1회 준비 필요 — unblock owner @GoBeromsu · 종점은 R1(호환)·R2(활성화) 릴리즈 2회 실배포 |
| 검사기 단순화 — DTO 이름 규칙을 eslint 단일 강제로 정리 | @GoBeromsu | review | [#377](https://github.com/JNU-SWCU/oss-hub/issues/377) | [#378](https://github.com/JNU-SWCU/oss-hub/pull/378) | eslint RED(BadNameDto·BadName 거부)→GREEN(GoodRequestDto·GoodResponseDto 통과) 실행 확인 · `bash -n` pass · ci.yml YAML 파싱 pass | 없음 — ADR-005 증거 형식 개정([#375](https://github.com/JNU-SWCU/oss-hub/pull/375)) 병합 후 등가 이전으로 처리된다 |

| 환경 계약 검사기 집합 대수 리팩터링 | @GoBeromsu | review | [#382](https://github.com/JNU-SWCU/oss-hub/issues/382) | [#389](https://github.com/JNU-SWCU/oss-hub/pull/389) | fixture 31/31 pass · 실제 검사·CI 모드 exit 0 · 구·신 compose 추출 18키 동일 · 반쪽 편집 3종 차단 · AST 참조 0건 · 3022→1718줄 | [#383](https://github.com/JNU-SWCU/oss-hub/pull/383) 병합 선행 (unblock: @GoBeromsu) |

## 외부 게이트

<!-- 팀 밖 의존만. 사람이 아니라 작업을 주어로 쓴다. -->

| 게이트 | owner | due | fallback |
| --- | --- | --- | --- |
| 지난 학기 샘플 데이터 공유 | @nrson-jnu | 2026-07-16 (경과 — 이번 회차도 수령 확인 근거 문서 없음, 상태 동일 유지) | 합성 fixture로 개발 지속 |
| 운영 TLS 종단 계약 확정(프로덕션) | @GoBeromsu | 프로덕션 배포 전(스테이징 범위 밖) | 확정 전 운영 배포에 인증 기능 미포함 |

## 상위 리스크 5

| 리스크 | owner | trigger | due | fallback |
| --- | --- | --- | --- | --- |
| `merge-policy` required check 전 수동 `MERGE_READY`·high-risk 이중 accept의 기록 누락·stale head/base 위험 | @GoBeromsu @Lumiere001 | #225 병합 후 | #226 | 병합자가 head·base full SHA와 actor를 수동 대조하고 admin bypass 금지 |
| `enforce_admins=false`로 관리자가 required check를 우회할 수 있음 | @GoBeromsu @Lumiere001 | 상시 | #226 적용 시 재검토 | push 권한을 두 owner로 제한하고 정책상 admin bypass 금지 |
| 운영 TLS 부재 시 Secure/`__Host-` 쿠키 미작동 | @GoBeromsu | 프로덕션 배포 시점 | 프로덕션 배포 전 | 외부 terminator 계약 명시 or nginx TLS 추가 |
| 수집 App Basic 한도(5,000/hr) 부족 | @Lumiere001 | 수집 대상 확대 | 8/15 전국 디지털 경진대회 전 | GitHub App 인증 ADR(#120, 발행 완료)로 흡수 — 아직 미착수 |
| 실사용 3개 행사(8/15 전국 디지털 경진대회 · 8/19–21 · 8/27–29 Full-loop) 전 40건 백로그 병렬 착수 시 DB 마이그레이션 직렬 규칙(AGENTS.md §3) 위반 위험 — 4개 영역이 동시에 스키마 접촉 가능 | @GoBeromsu | 백로그 착수 시점 | 2026-08-15 | 마이그레이션 PR은 순번 예약(Issue 코멘트)으로 직렬화, 영역 간 공용 계약·fixture 선합의(#56 배분 원칙) |

## CONFLICT · stale

<!-- 원본 간 충돌은 해결하지 않고 CONFLICT로만 표기한다(임의 해결 금지). -->

- stale — `source_commit` 이후 #191·#195·#198이 병합됐다. 이 PR에서는 #191과 #208 관련 행만 부분 갱신했으며 전체 스냅샷 갱신은 별도로 필요하다.
  #99·#151이 닫혔지만 기존 그룹 행은 아직 `planned`에 포함돼 있으며, 이 부분은 #206 범위 밖의 별도 갱신 대상으로 남긴다.
  #56(Feature Owner 배분)은 이슈 자체는 열려 있으나 마지막 코멘트로 PM 승인이 확인됐다 —
  close 여부는 PM 판단 대기이므로 여기서는 임의로 닫힌 것으로 표기하지 않는다.
