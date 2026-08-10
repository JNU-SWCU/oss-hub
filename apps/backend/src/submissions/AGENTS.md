<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-30 · Updated: 2026-07-31 (테스트 파일명 인벤토리 제거) -->

# apps/backend/src/submissions — 제출물·파일 라이프사이클

## Purpose

학생 마일스톤 제출, 재제출, 파일 수명주기, 교직원용 제출 현황 매트릭스를 담는다.
파일 저장은 포트와 S3 어댑터로 분리한다.

## Key Files

| 파일 | 역할 |
| --- | --- |
| `submissions.service.ts` | `form`(제출 폼 컨텍스트) · `create`(최초 제출, `blockedReason` 사전 계산과 `assertSubmittable` 실제 검증이 분리돼 있음) · `resubmit`(보완 재제출 또는 마감 전 교체) · `checklist` |
| `submission-file-storage.port.ts` | `SubmissionFileStoragePort` 인터페이스·`SUBMISSION_FILE_STORAGE` DI 토큰 |
| `s3-submission-file.storage.ts` | 포트의 유일한 구현체 — lazy client 초기화 |
| `submission-file-cleanup.service.ts` / `.scheduler.ts` | 만료된 파일 정리(매시 cron) — `SubmissionFileCleanupService.runDue()` |
| `submission-file-cleanup-failures.controller.ts` / `.service.ts` | 재시도를 소진해 멈춘 정리 대상의 관리자 전용 조회(`GET /submission-files/cleanup/failures`, #545) |
| `submission-matrix.service.ts` | 교직원 제출 현황 매트릭스(#124) |
| `submissions-error-code.enum.ts` | `SUB_*` 코드 레지스트리 |

## Subdirectories

| 경로 | 내용 |
| --- | --- |
| `domain/` | `submission-content.ts`(제출 내용 타입 3종) · `submission-matrix.ts` |
| `dto/` | 제출·재제출·매트릭스 요청/응답 DTO |
| `cli/` | `retry-submission-file-cleanup.ts` — 만료 파일 수동 재정리(`SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED=1` 필요). reset 성공 시 `SUBMISSION_FILE_CLEANUP_RETRY_RESET` typed audit을 남긴다(#547). 실행 본체는 `main`으로 export하고 진입은 `require.main === module` 가드다 — import만으로 CLI가 돌면 테스트를 붙일 수 없다 |

## For AI Agents

- 제출 타입은 마일스톤의 `submissionType`과 정확히 일치해야 한다(`CONTENT_TYPE_MISMATCH`) — `FILE`은 프로그램 종료일이 설정돼야 한다(`FILE_RETENTION_UNAVAILABLE`, 만료일을 `programEndAt + 1년`으로 계산).
- `CHANGES_REQUESTED` 보완 재제출은 마감 후에도 허용한다(#116). 그 외 제출물 교체는 마감 전이고 최종 반려가 아닐 때만 허용한다 — 최초 제출과 재제출의 검증 로직(`assertSubmittable` vs `assertResubmittable`)을 혼용하지 않는다.
- `submission-reviews/` 모듈이 이 모듈을 참조하지 않고 별도 트랜잭션으로 `SubmissionStatus`를 전환한다(ADR-003) — 검토 승인/반려 로직을 이 모듈에 추가하지 않는다.

## Dependencies

- [apps/backend/src/AGENTS.md](../AGENTS.md) — 모듈 경계·에러 코드 규약.
- `auth/`(`AuthModule`), `@aws-sdk/client-s3`(파일 저장 어댑터).
