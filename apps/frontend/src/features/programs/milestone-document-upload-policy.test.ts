import { describe, expect, it } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import {
  milestoneDocumentUploadHint,
  milestoneDocumentUploadRejection,
} from './milestone-document-upload-policy';

const policy = milestoneDocumentUploadPolicy();

function file(name: string, size: number): File {
  const candidate = new File(['x'], name);
  // File 생성자에 실제로 상한만 한 바이트를 넣지 않는다 — 크기만 흉내 내면 충분하다.
  Object.defineProperty(candidate, 'size', { configurable: true, value: size });
  return candidate;
}

describe('milestoneDocumentUploadHint', () => {
  it('허용 형식과 상한을 옛 제출 화면과 같은 문장으로 말한다', () => {
    expect(milestoneDocumentUploadHint(policy)).toBe(
      'PDF, HWP, JPG, PNG, ZIP · 최대 5 MB',
    );
  });

  it('숫자와 형식은 서버가 준 값을 그대로 쓴다', () => {
    expect(
      milestoneDocumentUploadHint(
        milestoneDocumentUploadPolicy({
          maxLabel: '2 MB',
          formatLabel: 'PDF',
        }),
      ),
    ).toBe('PDF · 최대 2 MB');
  });
});

describe('milestoneDocumentUploadRejection', () => {
  it('상한과 같은 크기는 통과시킨다', () => {
    expect(
      milestoneDocumentUploadRejection(
        file('계획서.pdf', policy.maxBytes),
        policy,
      ),
    ).toBeNull();
  });

  it('1 byte만 넘어도 서버와 같은 문장으로 거절한다', () => {
    expect(
      milestoneDocumentUploadRejection(
        file('계획서.pdf', policy.maxBytes + 1),
        policy,
      ),
    ).toBe('파일은 5 MB 이하여야 합니다.');
  });

  it('허용 형식 밖의 확장자를 거절한다', () => {
    expect(milestoneDocumentUploadRejection(file('설치.exe', 10), policy)).toBe(
      'PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.',
    );
    expect(
      milestoneDocumentUploadRejection(file('확장자없음', 10), policy),
    ).toBe('PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.');
  });

  it('대문자 확장자도 같은 형식으로 본다', () => {
    expect(
      milestoneDocumentUploadRejection(file('계획서.PDF', 10), policy),
    ).toBeNull();
  });

  /*
   * 크기를 먼저 본다 — 서버(`milestone-document-files.service.ts`)와 같은 순서다. 순서가
   * 갈리면 같은 파일에 대해 화면과 서버가 서로 다른 이유를 말한다.
   */
  it('크기와 형식이 모두 어긋나면 크기를 먼저 말한다', () => {
    expect(
      milestoneDocumentUploadRejection(
        file('설치.exe', policy.maxBytes + 1),
        policy,
      ),
    ).toBe('파일은 5 MB 이하여야 합니다.');
  });

  it('이름 없이 점으로 시작하는 파일을 확장자만 있는 파일로 읽지 않는다', () => {
    expect(milestoneDocumentUploadRejection(file('.pdf', 10), policy)).toBe(
      'PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.',
    );
  });
});
