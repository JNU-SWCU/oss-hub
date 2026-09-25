import type { MilestoneDocumentUploadPolicy } from './milestone-document-api';

/**
 * 파일을 **고르기 전에** 읽는 한 줄 — 허용 형식과 상한.
 *
 * 어휘는 옛 제출 화면(`features/submissions/components/submission-input.tsx`)이 이미 쓰던
 * `PDF, HWP, ZIP · 최대 5 MB` 그대로다. 같은 일을 하는 자리는 같은 말을 쓴다.
 * 다만 숫자와 형식 목록은 여기서 적지 않고 서버가 준 값을 그대로 쓴다(#1107).
 */
export function milestoneDocumentUploadHint(
  policy: MilestoneDocumentUploadPolicy,
): string {
  return `${policy.formatLabel} · 최대 ${policy.maxLabel}`;
}

/**
 * 고른 파일을 보내도 되는가. 보내면 안 되는 이유가 있으면 그 문장을, 없으면 `null`을 준다.
 *
 * 검사 순서(크기 → 확장자)는 서버(`milestone-document-files.service.ts`)와 이웃 화면
 * (`program-authoring-validation.ts`)과 같다. 순서가 갈리면 같은 파일에 대해 화면과 서버가
 * 서로 다른 이유를 말한다.
 *
 * ⚠ 여기서 걸린 파일은 화면이 **들고 있지 않는다** — 들고 있으면 「제출」이 눌리고, 그
 *   요청은 반드시 실패한다.
 */
export function milestoneDocumentUploadRejection(
  file: File,
  policy: MilestoneDocumentUploadPolicy,
): string | null {
  if (file.size > policy.maxBytes) {
    return `파일은 ${policy.maxLabel} 이하여야 합니다.`;
  }
  if (!acceptsFileName(file.name, policy.accept)) {
    return `${policy.formatLabel} 파일만 선택할 수 있습니다.`;
  }
  return null;
}

/**
 * 압축 파일 **내용** 때문에 막힌 서류 업로드 코드(#1108). 형식·서명 거절(MSD_010)과 갈라져 있다.
 *
 * 고칠 대상이 파일이므로 이 코드는 고를 때든 제출 때든 파일 입력의 오류 자리 하나에만
 * 선다 — 제출 화면의 `SUBMISSION_ARCHIVE_ERROR_CODES`와 같은 규칙이다. 문장은 서버가
 * 소유하므로 여기 적지 않는다.
 *
 * 목록이 backend 레지스트리와 어긋나면 `milestone-document-archive-error-codes.drift.test.ts`가
 * 실패한다 — 낡으면 새 코드가 다시 폼 아래 줄로 밀려나 같은 문장이 두 번 뜬다.
 */
export const MILESTONE_DOCUMENT_ARCHIVE_ERROR_CODES: ReadonlySet<string> =
  new Set([
    'MSD_037',
    'MSD_038',
    'MSD_039',
    'MSD_040',
    'MSD_041',
    'MSD_042',
    'MSD_043',
    'MSD_044',
  ]);

export function isMilestoneDocumentArchiveErrorCode(code: string): boolean {
  return MILESTONE_DOCUMENT_ARCHIVE_ERROR_CODES.has(code);
}

function acceptsFileName(fileName: string, accept: string): boolean {
  const dot = fileName.lastIndexOf('.');
  // `dot > 0` — 이름 없이 점으로 시작하는 파일(`.zip`)을 확장자만 있는 파일로 읽지 않는다.
  const extension = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
  return accept
    .split(',')
    .map((candidate) => candidate.trim().toLowerCase())
    .includes(extension);
}
