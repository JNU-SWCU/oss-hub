<!-- init:managed id=backend-programs sha256=e1cb8c3b46986fb8840be1f606eb0c1820b05713f427cf6719e37dd95860a54e -->
# programs — 프로그램 운영 도메인

## 소유 범위

- 프로그램, 마일스톤, 팀, 프로그램 활동, 학생 대시보드를 소유하고 `programs.module.ts`에서 controller/service/repository를 조립한다.
- 신청 판정은 `applications/`, 제출·파일은 `submissions/`, 저장소 공개는 `github/` 소유이며 그 Prisma 조회나 업무 규칙을 복제하지 않는다.
- 영구 삭제는 `ProgramLifecycleService`, 파일 후속 정리는 `program-purge-file-cleanup*.ts`가 맡는다.

## 생성·수정 표면

- legacy `POST /programs` 생성은 `ProgramCreationService`와 `service/programs.create.service.spec.ts`가 소유한다.
- aggregate `POST /program-authoring/programs` 생성은 `ProgramAuthoringService`, `program-authoring*.ts`, `program-authoring.service.spec.ts`가 소유한다.
  두 생성 표면의 validation·upload·응답 계약을 한 service로 합치지 않는다.
- 수정·마일스톤은 `ProgramEditorService`, 팀 참여는 `ProgramTeamsService`, 삭제는 `ProgramLifecycleService`를 통한다.
- `ApplicationTemplatesController`는 parameterized program controller보다 먼저 등록해 정적 `application-templates` 경로가 `:id`에 흡수되지 않게 한다.
- purge는 `expectedScope` 재검증, 명시적 자식 삭제 순서, 비동기 파일 정리를 유지한다.

## 데이터와 HTTP 계약

- Prisma 조회는 `repository/programs.repository.ts`, `program-editor.repository.ts`, `program-teams.repository.ts`와 활동 repository에 둔다.
- 템플릿과 신청 답변 규칙은 `program-template.registry.ts`, `application-answers.validator.ts`가 원본이다.
- 목록 filter/sort는 `program-list-query.ts`와 `dto/program-list-query.dto.ts`를 함께 변경한다.
- HTTP 입력·출력은 `dto/` class에서 변환하고 controller에서 임의 response shape나 validation을 만들지 않는다.
- 공개 필드와 viewer personalization 변경은 `service/programs.service.ts`, `dto/program-detail.dto.ts`, `program-list-response.dto.ts`를 함께 검토한다.
- 활동 집계는 `PROGRAM_ACTIVITY_SUMMARY_PORT`를 사용하고 호출자가 집계 table이나 다른 module internals를 직접 읽지 않는다.

## 검증 위치

- route/정적 경로: `controller/programs.controller.spec.ts`, `application-templates.http.spec.ts`.
- 수정/권한: `service/program-editor-authority.service.spec.ts`, `program-editor-contract.http.spec.ts`.
- 팀: `service/program-teams.service.spec.ts`, `program-teams-staff-*.spec.ts`.
- 목록/대시보드: `service/programs-list.service.spec.ts`, `service/student-dashboard.service.spec.ts`.
- 삭제/파일 정리: `program-deletion-scope.spec.ts`, `program-purge-deletion-matrix.spec.ts`, `program-purge.integration.spec.ts`.
<!-- /init:managed id=backend-programs -->
