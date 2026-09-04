import type {
  MilestoneDocument,
  MilestoneDocumentList,
  MilestoneDocumentUploadPolicy,
} from './milestone-document-api';

function isUploadPolicy(
  value: unknown,
): value is MilestoneDocumentUploadPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.maxBytes === 'number' &&
    Number.isFinite(policy.maxBytes) &&
    policy.maxBytes > 0 &&
    typeof policy.maxLabel === 'string' &&
    policy.maxLabel.length > 0 &&
    typeof policy.accept === 'string' &&
    policy.accept.length > 0 &&
    typeof policy.formatLabel === 'string' &&
    policy.formatLabel.length > 0
  );
}

/**
 * 목록 응답을 화면이 믿을 수 있는 형태로 좁힌다.
 *
 * ⚠ 업로드 규칙이 빠졌거나 형태가 어긋나면 **목록 조회 자체를 실패로 만든다.** 여기서
 *   기본값으로 메워 주면 그 기본값이 곧 아홉 번째 사본이 되고, 서버가 실제로 거절하는
 *   상한과 화면이 약속하는 상한이 다시 갈라진다(#1107). 세 화면 모두 이 응답 없이는 파일
 *   입력을 그리지 않으므로, 실패는 이미 있는 「다시 시도」 화면으로 떨어진다.
 */
export function requireMilestoneDocumentList(
  value: unknown,
): MilestoneDocumentList {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Invalid milestone document list response');
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.documents) || !isUploadPolicy(body.fileUpload)) {
    throw new TypeError('Invalid milestone document list response');
  }
  return {
    documents: body.documents as readonly MilestoneDocument[],
    fileUpload: body.fileUpload,
  };
}
