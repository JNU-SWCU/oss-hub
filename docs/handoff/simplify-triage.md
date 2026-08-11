# 프로그램 작성 흐름 simplify 패스 — CONCERN 트리아지

> F2 검증 레인이 남긴 비차단 CONCERN 7건 + 관찰 1건을 정리한다. **여기 적힌 항목은
> 전부 동작 변경이 필요해 이 simplify 패스(동작 불변) 범위 밖이다 — 코드는 고치지
> 않았다.** 각 항목의 파일:라인은 이 문서 작성 시점의 `origin/main` 기준이다.

## 1. [우선순위 1] 당일 FAILED 다이제스트를 재발송할 수 없다

- **근거**: `apps/backend/src/notifications/deadline-digest.service.ts:164`에서
  `idempotencyKey`를 `deadline-digest:${digestDate(now)}:${programId}:${recipient.id}`로
  결정론적으로 만든다. 자동 발송(`sendDeadlineDigests` →
  `deadline-digest.service.ts:113-120`)과 관리자 수동 발송
  (`sendProgramFromPreview` → `deadline-digest.service.ts:82-111`, 컨트롤러는
  `deadline-digest.controller.ts:26-38`의 `POST /programs/:id/deadline-digest/send`)이
  둘 다 같은 `dispatch()`를 거쳐 같은 날짜 기준 키를 만든다.
- **현재 동작**: `claimNotification`
  (`apps/backend/src/notifications/deadline-digest.repository.ts:137-165`)이
  `notification.create`를 시도하고 `P2002`(유니크 제약 충돌)를 그냥 `false`로
  변환한다(160-162행) — 기존 행이 `SENT`인지 `FAILED`인지 보지 않는다. 자동
  발송이 메일 전송 실패로 `FAILED` 상태 행을 남긴 뒤(193-196행), 같은 날 관리자가
  재발송을 눌러도 같은 idempotencyKey라 `claimNotification`이 즉시 `false`를
  반환하고 `sendRecipient`는 `'DUPLICATE'`를 반환한다(172-174행) — 실제로는
  메일이 발송된 적이 없는데도 재시도가 막힌다.
- **위험도**: 높음 — 학생이 마감 알림을 영영 받지 못하는 실사용자 영향 경로이고,
  관리자 UI 상에서는 "중복"으로 보여 문제가 숨는다.
- **권고**: `claimNotification`이 P2002를 받으면 기존 행의 `status`를 조회해
  `FAILED`면 갱신(재시도)하고 `SENT`/`PENDING`이면 기존처럼 `false`를 반환하도록
  분기 — 별도 이슈로 분리해 구현.

## 2. [우선순위 1, 같은 영역] 크론 미실행 시 backfill 경로가 없다

- **근거**: `apps/backend/src/notifications/deadline-digest.scheduler.ts:13`의
  `@Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })`가 매일
  09:00 KST에 한 번만 돈다. `sendDeadlineDigests`
  (`deadline-digest.service.ts:113-121`)는 호출 시점의 `now`로
  `deadlineWindow(now)`를 계산해 그 순간 기준 대상만 조회한다 — 이전에 놓친
  윈도우를 다시 계산하는 경로가 없다.
- **현재 동작**: NestJS `@Cron`은 실행을 보장하지 않는다(배포 중 재시작, 장애
  등으로 09:00 tick을 놓치면 그냥 스킵된다). 다음날 09:00에 다시 돌 때는 `now`가
  하루 앞선 새 값이라 놓친 날의 D-1 마감 대상은 조회 조건에 다시 걸리지 않고
  영구히 누락된다.
- **위험도**: 높음 — 위 1번과 같은 "학생이 알림을 못 받는다" 결과로 이어지지만
  원인이 다르다(중복 방지 로직이 아니라 스케줄 자체의 부재).
- **권고**: 마지막 성공 실행 시각을 기록해 크론 진입 시 놓친 윈도우를 감지·보강
  발송하는 backfill 단계 추가 — 별도 이슈.

## 3. REVERT 후에도 기존 업로드 파일 다운로드가 200을 유지한다

- **근거**: `apps/backend/src/submissions/submission-application.record.ts:4-15`의
  `submissionParticipantWhere`는 `team.leaderId`/`team.members`로만 필터링하고
  `application.status`는 전혀 보지 않는다. 이 함수는
  `submissions.repository.ts:352-353`(`findChecklistApplication`) 등 제출 관련
  조회 전반의 WHERE 조건으로 재사용된다.
- **현재 동작**: 관리자가 신청 상태를 `APPROVED → SUBMITTED`(반려/REVERT)로
  되돌려도, 그 팀이 이미 올려둔 제출 파일의 다운로드 권한 판정은 application의
  *현재* 상태를 재확인하지 않고 팀 소속 여부만으로 통과시킨다.
