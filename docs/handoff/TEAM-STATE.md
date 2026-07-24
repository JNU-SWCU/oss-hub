# TEAM-STATE — 팀 상태 스냅샷

> **이 문서는 스냅샷이다.** as-of 시각 기준의 과거이며 실시간이 아니다.
> `generated_at`에서 48시간이 지났으면 신뢰하지 말고 `gh pr list` · `gh issue list`로 직접 확인한다.
> 읽기 순서·작성권·상태 규칙은 [AGENTS.md](../../AGENTS.md)가 원본이다.
> 이 회차(4차)도 수동 생성했다. 색인 스크립트 도입 여부는 계속 보류다 —
> 이번 회차 생성만으로도 gh 조회 20여 회가 필요했다. 다음 체크포인트에서 재판정한다.

## 메타

| 항목 | 값 |
| --- | --- |
| generated_at | 2026-07-22T11:12:39+09:00 |
| source_commit | cdb5ae1 (main) |
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
| Docker build context 보호 | @Lumiere001 | done | #44 | #48 | pass | 없음 |
| 정체성 User 단일화(Member dead code 제거) | @GoBeromsu | done | #67 | #69 | pass | 없음 |
| 코어 스키마 1·2차(제출·검토·저장소 자동화 16모델) | @GoBeromsu | done | #109 #113 | #139 #140 | pass | 없음 |
| 시드 데이터·역할별 테스트 계정 | @GoBeromsu | done | #110 | #142 | pass | 없음 |
| onboarding.md 한 장 | @GoBeromsu | done | #111 | #137 | pass | 없음 |
| 라우트 골격·역할별 패널 셸 | @GoBeromsu | done | #136 | #138 | pass | 없음 |
| 디자인 파운데이션(Tailwind v4·shadcn·B-6 컴포넌트) | @GoBeromsu | done | #74 #78 #80 #82 #84 | #77 #90 | pass | 없음 |
| 랜딩 페이지 + 로그인 role-home nav 배선 | @GoBeromsu | done | #86 (+#136 연계) | #87 #144 #145 #146 #147 | pass | 없음 |
| 320px 공용 내비게이션 단일 행 정렬 | @GoBeromsu | done | [#219](https://github.com/JNU-SWCU/oss-hub/issues/219) | [#223](https://github.com/JNU-SWCU/oss-hub/pull/223) merged | pass | 없음 |
| work-ticket 이슈 템플릿 | @GoBeromsu | done | #71 | #72 | pass | 없음 |
| ADR-004 REST 예시 도메인 교체(members→users) | @GoBeromsu | done | #76 | #91 | pass | 없음 |
| CI: public-safe Issue·댓글 스캔 + commitlint 이벤트 가드 | @GoBeromsu | done | #68 | #150 #159 | pass | 없음 |
| 학생용 수집 App(private repo 포함, read-only) | @Lumiere001 | planned | #15 | - | - | 정책 전제 4건 미확정: 산정 범위·개인 repo 보존·동의 절차·App 소유·운영(unblock: @GoBeromsu). #120/#123(조직 소유 자동화 App, write 권한)과는 별개 앱임을 #15/#120 코멘트로 명확화함 — 대체 관계 아님 |
| Access & GitHub Platform 백로그(10건: 로그인 이력·설정·시스템 상태·저장소 자동화·webhook 확장 등) | @Lumiere001 | planned | #99 #107 #108 #120 #121 #122 #123 #133 #156 #157 | - | - | GitHub App 인증 ADR(#120)이 저장소 자동 생성(#121)·webhook 확장(#123)의 선행 |
| 관리자 사용자·역할 관리 | @GoBeromsu | done | #131 | [#231](https://github.com/JNU-SWCU/oss-hub/pull/231) merged | pass | 없음 |
| 관리자 감사 로그 | @GoBeromsu | active | #132 | - | local pass | owner-path 연동은 @Lumiere001 사후 확인 필요 |
| 공통 온보딩 프로필 입력 | @GoBeromsu | done | #153 | [#220](https://github.com/JNU-SWCU/oss-hub/pull/220) merged | pass | 없음 |
| 프로필 완료 전 역할 선택 차단 | @Lumiere001 | done | [#212](https://github.com/JNU-SWCU/oss-hub/issues/212) | [#221](https://github.com/JNU-SWCU/oss-hub/pull/221) merged | pass | 없음 |
| 신규 가입 OAuth 직후 동의 진입 | @GoBeromsu / @Lumiere001 | review | [#218](https://github.com/JNU-SWCU/oss-hub/issues/218) | [#222](https://github.com/JNU-SWCU/oss-hub/pull/222) | required CI pass | main 재배치 후 exact-head Code Owner 승인 대기 |
| User GitHub 핸들 필드명 정리 | @Lumiere001 | review | [#224](https://github.com/JNU-SWCU/oss-hub/issues/224) | [#227](https://github.com/JNU-SWCU/oss-hub/pull/227) | local pass · CI pending | 없음 |
| GitHub App 최소 권한·live smoke 계약 | @Lumiere001 | review | #205 | [#208](https://github.com/JNU-SWCU/oss-hub/pull/208) | #208 pass | Collection App REST read 데이터 최소화·권한 allowlist 계약 리뷰 반영 중 · 실제 실증은 비운영 App 준비 대기 |
| webhook 처리 결과 관측 지표 | @Lumiere001 | review | #215 | [#216](https://github.com/JNU-SWCU/oss-hub/pull/216) | unit 347 · integration 64 · build pass | #221 병합 후 최신 main 재배치 완료 · 새 head CI와 재리뷰 대기 |
| 공통 랜딩 세션별 진입 CTA | @jinsol1190-rgb | done | #98 | #201 | pass | 없음 |
| 프로그램 편집·마일스톤 | @Geuin04 | planned | #101 | - | - | 연결 PR·공개 착수 근거 없음 |
| 공개 프로그램 목록 | @Geuin04 | done | #102 | [#191](https://github.com/JNU-SWCU/oss-hub/pull/191) merged | pass | 없음 |
| Program & Intake 계획 백로그(5건: 신청·팀 구성·신청자 목록·신청 폼·운영 대시보드) | @Geuin04 | planned | #104 #105 #106 #117 #118 | - | - | 연결 PR·공개 착수 근거 없음 — #106은 담당자 미착수 답변 확인 |
| 신청 승인·반려와 저장소 생성 트리거 | @Lumiere001 | active | #119 | - | #176 pass | [백엔드 #176](https://github.com/JNU-SWCU/oss-hub/pull/176) merged · #106 신청자 목록·액션 UI 병합 대기 |
| 교직원 프로그램 생성 | @Geuin04 | done | #100 | [#189](https://github.com/JNU-SWCU/oss-hub/pull/189) merged | pass | 없음 |
| 공통 프로그램 상세 조회 | @Geuin04 | done | #103 | [#195](https://github.com/JNU-SWCU/oss-hub/pull/195) merged | pass | 없음 |
| 프로그램 생성 이탈 보호·동작 계약 | @Lumiere001 | done | #196 | #200 | pass | 없음 — 실제 브라우저 접수 E2E는 #128 통합 QA에서 수행 |
| 마일스톤 최초 제출(TEXT·REPOSITORY_RELEASE) | @Lumiere001 | review | #115 | [#217](https://github.com/JNU-SWCU/oss-hub/pull/217) | 로컬 pass | 최신 main 재배치 완료 · FILE은 `Program.endAt` + private storage 후속 · 새 head CI와 정식 리뷰 대기 |
| Participation & Showcase 백로그(9건: 내 대시보드·마일스톤 제출·재제출·운영 대시보드·매트릭스·검토·공개 아카이브·알림·공개 프로필) | @jinsol1190-rgb | planned | #114 #115 #116 #124 #125 #126 #127 #134 #155 | - | - | 없음 — 코어 스키마(done) 전제 충족 |
| 학생 활동 타임라인 | @jinsol1190-rgb | review | #154 | [#210](https://github.com/JNU-SWCU/oss-hub/pull/210) | #210 pass | [프런트엔드 #198](https://github.com/JNU-SWCU/oss-hub/pull/198) merged · 백엔드 조회 API #210 리뷰 대기 |
| Cross-cutting E2E 스모크(접수 흐름·전체 루프) | @GoBeromsu | planned | #128 #129 | - | - | 상위 화면 티켓들 merge 진행에 따라 순차 검증 |
| Product Definition & Operations 백로그(Release 배포·Notion PRD·IA 동기화) | @GoBeromsu (결정) / @Lumiere001 (#199 구현) | active | #112 #130 #199 | - | local pass | AWS 서버 실행 기반 준비 완료 · Release Jenkinsfile·ADR 동기화 및 초기 Jenkins credential/webhook 구성 진행 중 |
| Data Collection·활성화 랭킹(저장소 주기 수집 스케줄러·nav 랭킹 화면) | @GoBeromsu (#151) / @Geuin04 (#152) | planned | #151 #152 | - | - | 없음 |
| 공개 랭킹 저장소 소유권 projection | @jinsol1190-rgb | done | #197 | #202 | pass | 없음 |

## 외부 게이트

<!-- 팀 밖 의존만. 사람이 아니라 작업을 주어로 쓴다. -->

| 게이트 | owner | due | fallback |
| --- | --- | --- | --- |
| 지난 학기 샘플 데이터 공유 | @nrson-jnu | 2026-07-16 (경과 — 이번 회차도 수령 확인 근거 문서 없음, 상태 동일 유지) | 합성 fixture로 개발 지속 |
| 운영 TLS 종단 계약 확정(프로덕션) | @GoBeromsu | 프로덕션 배포 전(스테이징 범위 밖) | 확정 전 운영 배포에 인증 기능 미포함 |

## 상위 리스크 5

| 리스크 | owner | trigger | due | fallback |
| --- | --- | --- | --- | --- |
| 사람 코드리뷰 없이 admin 병합으로 대체 운영 중 — 직전 4개 PR(#148·#149·#150·#159) 전부 리뷰 0건, `@GoBeromsu` 명의로 admin 병합됨 | @GoBeromsu | 매 PR 병합 | 상시 | ADR-005 독립 에이전트 리뷰(Hermes 등)를 required gate로 승격하거나 사후 샘플 감사 도입 |
| `enforce_admins=false`로 관리자가 branch protection(리뷰 1건·code-owner 승인) 우회 가능 — 실측: 위 admin 병합 4건이 이 설정으로 가능했음 | @GoBeromsu @Lumiere001 | 상시 | - | 관리자 적용 여부 팀 논의(hotfix 경로 트레이드오프) |
| 운영 TLS 부재 시 Secure/`__Host-` 쿠키 미작동 | @GoBeromsu | 프로덕션 배포 시점 | 프로덕션 배포 전 | 외부 terminator 계약 명시 or nginx TLS 추가 |
| 수집 App Basic 한도(5,000/hr) 부족 | @Lumiere001 | 수집 대상 확대 | 8/15 전국 디지털 경진대회 전 | GitHub App 인증 ADR(#120, 발행 완료)로 흡수 — 아직 미착수 |
| 실사용 3개 행사(8/15 전국 디지털 경진대회 · 8/19–21 · 8/27–29 Full-loop) 전 40건 백로그 병렬 착수 시 DB 마이그레이션 직렬 규칙(AGENTS.md §3) 위반 위험 — 4개 영역이 동시에 스키마 접촉 가능 | @GoBeromsu | 백로그 착수 시점 | 2026-08-15 | 마이그레이션 PR은 순번 예약(Issue 코멘트)으로 직렬화, 영역 간 공용 계약·fixture 선합의(#56 배분 원칙) |

## CONFLICT · stale

<!-- 원본 간 충돌은 해결하지 않고 CONFLICT로만 표기한다(임의 해결 금지). -->

- stale — `source_commit` 이후 #191·#195·#198이 병합됐다. 이 PR에서는 #191과 #208 관련 행만 부분 갱신했으며 전체 스냅샷 갱신은 별도로 필요하다.
  #99·#151이 닫혔지만 기존 그룹 행은 아직 `planned`에 포함돼 있으며, 이 부분은 #206 범위 밖의 별도 갱신 대상으로 남긴다.
  #56(Feature Owner 배분)은 이슈 자체는 열려 있으나 마지막 코멘트로 PM 승인이 확인됐다 —
  close 여부는 PM 판단 대기이므로 여기서는 임의로 닫힌 것으로 표기하지 않는다.
