/**
 * 업로드 상한과 그 표기 — backend `submissions/submission-upload-policy.ts`와 **한 벌이다.**
 *
 * ⚠ 마일스톤 서류 화면(제출·양식 올리기·마일스톤 편집)은 이 값을 쓰지 **않는다.** 그 세
 *   화면은 상한을 `GET /milestones/:milestoneId/documents` 응답의 `fileUpload`로 받는다 —
 *   화면이 사본을 들면 서버가 거절하는 상한과 화면이 약속하는 상한이 갈라지기 때문이다.
 *   실제로 갈라져서 이 티켓(#1107)이 났다.
 *
 * ⚠ 여기 남은 사본은 **아직 서버가 상한을 내려주지 않는 두 화면**의 몫이다 — 옛 제출 화면
 *   (`features/submissions/submission-form.ts`)과 프로그램 작성 업로드
 *   (`features/programs/program-authoring-validation.ts`). 그 두 화면의 동작은 이번 티켓의
 *   범위 밖이라 응답 계약을 건드리지 않았고, 대신 `submission-upload-policy.drift.test.ts`가
 *   백엔드 원본과 어긋나는 순간 실패한다.
 */
export const SUBMISSION_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** 사람이 읽는 표기. 실제 상한은 5 MiB지만 화면 문구는 「5 MB」 하나로 통일한다. */
export const SUBMISSION_UPLOAD_MAX_LABEL = '5 MB';

/** 상한 초과 문구. 서버의 `SUB_019`·`MSD_*` 413 문구와 같은 문장이어야 한다. */
export const SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE = `파일은 ${SUBMISSION_UPLOAD_MAX_LABEL} 이하여야 합니다.`;