- **위험도**: 낮음 — 자기 팀이 이미 올린 자기 파일을 다시 받는 것뿐이라 정보
  유출은 아니다. 다만 REVERT가 "제출 이전 상태로 되돌린다"는 기대와 어긋난다.
- **권고**: 문서화만 하고 넘어감 — 필요 시 별도 이슈로 상태 재확인 추가.

## 4. 소진(retry exhausted)된 프로그램 작성 업로드 정리 실패 조회 엔드포인트 부재

- **근거**: `apps/backend/src/programs/program-authoring-upload-maintenance.service.ts:74-97`의
  `recordFailure`가 `attemptCount === MAX_DELETE_ATTEMPTS`(6회, 12행)에 도달하면
  `this.logger.error(...)`로만 남기고(92-97행) 끝난다. 조회용 API가 없다.
- **비교**: 같은 저장소(S3)를 정리하는 형제 기능인 제출 파일 정리에는 이미
  선례가 있다 —
  `apps/backend/src/submissions/submission-file-cleanup-failures.controller.ts:12-23`가
  `GET /submission-files/cleanup/failures`로 관리자에게 소진 목록을 보여준다
  (주석에 "notifications/deadline-digests/failures(PR #544)와 같은 형태"라고
  스스로 명시). 프로그램 작성 업로드 쪽에는 이 패턴이 아직 없다.
- **위험도**: 낮음 — 관측성 공백. 정리 자체는 실패해도 원본 데이터 손상은 없다.
- **권고**: `SubmissionFileCleanupFailuresController`/`...Service`를 본떠
  `ProgramAuthoringUpload` 전용 소진 조회 엔드포인트 추가 — 별도 이슈. (기존
  패턴을 그대로 복제하는 일이라 위험도는 낮지만, 새 라우트·권한 가드 추가라
  "동작 불변" 범위를 벗어나 이번 패스에는 포함하지 않았다.)

## 5. 프로그램 생성/수정 검증의 중복 구현 — **미해소, 통합하지 않음**

- **근거**: 팀·일정 검증 규칙이 서로 독립적인 세 곳에 각각 구현돼 있다.
  - `apps/backend/src/programs/service/program-creation.service.ts:42-57`
    (레거시 단일 생성, `programs.controller.ts:88-95`의 `POST /programs`가 아직
    이 경로를 쓴다) — `teamMinSize`/`teamMaxSize`에 `Number.isInteger` 검사 포함.
  - `apps/backend/src/programs/program-authoring-plan.ts:62-70` (신규 다단계
    authoring 생성) — 위와 동등한 정수 검사를 별도로 구현.
  - `apps/backend/src/programs/service/program-editor.service.ts:391-403`
    (`teamSizeForTemplate`, 프로그램 수정) — **`Number.isInteger` 검사가 없다**
    (`min < 1 || min > max`만 확인). 즉 세 구현이 실제로 다르게 동작한다
    (수정 경로는 비정수 팀 인원을 생성/작성 경로보다 더 관대하게 받아들인다).
- **평가**: 순수 리팩터가 아니다 — 세 곳이 이미 동작이 다르므로(정수 검사 유무),
  단순히 헬퍼를 추출해 셋을 통합하면 어느 쪽 동작을 "정답"으로 삼을지 결정해야
  하는 동작 변경이 된다. 에러 응답 형태(`fieldErrors` 배열 vs. `{path, code}`)도
  서로 다르다. **이번 패스에서 통합하지 않았다** — 이 항목은 "해소됨"이 아니다.
- **권고**: 셋 중 어느 것이 올바른 동작인지(특히 `program-editor.service.ts`의
  정수 검사 누락이 버그인지 의도인지) 제품 결정을 받은 뒤 별도 PR로 통합.

## 6/7. createRequest 예외를 전부 race로 래핑 — IdempotencyRaceError 관측성

- **근거**: `apps/backend/src/programs/program-authoring.service.ts:80-89`에서
  `store.createRequest(...)` 호출을 감싼 `try/catch`가 발생한 예외의 종류를
  가리지 않고 전부
  `throw new ProgramAuthoringIdempotencyRaceError(error)`
  (타입 정의: `apps/backend/src/programs/program-authoring.types.ts:148-154`)로
  재던진다. 실제 구현체
  (`apps/backend/src/programs/program-authoring.repository.ts:110-117`)는
  `prisma.programCreateRequest.create(...)`를 그대로 호출할 뿐이라, 진짜
  idempotency 경합(유니크 제약 `P2002`)뿐 아니라 다른 어떤 Prisma 오류(FK 위반,
  연결 장애 등)도 같은 타입으로 뭉개진다.
