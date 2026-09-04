import { describe, expect, it } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import type { MilestoneDocument } from './milestone-document-api';
import { requireMilestoneDocumentList } from './milestone-document-list-response';

const document: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '기획서',
  required: true,
  sortOrder: 0,
  hasTemplateFile: false,
  templateFileName: null,
};

function body(documents: readonly MilestoneDocument[]): unknown {
  return { documents, fileUpload: milestoneDocumentUploadPolicy() };
}

describe('requireMilestoneDocumentList', () => {
  it('서류 배열과 업로드 규칙을 그대로 반환한다', () => {
    expect(requireMilestoneDocumentList(body([document]))).toEqual({
      documents: [document],
      fileUpload: milestoneDocumentUploadPolicy(),
    });
  });

  it('양식 파일 이름을 present/null 그대로 유지한다', () => {
    const result = requireMilestoneDocumentList(
      body([
        {
          ...document,
          hasTemplateFile: true,
          templateFileName: '운영결과보고서_2026.docx',
        },
        {
          ...document,
          id: 'document-2',
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
      expect(() => requireMilestoneDocumentList(value)).toThrow(
        'Invalid milestone document list response',
      );
    },
  );

  /*
   * 업로드 규칙이 빠졌거나 형태가 어긋나면 목록 조회 자체를 실패로 만든다. 여기서 기본값을
   * 메워 주면 그 기본값이 곧 아홉 번째 사본이 되고, 서버가 실제로 거절하는 상한과 화면이
   * 약속하는 상한이 다시 갈라진다(#1107).
   */
  it.each([
    ['규칙이 없는 응답', { documents: [document] }],
    ['규칙이 null인 응답', { documents: [document], fileUpload: null }],
    [
      '상한이 숫자가 아닌 응답',
      {
        documents: [document],
        fileUpload: milestoneDocumentUploadPolicy({
          maxBytes: '5242880' as unknown as number,
        }),
      },
    ],
    [
      '상한이 0인 응답',
      {
        documents: [document],
        fileUpload: milestoneDocumentUploadPolicy({ maxBytes: 0 }),
      },
    ],
    [
      '표기가 빈 응답',
      {
        documents: [document],
        fileUpload: milestoneDocumentUploadPolicy({ maxLabel: '' }),
      },
    ],
    [
      'accept가 빈 응답',
      {
        documents: [document],
        fileUpload: milestoneDocumentUploadPolicy({ accept: '' }),
      },
    ],
    [
      '형식 안내가 빈 응답',
      {
        documents: [document],
        fileUpload: milestoneDocumentUploadPolicy({ formatLabel: '' }),
      },
    ],
  ])('%s은 기본값으로 메우지 않고 거절한다', (_label, value) => {
    expect(() => requireMilestoneDocumentList(value)).toThrow(
      'Invalid milestone document list response',
    );
  });
});
