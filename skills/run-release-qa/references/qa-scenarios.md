# QA 시나리오 — 페르소나 상호작용 매트릭스

이 문서는 반복 가능한 수동 QA 절차의 원본이다.
화면 목록이 아니라 **페르소나 간 상호작용에서 파생되는 워크플로**를 담는다 — 화면 단위로 훑으면 "각자 잘 되는데 이어지면 깨지는" 것을 잡지 못한다.
결정·계약의 원본은 각 ADR과 `docs/rules/`이며 이 문서는 링크와 ID만 남긴다.

## 페르소나 8종

| 코드 | 페르소나 | 비고 |
| --- | --- | --- |
| 외 | 비로그인(외부인) | 공개 표면만 접근 |
| 미 | role=null | 가입했으나 역할 미선택 |
| 학 | 학생(개인) | 개인형 신청 |
| 장 | 학생(팀장) | 팀 생성·참여코드 발급 |
| 원 | 학생(팀원) | 참여코드로 합류 |
| 교 | 교직원(STAFF) | 대회 운영·심사 |
| 타교 | 다른 프로그램 STAFF | 현재 전역 접근([#548](https://github.com/JNU-SWCU/oss-hub/issues/548)) |
| 관 | 관리자(ADMIN) | 접근 관리·감사·수집 |
| 비 | 비활성 계정 | `AUT_003` |

## 실행 순서 경고 — 비가역 전이

아래 전이는 같은 행에서 되돌릴 수 없다.
QA에서 먼저 건드리면 뒤 시나리오가 막히므로 **마지막에 실행하고 terminal 분기별 fixture를 분리한다.**

`Role null→non-null` · RoleRequest terminal · Application `APPROVED/REJECTED` · Review 생성 · Submission `APPROVED/REJECTED` · GithubRepository `visibility: PUBLIC`(발행 확정) · SubmissionFile `DELETED` · Outbox `PROCESSED/FAILED` · provision·invitation `SUCCEEDED/FAILED_FINAL` · canonical run terminal.

권장 순서: 조회·검증·stale·retryable·`CHANGES_REQUESTED` → 최종 판정 → 공개 확정 → 파일 삭제 → 최종 실패.

`AccountStatus`는 관리자 재활성화가 가능하고 collection `presence/visibility`는 다음 complete 관측으로 복구되므로 비가역이 아니다.

## W군 — 페르소나 간 핵심 상호작용 (15종)

**핵심 사슬**: `W2 → W4 → W5 → W6 → W7 → W8 → W9`는 끊지 않고 한 번에 이어서 돌린다.
교직원이 만든 대회가 학생에게 보이고, 학생이 신청하고, 승인되고, 저장소가 생기고, 파일을 내고, 교직원이 받아 보고 반려하고, 학생이 그 반려를 보고 다시 내는 전체 길이다.

| ID | 상호작용 | 정상 경로 | 파생 분기 | 근거 |
| --- | --- | --- | --- | --- |
| W1 | 관·교 → 교 | 역할 요청 승인(관리자 또는 교직원) → STAFF 권한 획득 | 거절 / 회수 후 접근 차단 / 대기 중 접근 차단 / 교직원은 명부·역할 변경 403 | `users/admin-access.service.ts` |
| W2 | 교 → 대회 | 대회 생성 → **학생 목록에 노출** | 모집 전·모집중·마감 상태별 노출, 편집 반영, 보관 시 목록에서 제외 | `programs.controller.ts` |
| W3 | 교 → 마일스톤 | 생성 → 학생 체크리스트 반영 | `FILE`·`TEXT`·`REPOSITORY_RELEASE` 3종, 마감일 변경, 제출 있는 마일스톤 삭제 차단 | `milestones.controller.ts` |
| W4 | 학·장·원 → 신청 | 개인형 신청 완료 | 팀 생성 → 참여코드 합류 → 팀원 정보 입력 / 중복 신청 차단 / **최소 정원 미달 차단(`APP_019`)** | `applications.service.ts` |
| W5 | 교 → 신청 판정 | 승인 → 프로비저닝 트리거 | 거절 + 사유 노출 / 거절 후 재신청 / 판정 전 본인 수정·취소 | `applications.controller.ts` |
| W6 | 프로비저닝 → 학 | repo 생성 → 초대 → `my-repos` 노출 | **최종 실패가 학생 화면에 드러나는가** / 초대 수락이 상태로 수렴하는가 | `repository-provision.worker.ts` |
| W7 | 학 → 제출 | **파일 업로드 성공** | 마감 후 차단 / 미제출 / `TEXT`·`RELEASE` 타입 / **마감 전 교체** | `submissions.controller.ts` |
| W8 | 교 → 심사 | **파일 다운로드** → 판정 | `APPROVED` / `REJECTED` / `CHANGES_REQUESTED` / 동시 심사 경합 | `submission-reviews.controller.ts` |
| W9 | 반려 → 재제출 | **학생이 반려를 보고** → 재제출 → 새 revision | 이전 이력 보존 / 교직원 재심사 / 재제출 폼 fail-closed | `submissions.service.ts` |
| W10 | 최종 반려 | `REJECTED` 확인 | **재제출 불가가 실제로 막히는가** | `submissions.service.ts` |
| W11 | 교 → 공개 확정 | 다섯 게이트 통과 → publish | 비로그인 `archive` 노출 / 게이트 미충족 차단 | `submission-reviews/AGENTS.md` |
| W12 | 마감 임박 → 알림 | 교직원 다이제스트 **실수신** | 학생 리마인드 / 미제출자 명단 정확도 / Asia/Seoul 표기 | `deadline-digest.service.ts` |
| W13 | 활동 수집 → 랭킹 | 가입자 실명 노출 | 미가입자 `githubLogin` + '미가입' 배지 / 비로그인 조회 | `ranking.service.ts` |
| W14 | 관 → 계정 상태 | 비활성화 → 접근 차단 | 재활성화 → 복구 / 자기 비활성화 차단 / 마지막 관리자 제거 차단 | `admin-access-mutation-policy.ts` |
| W15 | 감사 로그 | 판정·공개·권한 변경 기록 | 관리자 화면 조회 / **누락 3종은 [#547](https://github.com/JNU-SWCU/oss-hub/issues/547)** | `audit-log.service.ts` |

## ST군 — 상태 전이·에러 코드 파생 (19종)

사용자가 실제로 마주칠 수 있는 에러 코드를 유발하는 조작이다.
백엔드에 정의된 도메인 에러 코드는 75개이며 아래는 그중 사용자 조작으로 재현 가능한 것을 묶었다.

| ID | 상호작용 | 정상 경로 | 파생 분기(에러 코드) |
| --- | --- | --- | --- |
| ST1 | 미 → 역할 선택 | 최신 필수 동의·완료 프로필이면 `null→STUDENT` | 구정책·필수동의 누락 `CON_002/003`, 프로필 미완료 `USR_002`, 이미 확정 `ROL_002` |
| ST2 | 관 → 비활성 사용자 | `DEACTIVATED→ACTIVE` 복구 | 조회 뒤 상태 변경 `ROL_013`, 비활성 중 접근 `AUT_003` |
| ST3 | 반려된 교직원 요청 → 관 | 기존 `REJECTED` 보존 + 새 `PENDING` | 이미 `PENDING`/`APPROVED`/`REVOKED` → `ROL_003/002/008` |
| ST4 | 로그인·로그아웃 → 관 | 성공 `LOGIN`만 최근 로그인 갱신 | 실패 `LOGIN`·`LOGOUT`은 정렬값 불변 |
| ST5 | 학 → 팀 합류 | 유효 코드·잔여 정원이면 멤버 추가 | 오입력·정원 초과·신청 후 변경·이미 타 팀 → `TEAM_009/007/008/006` |
| ST6 | 최소 정원 미달 팀 → 교 | 정원 충족 시에만 신청 생성 | 미달 시 `APP_019` 차단 |
| ST7 | 교 양식 변경 → 열린 신청 | 최신 버전·유효 답으로 접수 | 구버전·필드 오류·개인형에 팀 지정·타 팀 지정 → `APP_016/015/013/014` |
| ST8 | 교 프로그램·마일스톤 편집 | 신청 전 유효 기간 변경 반영 | 신청 후 유형 변경·역전 기간·마감 역전·제출 있는 마일스톤 삭제 → `PRG_006~010` |
| ST9 | 학 파일 업로드 → 교 다운로드 | `PENDING→ATTACHED`, 보존 만료 후 `DELETE_PENDING→DELETED` | 입력·형식·5MB 초과·종료일 없음·storage 장애 → `SUB_017~021` |
| ST10 | 학 릴리스 제출 → 교 | 타입·연결 저장소 tag/release URL 일치 | 타입 불일치·저장소 미준비·타 저장소 URL → `SUB_007/008/009` |
| ST11 | 학 재제출 ↔ 교 동시 심사 | 최신 revision 기준 단일 Review | 학생 선행 `SUB_003`, 타 교직원 선행 `SUB_004`, 코멘트 없음 `SUB_005` |
| ST12 | 승인 → worker → 팀원 | Outbox `PENDING→PROCESSING→PROCESSED`, job·초대 성공 | `FAILED_RETRYABLE` 후 재시도, `FAILED_FINAL` terminal |
| ST13 | 관 → 접근 상태 변경 | expected state 일치 시 원자적 전이 | 동시 변경·자기 비활성화·마지막 관리자 제거 → `ROL_013/017/018` |
| ST14 | 관 수집 트리거 → 공개 랭킹 | run `SUCCEEDED`일 때만 active generation 교체 | `INCOMPLETE/RATE_LIMITED/FAILED` terminal, App 미설정·동시 실행·cutover → `COL_007/006/008` |
| ST15 | 수집 worker → 시스템 상태 | stream `READY` 증가 시 `PARTIAL→NORMAL` | retry pending `FAILED`, 오래된 READY `DELAYED` |
| ST16 | GitHub org 관리자 → 외 | complete inventory가 `PUBLIC+PRESENT` 관측 시 공개 집계 | `PRIVATE`·`ABSENT` 관측 시 즉시 제외, 다음 관측으로 복구 |
| ST17 | 외 → 공개 프로젝트·프로필 | 적격 공개 데이터만 조회 | 비공개·부적격·미존재 모두 동일 `PPJ_001/002`, 변조 커서 `PPJ_003` |
| ST18 | 관·학 → 관리 API | 관리자 감사 조회, 교직원 알림 설정 | 역전 기간 `AUD_002`, 학생 알림 설정 `NOT_001` |
| ST19 | legacy webhook enum | — | 런타임 writer 없음. dead contract 판정은 [#549](https://github.com/JNU-SWCU/oss-hub/issues/549) |

## PM군 — 권한 경계·공개 범위 (31종)

아래 수치는 **2026-08-03 production v0.6.14에서 실측한 값**이다.

### 비로그인이 보여야 하는 것 — 6/6 통과

`GET /health` · `GET /programs` · `GET /programs/application-templates` · `GET /programs/:id` · `GET /projects` · `GET /ranking` 전부 200.

프론트 공개 라우트 `/` · `/ranking` · `/programs` · `/archive` · `/signup` · `/programs/:id` 전부 200.

### 비로그인이 막혀야 하는 것 — 25/25 통과 (전부 401)

`/auth/me` · `/users/me/profile` · `PATCH /users/me/profile` · `/consents/current` · `POST /consents` · `/users/me/login-history` · `/users/me/notification-email` · `PATCH /users/me/notification-email` · `/repositories/me` · `/dashboard/student` · `/dashboard/staff/summary` · `/role-requests/me` · `POST /onboarding/role` · `POST /programs` · `/programs/:id/edit` · `PATCH /programs/:id` · `/programs/:id/applications` GET·POST · `/programs/:id/teams/me` · `POST /programs/:id/teams` · `/audit-logs` · `/system-status` · `POST /admin/collection/trigger` · `/users/access` · `POST /submission-files`.

### 404 동일성 — 존재 은닉 통과

| 대상 | 미존재 | 존재하나 부적격 |
| --- | --- | --- |
| 공개 프로젝트 | `404 PPJ_001` | `404 PPJ_001` |
| 공개 프로필 | `404 PPJ_002` | `404 PPJ_002` |

응답으로 존재 여부가 구별되지 않는다. 공개 적격 프로젝트는 정상 200.

### sibling 과차단 없음

`/submission-files-export` · `/submission-filesXYZ` · `/submissions` 모두 404이며 403이 아니다. `/health` 200.

### 미인증 프로그램 상세 공개 필드

```
id · name · organizer · category · description
applicationPeriod{startsAt, endsAt}
viewer{role, applicationStatus}
milestones[]{id, name, dueAt, dDay, deadlineLabel, description,
             submissionType, viewerSubmissionStatus, applicationSubmissionSummary}
```

익명 viewer는 `viewer.*` · `viewerSubmissionStatus` · `applicationSubmissionSummary`가 전부 `null`이다.
`programs.service.ts:110`이 staff 신청 데이터로만 채우므로 현재 동작은 안전하다.
이 allowlist를 계약으로 고정하는 것은 [#552](https://github.com/JNU-SWCU/oss-hub/issues/552).

### 정적 점검으로 놓치는 경로

프로그램 생성·편집, 팀, 신청 생성, 제출·재제출, activity timeline, submission matrix, 파일 업·다운로드, 관리자 access, 감사, 시스템 상태는 guard가 아니라 **service에서** 역할을 검사한다.
`@UseGuards(SessionGuard)`만 스캔하면 실제 403 경로를 누락한다.

### 관찰

보호 라우트(`/dashboard` · `/my-repos` · `/settings` · `/dashboard/users`)도 서버가 200 HTML을 반환한다.
데이터는 새지 않는다 — 최종 보안선이 API 계층이고 리다이렉트는 클라이언트 `RoleGate`가 한다. 후속은 [#555](https://github.com/JNU-SWCU/oss-hub/issues/555).

## AS군 — 비동기·알림·감사 (10종)

즉시 반응이 없어 QA에서 가장 잘 누락되는 경로다.

| ID | 경로 | 대기 시간 / 강제 발화 |
| --- | --- | --- |
| AS1 | 승인 → Outbox | poll ≤5초, `PROCESSING` lease 5분 |
| AS2 | Outbox → provision job | 최대 5회, backoff 1·2·4·8분, 최종 실패 약 15분 |
| AS3 | worker → GitHub 초대 | 발송 ≤5초. 수락 확인은 15분 간격 최대 96회(24시간) |
| AS4 | 파일 upload `PENDING→ATTACHED` | 제출 즉시. orphan은 24시간 + 매시 cron |
| AS5 | 보존 만료 → `DELETE_PENDING→DELETED` | `Program.endAt+1년`, cron ≤1시간, claim lease 10분 |
| AS6 | 삭제 실패 재시도 | 1·2·4·8·24시간 6회. 강제: `SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED=1 pnpm --filter backend submissions:retry-file-cleanup -- <fileId>` |
| AS7 | 마감 메일 → Notification | 매일 09:00 KST. 강제: `MAIL_MODE=send pnpm --filter backend notifications:send-digest`, 격리는 `DIGEST_FORCE_TO` |
| AS8 | 활동 수집 | 매시 정각 또는 `POST /api/v1/admin/collection/trigger`. lease 10분, budget 45분 |
| AS9 | webhook | 처리 경로 없음(의도된 계약) — REST reconciliation만 활성 |
| AS10 | 감사 로그 | 행위 직후 같은 트랜잭션 |

### 실패해도 사용자가 모르는 경로

QA에서 반드시 눌러봐야 하는 지점이다.

- 파일 삭제 재시도 6회 소진 — 서버 로그만 남는다([#545](https://github.com/JNU-SWCU/oss-hub/issues/545))
- ADMIN 수집 트리거 202 이후 실제 run 실패·lease skip([#546](https://github.com/JNU-SWCU/oss-hub/issues/546))
- collection stream 실패가 `lastErrorCode` 미기록으로 시스템 상태에 반영되지 않음([#546](https://github.com/JNU-SWCU/oss-hub/issues/546))

## 재사용 방법

1. **매 회차 시작 전** 이 문서의 실측값이 현재 배포 버전과 맞는지 확인한다. 배포가 바뀌었으면 PM군 수치를 다시 뽑아 갱신한다.
2. **비가역 전이 경고**를 먼저 읽고 fixture를 분리한다.
3. W군 핵심 사슬을 한 번에 이어서 돌린다. 여기서 막히면 나머지는 의미가 없다.
4. ST·AS군은 자동 검증이 덮는 범위를 먼저 확인하고 수동은 나머지에 쓴다. backend 유닛과 격리 integration이 상태 전이·비동기 연쇄의 상당 부분을 덮는다.
5. 새로 발견한 결함은 blocker인지 후속인지 분류해 기록한다. 판정선은 "사람이 일을 못 끝내거나 데이터가 망가지거나 조용히 실패하는가"다.

## 관련 문서

- 배포 계약·백업·롤백: [ADR-002](../../../docs/decisions/ADR-002-CI-CD-파이프라인.md)
- 리뷰·병합 게이트: [ADR-005](../../../docs/decisions/ADR-005-agent-driven-review-cycle.md)
- GitHub App 통합·수집: [ADR-006](../../../docs/decisions/ADR-006-github-app-integration.md)
- public-safe deny-list·공개 strict-read: [security.md](../../../docs/rules/security.md)
- 서버 접속·복구 절차: [server-runbook.md](../../../docs/deploy/server-runbook.md)