- **현재 동작**: 바깥쪽 `catch`(`program-authoring.service.ts:61-66`)는
  `ProgramAuthoringIdempotencyRaceError`이면 무조건 "누가 먼저 만들었을 수
  있다"고 보고 `findReplay`를 재조회한다. replay가 없으면 원본이 아니라 이
  래핑된 에러를 그대로 다시 던진다 — 상위 예외 필터·로그에는 실제 원인이 아니라
  "IdempotencyRaceError"라는 이름만 남는다(원인은 `cause`에 보존되지만 에러
  타입 기반 관측/알림 체계에는 안 잡힌다).
- **평가**: `error.code === 'P2002'`(또는 동등한 Prisma 에러 판별)로 좁히는 것이
  이상적이지만, 그 경우 나머지 예외 타입이 그대로 상위로 전파되면서 컨트롤러의
  에러 매핑(`program-authoring.controller.ts:104-118`)이 처리하지 않는 새로운
  예외 타입이 나갈 수 있어 응답 형태가 바뀔 수 있다 — 순수 리팩터로 보기 어렵다.
- **권고**: Prisma 에러 코드로 판별을 좁히고, 그 외 예외는 컨트롤러가 처리할
  일반 500 경로로 흘려보내도록 별도 PR에서 조정 (관측성 개선 + 에러 매핑 검토를
  함께 하는 변경으로 분리).

## 8. [관찰] 자유서술 제출 리비전 갱신이 이전 ATTACHED 파일을 강등하지 않는다

- **근거**: `apps/backend/src/submissions/submissions.repository.ts:429-492`의
  `createSubmissionRevision`은 새 리비전에 새 파일을 붙일 때
  (463-479행) 그 파일만 `lifecycle: ATTACHED`로 바꾸고, 이전 리비전에 붙어있던
  파일의 lifecycle은 건드리지 않는다. 최초 제출 경로
  (`submissions.repository.ts:280-329`)도 동일한 모양이다.
- **결함 단정 보류 — 의도로 보이는 근거**: 파일은 `submissionRevisionId`로
  특정 리비전에 귀속되고(322행, 474행), 다운로드 권한 판정
  (`apps/backend/src/submissions/submission-files.repository.ts:390-400`의
  `downloadableFileWhere`)은 파일 id 단위로 `lifecycle: ATTACHED` +
  `expiresAt` 미만료만 확인할 뿐 "최신 리비전인지"는 조건에 없다. `expiresAt`은
  프로그램 종료 후 1년으로 잡힌다(관련 로직은 다른 파일에서 `endAt`에
  `addOneCalendarYear`를 적용). 즉 예전 리비전의 파일도 그 자체로 유효 기간 내엔
  계속 열람 가능하도록 설계돼 있다 — 리비전별 첨부 파일을 감사/이력 목적으로
  보존하는 의도로 읽힌다.
- **위험도**: 정보 없음(결함 여부 미확정) — 의도된 이력 보존이라면 위험 없음.
  의도가 아니라면 "예전 리비전 파일이 계속 ATTACHED로 남아 스토리지를 점유한다"
  정도의 낮은 위험.
- **권고**: 코드만으로는 제품 의도를 100% 확정할 수 없다 — 기획 확인 후 "의도된
  이력 보존"으로 문서화하거나, 강등이 필요하면 별도 이슈로 분리.

## 부록 — 이번 패스(1부)에서 실제로 변경한 것

이 패스는 위 8개 CONCERN 중 어느 것도 코드로 고치지 않았다(전부 동작 변경
소지가 있어 범위 밖). PR #816~#830이 건드린 영역(특히 #829의 요구서류→마일스톤
단계 흡수, #830의 authoring E2E 하네스 계약)을 코드 기준으로 감사했으나, 죽은
코드·미사용 export·이름/주석 drift 등 안전하게 제거할 대상은 발견하지 못했다 —
`git log v0.6.58..origin/main`에 포함된 프로그램 작성 관련 파일들은 이미
정리된 상태였다(#829 스텝 삭제 시 관련 export·분기까지 함께 삭제됨, F1~F4 검증
웨이브에서 선행 정리가 이미 이뤄진 것으로 보임). 5번(검증 중복)과 6/7번(예외
래핑)도 "통합/좁히기가 안전한 순수 리팩터인지" 코드로 직접 확인했으나 둘 다
동작 차이가 이미 존재해(5번: 정수 검사 유무, 6/7번: 예외 타입별 응답 매핑)
안전하지 않다고 판단해 손대지 않았다.
