# simplify 정리 패스 — 비차단 CONCERN 트리아지

> program-authoring-and-document-flow 프로젝트(#816~#830)의 F2 검증 레인이 잡은
> 비차단 CONCERN 7건 + 관찰 1건을 정리한다. **여기 적힌 항목은 이 문서 작성
> 시점(이 PR)에서 코드로 고치지 않았다** — 전부 동작 변경을 수반해 이번
> simplify 패스(동작 불변) 범위 밖이다. 각 항목의 파일:줄은 이 PR 기준
> `origin/main`(706eb342, PR #829 병합 지점)을 직접 읽어 재확인했다.

## 우선순위 1

### 1. 당일 FAILED 다이제스트 재발송 불가

- **근거**: `apps/backend/src/notifications/deadline-digest.repository.ts:137-165`
  (`claimNotification`), idempotencyKey 생성은
  `apps/backend/src/notifications/deadline-digest.service.ts:164`.
- **현재 동작**: `claimNotification`은 `Notification` 행을 새로 만들다가
  유니크 제약 위반(P2002)이 나면 기존 행의 `status`(PENDING/SENT/FAILED
  무엇이든)를 확인하지 않고 무조건 `false`를 반환한다. idempotencyKey는
  `deadline-digest:${digestDate(now)}:${programId}:${recipient.id}` 형태로
  자동 크론과 수동 재발송이 완전히 동일한 값을 만든다. 따라서 당일 한 번
  FAILED로 끝난 알림은 같은 날 수동으로 다시 시도해도 P2002로 걸려
  `false`(=미발송)로 조용히 끝난다.
- **위험도**: Medium — 발송 실패가 재시도 없이 그날은 영구히 묻힌다. 데이터
  손상은 없고 다음날 자동 실행에서는 새 idempotencyKey로 다시 발송되므로
  최종적으로는 복구되지만, 그 사이 최소 1일의 통지 공백이 생긴다.
- **권고 조치**: `claimNotification`이 P2002를 만났을 때 기존 행을 조회해
  `status === 'FAILED'`면 그 행을 UPDATE로 재사용(reclaim)해 재시도를
  허용한다.

### 2. 크론 미실행 시 backfill 부재 (1번과 같은 영역)

- **근거**: 스케줄러 `apps/backend/src/notifications/deadline-digest.scheduler.ts:13-16`
  (`@Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })`),
  실행 시각 주입은 `apps/backend/src/notifications/deadline-digest.service.ts:113`
  (`now = new Date()`가 기본값), 윈도우 계산은
  `apps/backend/src/notifications/deadline-digest-eligibility.ts:80-85`
  (`deadlineWindow(now)`가 `[now, now + LEAD_TIME]`을 반환).
- **현재 동작**: NestJS `@Cron`은 배포·재시작으로 09:00 KST tick을 놓치면
  그 실행을 기억하지 않는다. 다음 성공 실행은 그 시점의 새 `now`를 기준으로
  윈도우를 다시 계산하므로, 놓친 날짜의 마감 알림 대상이었던 `dueAt`
  구간을 복구할 경로가 없다 — 마지막 성공 실행 시각을 저장하는 체크포인트가
  전혀 없다.
- **위험도**: Medium — 배포 타이밍이 겹치면 특정 마일스톤 마감 알림이
  통째로 스킵될 수 있고, 이는 1번과 달리 재시도로도 복구되지 않는다(다음날
  윈도우에 그 `dueAt`이 더 이상 들어오지 않으면 영구 스킵).
- **권고 조치**: 마지막 성공 실행 시각을 별도로 저장하고, 다음 실행 시
  `[lastSuccessAt, now + LEAD_TIME]`처럼 갭을 포함하는 윈도우로 확장해
  놓친 구간을 커버한다.

## 그 외

### 3. REVERT(APPROVED→SUBMITTED) 후에도 기존 업로드 파일 다운로드가 200 유지

- **근거**: `apps/backend/src/submissions/submission-application.record.ts:4-14`
  (`submissionParticipantWhere`), 사용 지점은
  `apps/backend/src/submissions/submission-files.repository.ts:133-163`
  (`findDownloadableFile`의 `Role.STUDENT` 분기, 150-158행).
- **현재 동작**: `submissionParticipantWhere`는 팀 리더·팀원 여부만 확인하고,
  `findDownloadableFile`의 STUDENT 분기(`OR: [uploaderId, submittedById,
  submissionParticipantWhere(...)]`)도 application의 현재
  상태(`ApplicationStatus`)를 재확인하지 않는다. 승인(APPROVED) 상태에서
  올린 파일이 이후 REVERT로 SUBMITTED로 되돌아가도, 같은 팀 구성원이면
  다운로드가 계속 200을 반환한다.
- **위험도**: Low — 유출 대상이 아니라 항상 **자기 팀이 올린 자기 팀 파일**이다.
  권한 경계를 넘는 접근이 아니라, "APPROVED 전용으로 열렸던 다운로드가
  REVERT 후에도 닫히지 않는다"는 상태-일관성 문제에 가깝다.
- **권고 조치**: 의도된 동작(팀 소속이면 자기 이력 파일은 언제든 재다운로드
  가능)으로 수용해 문서화하거나, `findDownloadableFile`에 application
  상태 재확인을 추가한다 — 둘 다 정책 결정이 선행돼야 한다.

### 4. 소진된(retry exhausted) 업로드 정리 실패 조회용 관리자 엔드포인트 부재

- **근거**: `apps/backend/src/programs/program-authoring-upload-maintenance.service.ts:75-100`
  (`recordFailure`), 소진 시 로그는 92-98행
  (`event: 'program-authoring-upload.cleanup.exhausted'`).
- **현재 동작**: 업로드 스토리지 삭제가 `MAX_DELETE_ATTEMPTS`(6회)만큼
  재시도 후에도 실패하면 `logger.error`로 구조화 로그 한 줄만 남긴다.
  이 소진 상태를 조회할 수 있는 관리자용 컨트롤러·엔드포인트가 없다 —
  로그 검색 외에는 확인 방법이 없다.
- **위험도**: Low — 스토리지에 고아 파일이 남는 정도의 영향이고, 사용자
  경로에는 영향이 없다.
- **권고 조치**: 같은 패턴이 이미 있는
  `apps/backend/src/notifications/deadline-digest-failures.controller.ts`
  (+ `.service.ts`)를 미러링해 소진된 업로드 정리 실패를 조회하는 관리자
  엔드포인트를 추가한다.

### 5+7. createRequest 예외를 전부 race로 래핑해 관측성 저하 (같은 뿌리로 병합)

- **근거**: `apps/backend/src/programs/program-authoring.service.ts:80-89`
  (`createInTransaction`의 `try { requestId = await store.createRequest(...) }
  catch (error) { throw new ProgramAuthoringIdempotencyRaceError(error); }`),
  `createRequest` 구현은 `apps/backend/src/programs/program-authoring.repository.ts:110-117`
  (에러 코드 필터 없는 단순 `prisma.programCreateRequest.create`), 에러 타입은
  `apps/backend/src/programs/program-authoring.types.ts:148-154`
  (`ProgramAuthoringIdempotencyRaceError`, 생성자가 `cause`는 보존한다).
- **현재 동작**: `createRequest`가 던지는 예외의 종류를 가리지 않고 —
  의도한 유니크 제약 위반(P2002, 동시 요청 경합)이든, 커넥션 끊김·타임아웃
  같은 순수 인프라 장애든 — 전부 `ProgramAuthoringIdempotencyRaceError`로
  래핑한다. 호출부(`create` 메서드)는 이 에러를 잡으면 무조건 "다른
  트랜잭션이 이겼다"고 가정하고 replay 조회로 넘어간다. `cause`는 보존되어
  있어 로그를 깊이 파면 원인을 알 수 있지만, 에러 이름·모니터링 지표상으로는
  인프라 장애가 정상적인 idempotency race와 구분되지 않는다.
- **위험도**: Low — 기능적으로는 replay 조회가 실패하면 원본 에러를
  다시 던지므로(`create` 메서드의 `if (replay === null) throw error;`)
  최종적으로 요청이 삼켜지지는 않는다. 다만 장애 유형별 관측(알러트,
  대시보드 분류)이 부정확해진다.
- **권고 조치**: `createRequest` 호출부에서 `error.code === 'P2002'`인
  경우만 `ProgramAuthoringIdempotencyRaceError`로 래핑하고, 그 외 에러는
  그대로 rethrow한다.

### 6. 프로그램 생성/수정 검증의 중복 구현 drift 위험 — 1부에서 통합 여부 판단

- **근거**: 팀 사이즈·일정 순서·마일스톤 경계 규칙이 서로 독립적으로
  세 곳에 구현돼 있다 —
  `apps/backend/src/programs/service/program-creation.service.ts:37-57`
  (레거시 단일 생성, 템플릿 기본값 fallback),
  `apps/backend/src/programs/service/program-editor.service.ts:169-344`
  (레거시 수정, 기존 값 fallback + 마일스톤 재배치·`addOneCalendarYear` 규칙),
  `apps/backend/src/programs/program-authoring-graph-validation.ts:17-134`
  + `apps/backend/src/programs/dto/program-authoring-request.dto.ts`
  (신규 authoring 플로우, 마일스톤 그래프 전체를 한 번에 검증).
- **1부에서 통합 시도 여부**: **통합하지 않았다.** 세 구현은 단순
  복붙이 아니라 서로 다른 프로그램 생애주기 동작이다 — 레거시 생성은
  마일스톤이 없는 단일 기간(`startAt`/`endAt`)만 검증하고 템플릿
  기본값으로 팀 사이즈를 채우며, 레거시 수정은 기존 프로그램 값을
  fallback으로 쓰고 종료일이 바뀌면 캘린더 연 단위로 밀리는 마일스톤
  재배치 규칙까지 갖고 있고, authoring 플로우는 마일스톤·요구서류
  그래프 전체를 한 번에 검증한다. 세 곳의 규칙 문구(에러 메시지)와
  경계값 처리가 미묘하게 다르므로, 공유 검증 함수로 묶으면 그 차이 중
  하나를 반드시 없애는 동작 변경이 된다. "동작 불변" 원칙에 따라
  이번 패스에서는 손대지 않았다 — **CONCERN 유지.**
- **위험도**: Medium — 세 곳 중 하나만 규칙이 바뀌면(예: 팀 최대 인원
  상한 조정) 나머지 두 곳이 조용히 어긋난다.
- **권고 조치**: 별도 이슈로 세 플로우의 규칙 차이를 표로 정리한 뒤,
  통합이 제품 결정("이 세 규칙이 실제로 같아야 하는가")을 먼저 거쳐야
  한다.

## 관찰 (결함 아님)

### 8. 자유서술 제출 리비전 갱신 시 이전 ATTACHED 파일 비강등 — 설계 의도로 판정

- **근거**: `apps/backend/src/submissions/submissions.repository.ts:429-482`
  (`createSubmissionRevision`).
- **현재 동작**: 새 리비전을 만들 때 `submissionRevision` 행을 하나 더
  추가하고(447-458행), FILE 제출이면 그 리비전에 연결된 새
  `submissionFile`만 `ATTACHED`로 전환한다(463-480행). 이전 리비전이
  달고 있던 파일의 `lifecycle`은 전혀 건드리지 않는다.
- **코드 근거로 본 의도 판정**: 각 리비전은 `submissionId + revision`
  단위의 **불변 append-only 이력**이다(432행 주석 — "상태·baseRevision을
  조건으로 건 optimistic update"). 파일은 `submissionRevisionId`로 특정
  리비전에 귀속되므로, 여러 리비전에 걸쳐 여러 `ATTACHED` 파일이 공존하는
  것은 버그가 아니라 "리비전마다 그 시점의 첨부 상태를 그대로 보존한다"는
  이력 모델의 당연한 결과다. 강등(demote) 로직이 없는 것은 빠뜨린 게
  아니라 이 모델과 일치한다.
- **조치**: 불필요 — 결함으로 등록하지 않는다.
