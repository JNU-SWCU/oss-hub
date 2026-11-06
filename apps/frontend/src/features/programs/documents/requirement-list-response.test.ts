import { describe, expect, it } from 'vitest';
import { requirementUploadPolicy } from '../../../../test-support/requirement-upload-policy';
import type { Requirement } from './requirement-dto';
import { requireRequirementList } from './requirement-list-response';

const document: Requirement = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '기획서',
  required: true,
  sortOrder: 0,
  submissionType: 'FILE_OR_TEXT' as const,
  hasTemplateFile: false,
  templateFileName: null,
};

function body(documents: readonly Requirement[]): unknown {
  return { documents, fileUpload: requirementUploadPolicy() };
}

describe('requireRequirementList', () => {
  it('서류 배열과 업로드 규칙을 그대로 반환한다', () => {
    expect(requireRequirementList(body([document]))).toEqual({
      documents: [document],
      fileUpload: requirementUploadPolicy(),
    });
  });

  it('양식 파일 이름을 present/null 그대로 유지한다', () => {
    const result = requireRequirementList(
      body([
        {
          ...document,
          submissionType: 'FILE_OR_TEXT' as const,
          hasTemplateFile: true,
          templateFileName: '운영결과보고서_2026.docx',
        },
        {
          ...document,
          id: 'document-2',
          submissionType: 'FILE_OR_TEXT' as const,
          hasTemplateFile: false,
          templateFileName: null,
        },
      ]),
    );

    expect(result.documents[0]?.templateFileName).toBe(
      '운영결과보고서_2026.docx',
    );
    expect(result.documents[1]?.templateFileName).toBeNull();
    expect(result.documents[0]?.hasTemplateFile).toBe(true);
    expect(result.documents[1]?.hasTemplateFile).toBe(false);
  });

  it.each([null, {}, 'documents', [document]])(
    '성공 응답의 어긋난 본문 %p를 복구 가능한 오류로 거절한다',
    (value) => {
      expect(() => requireRequirementList(value)).toThrow(
        'Invalid milestone document list response',
      );
    },
  );

  it.each([
    ['규칙이 없는 응답', { documents: [document] }],
    ['규칙이 null인 응답', { documents: [document], fileUpload: null }],
    [
      '상한이 숫자가 아닌 응답',
      {
        documents: [document],
        fileUpload: requirementUploadPolicy({
          maxBytes: '5242880' as unknown as number,
        }),
      },
    ],
    [
      '상한이 0인 응답',
      {
        documents: [document],
        fileUpload: requirementUploadPolicy({ maxBytes: 0 }),
      },
    ],
    [
      '표기가 빈 응답',
      {
        documents: [document],
        fileUpload: requirementUploadPolicy({ maxLabel: '' }),
      },
    ],
    [
      'accept가 빈 응답',
      {
        documents: [document],
        fileUpload: requirementUploadPolicy({ accept: '' }),
      },
    ],
    [
      '형식 안내가 빈 응답',
      {
        documents: [document],
        fileUpload: requirementUploadPolicy({ formatLabel: '' }),
      },
    ],
  ])('%s은 기본값으로 메우지 않고 거절한다', (_label, value) => {
    expect(() => requireRequirementList(value)).toThrow(
      'Invalid milestone document list response',
    );
  });
});

it.each([undefined, null, 'UNKNOWN'])(
  'rejects an absent or unsupported requirement type %s',
  (submissionType) => {
    expect(() =>
      requireRequirementList({
        documents: [{ ...document, submissionType }],
        fileUpload: requirementUploadPolicy(),
      }),
    ).toThrow(TypeError);
  },
);
