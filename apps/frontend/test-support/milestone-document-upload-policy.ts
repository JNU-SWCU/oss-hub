import type { MilestoneDocumentUploadPolicy } from '@/features/programs/milestone-document-api';

/**
 * 서류 목록 응답이 함께 싣는 업로드 규칙(`fileUpload`)을 만든다.
 *
 * 화면 세 곳(학생 제출·교직원 양식 올리기·마일스톤 편집)이 모두 이 값으로 파일 입력을
 * 그리므로 여러 테스트 파일이 같은 것을 만든다 — 그래서 여기로 올렸다(design.md R-19).
 * 값은 backend `submission-upload-policy.ts`가 실제로 내려주는 것과 같다.
 */
export function milestoneDocumentUploadPolicy(
  overrides: Partial<MilestoneDocumentUploadPolicy> = {},
): MilestoneDocumentUploadPolicy {
  return {
    maxBytes: 5 * 1024 * 1024,
    maxLabel: '5 MB',
    accept: '.pdf,.hwp,.jpg,.jpeg,.png,.zip',
    formatLabel: 'PDF, HWP, JPG, PNG, ZIP',
    ...overrides,
  };
}
