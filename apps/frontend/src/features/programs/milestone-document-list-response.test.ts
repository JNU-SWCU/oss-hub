import { describe, expect, it } from 'vitest';
import type { MilestoneDocument } from './milestone-document-api';
import { requireMilestoneDocumentList } from './milestone-document-list-response';

const document: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '기획서',
  required: true,
  sortOrder: 0,
  submissionType: 'FILE',
  hasTemplateFile: false,
  templateFileName: null,
};

describe('requireMilestoneDocumentList', () => {
  it('서류 배열은 그대로 반환한다', () => {
    expect(requireMilestoneDocumentList([document])).toEqual([document]);
  });

  it('양식 파일 이름을 present/null 그대로 유지한다', () => {
    const result = requireMilestoneDocumentList([
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
    ]);

    expect(result[0]?.templateFileName).toBe('운영결과보고서_2026.docx');
    expect(result[1]?.templateFileName).toBeNull();
    expect(result[0]?.hasTemplateFile).toBe(true);
    expect(result[1]?.hasTemplateFile).toBe(false);
  });

  it.each([null, {}, 'documents'])(
    '성공 응답의 비배열 본문 %p를 복구 가능한 오류로 거절한다',
    (value) => {
      expect(() => requireMilestoneDocumentList(value)).toThrow(
        'Invalid milestone document list response',
      );
    },
  );
});
