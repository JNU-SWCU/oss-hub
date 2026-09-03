<!-- init:managed id=backend-submissions sha256=8cbb8274066d8badbfd44bd751fe335014bd32ba4c28ab78ec4dd6d0743ed9f8 -->
# submissions — 마일스톤 제출과 파일 수명주기

## 소유 경계

- 이 모듈은 승인된 학생의 마일스톤 제출·재제출, 제출 체크리스트·현황 매트릭스, 파일 업로드·다운로드·정리를 소유한다.
- 제출 업무는 `submissions.service.ts`/`submissions.repository.ts`, 파일은 `submission-files.service.ts`/`submission-files.repository.ts`, 매트릭스는 `submission-matrix.service.ts`/repository로 분리한다.
- `submission-dashboard-summary.port.ts`와 service/repository는 `SUBMISSION_DASHBOARD_SUMMARY_PORT`를 export하며 `applications/staff-dashboard.service.ts`가 이 cross-module read contract만 소비한다.
- 검토 결정과 `SubmissionStatus` 전이는 `submission-reviews/` 소유다. 이 모듈은 학생 제출과 재제출만 만들며 검토 승인·반려를 구현하지 않는다.
- 프로그램 마감 계산은 `../programs/program-deadline.ts`를 사용한다. 마감 규칙을 별도로 계산하지 않는다.

## 제출 이력과 동시성

- 최초 제출은 revision 1과 `SUBMITTED` 이력을 만들고, 재제출은 기존 제출의 revision을 CAS로 증가시키며 history 행을 추가한다. 과거 revision·history를 덮어쓰거나 삭제하지 않는다.
- 재제출의 `baseRevision`과 현재 status를 transaction에서 비교한다. 경쟁 실패는 `STALE_SUBMISSION_REVISION`으로 귀결하고 read-then-write 우회를 만들지 않는다.
- `CHANGES_REQUESTED`는 마감 후에도 보완할 수 있다. `SUBMITTED` 교체는 마감 전만 가능하며 `APPROVED`와 `REJECTED`는 교체할 수 없다.
- 제출 내용 타입은 milestone `submissionType`과 일치해야 한다. 파일 제출은 program 종료일이 있어야 하고 만료일은 그 날짜에서 1년 뒤다.
- 학생 여부와 승인된 신청자·팀 구성원 검사는 서비스와 repository의 participant 조회를 통해 수행한다. submission ID 존재 여부로 타인의 제출물을 구분해 노출하지 않는다.

## 파일 계약

- 저장소 경계는 `submission-file-storage.port.ts`의 `SUBMISSION_FILE_STORAGE`다. 구현체는 `s3-submission-file.storage.ts`; E2E 외부 포트 선택은 `submissions.module.ts`의 factory만 바꾼다.
- 업로드는 5 MiB 제한, 파일명 정규화, 허용 content type·signature, ZIP metadata 검사 후 pending 행을 만들고 객체를 저장한다. 검증 또는 pending TTL을 우회하지 않는다.
- 파일 교체도 제출 재제출과 같은 상태·마감·revision 조건을 적용한다. upload와 `SubmissionsService.assertResubmittable`의 규칙을 벌어지게 만들지 않는다.
- 다운로드는 `SubmissionFilesRepository.findDownloadableFile` 권한·만료 결과가 없으면 동일한 not-found로 처리하고 `private, no-store` 및 안전한 attachment filename을 유지한다.
- 만료·실패 정리는 `submission-file-cleanup.service.ts`와 scheduler가 소유한다. 수동 CLI는 `cli/`에 두고 import 시 실행되지 않게 `require.main` guard를 유지한다.

## HTTP, DTO, 검증 기준

- 라우트와 multipart 한도·오류 매핑은 `submissions.controller.ts`에 둔다. 생성/재제출 DTO는 `dto/create-*-request.dto.ts`, 응답은 `dto/submission-response.dto.ts`를 사용한다.
- 파일·상태 실패는 `submissions-error-code.enum.ts`의 `SUB_*` 계약을 사용한다. controller에서 저장소 오류를 임의 HTTP 오류로 바꾸지 않는다.
- 제출·재제출·history 변경은 `submissions.service.resubmission.spec.ts`, `submissions.service.checklist.spec.ts`, `submissions.http.spec.ts`를 갱신한다.
- 파일 검증·권한·수명주기 변경은 `submission-files.service.spec.ts`, `submission-file-lifecycle.integration.spec.ts`, `submission-file-quota.integration.spec.ts`를 함께 다룬다.
- 정리·고아 객체·매트릭스 변경은 `submission-file-cleanup.service.spec.ts`, `storage-orphan-reconciliation.spec.ts`, `submission-matrix.service.spec.ts`에서 고정한다.
<!-- /init:managed id=backend-submissions -->
