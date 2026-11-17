import { describe, expect, it } from 'vitest';
import type { RequirementViewerSubmission } from './requirement-dto';
import { requirementFileKind } from './requirement-file-kind';

function submissionWith(
  currentFileName: string | null,
): RequirementViewerSubmission {
  return {
    submitted: true,
    submittedAt: '2026-08-01T05:22:00.000Z',
    revision: 1,
    status: 'SUBMITTED',
    hasCurrentFile: currentFileName !== null,
    currentFileName,
    review: null,
    history: { hasHistory: false, isComplete: true },
  };
}

describe('requirementFileKind', () => {
  it('아직 낸 파일이 없으면 제출 방식으로 가른다', () => {
    expect(requirementFileKind({ submissionType: 'FILE' })).toBe('document');
    expect(requirementFileKind({ submissionType: 'FILE_OR_TEXT' })).toBe(
      'document',
    );
    expect(requirementFileKind({ submissionType: 'TEXT' })).toBe('link');
  });

  it.each([
    ['기획서.PDF', 'document'],
    ['보고서.hwp', 'document'],
    ['화면-캡처.PNG', 'image'],
    ['사진.jpeg', 'image'],
    ['소스.zip', 'archive'],
    ['소스.tar.gz', 'archive'],
  ] as const)('낸 파일 %s 은 확장자에 따라 %s 로 가른다', (fileName, kind) => {
    expect(
      requirementFileKind({
        submissionType: 'FILE_OR_TEXT',
        viewerSubmission: submissionWith(fileName),
      }),
    ).toBe(kind);
  });

  it('파일 없이 글로만 낸 통합 제출은 문서로 둔다', () => {
    expect(
      requirementFileKind({
        submissionType: 'FILE_OR_TEXT',
        viewerSubmission: submissionWith(null),
      }),
    ).toBe('document');
  });
});
