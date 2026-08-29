import { MilestoneSubmissionType } from '@prisma/client';
import { MilestoneDocumentsErrorCode } from '../milestone-documents-error-code.enum';
import {
  parseMilestoneDocumentContent,
  readMilestoneDocumentSubmittedContent,
} from './milestone-document-content';

describe('parseMilestoneDocumentContent', () => {
  it('내용만 제출할 수 있다', () => {
    expect(
      parseMilestoneDocumentContent({ text: '  진행 내용을 적었습니다.  ' }),
    ).toEqual({
      text: '진행 내용을 적었습니다.',
      fileId: null,
    });
  });

  it('파일만 제출할 수 있다', () => {
    expect(
      parseMilestoneDocumentContent({ fileId: '  synthetic-file-id  ' }),
    ).toEqual({
      text: null,
      fileId: 'synthetic-file-id',
    });
  });

  it('내용과 파일을 함께 제출할 수 있다', () => {
    expect(
      parseMilestoneDocumentContent({
        text: '설명',
        fileId: 'synthetic-file-id',
      }),
    ).toEqual({ text: '설명', fileId: 'synthetic-file-id' });
  });

  it('내용과 파일이 모두 비어 있으면 거부한다', () => {
    try {
      parseMilestoneDocumentContent({ text: '  ', fileId: '  ' });
      throw new Error('빈 제출이 거부되지 않았습니다.');
    } catch (error: unknown) {
      expect(error).toMatchObject({
        errorCode: { code: MilestoneDocumentsErrorCode.CONTENT_REQUIRED },
      });
    }
  });

  it('기존 저장 TEXT 본문 모양은 계속 읽을 수 있다', () => {
    expect(
      readMilestoneDocumentSubmittedContent({
        type: MilestoneSubmissionType.TEXT,
        text: '기존 본문',
      }),
    ).toEqual({ type: MilestoneSubmissionType.TEXT, text: '기존 본문' });
  });
});
