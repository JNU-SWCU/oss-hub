import { DomainException } from '../../../common/error-code';
import {
  decodePublicProjectCursor,
  encodePublicProjectCursor,
} from './public-project-cursor';

describe('public-project-cursor', () => {
  it('encode한 커서를 그대로 decode하면 publishedAt/id가 왕복 보존된다', () => {
    const publishedAt = new Date('2026-07-20T00:00:00.000Z');

    const pageId = encodePublicProjectCursor({
      publishedAt,
      id: 'synthetic-repository-id',
    });
    const decoded = decodePublicProjectCursor(pageId);

    expect(decoded.publishedAt).toEqual(publishedAt);
    expect(decoded.id).toBe('synthetic-repository-id');
  });

  it('base64url이 아닌 문자열은 INVALID_PAGE_ID로 거부한다', () => {
    expect(() => decodePublicProjectCursor('!!!not-base64!!!')).toThrow(
      DomainException,
    );
    try {
      decodePublicProjectCursor('!!!not-base64!!!');
    } catch (error) {
      expect((error as DomainException).errorCode.code).toBe('PPJ_003');
      expect((error as DomainException).errorCode.status).toBe(400);
    }
  });

  it('JSON으로 파싱되지 않는 페이로드는 INVALID_PAGE_ID로 거부한다', () => {
    const notJson = Buffer.from('not-json', 'utf8').toString('base64url');

    expect(() => decodePublicProjectCursor(notJson)).toThrow(DomainException);
  });

  it('필드 타입이 어긋난 페이로드(p/i가 문자열이 아님)는 INVALID_PAGE_ID로 거부한다', () => {
    const wrongShape = Buffer.from(
      JSON.stringify({ p: 12345, i: 'ok' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodePublicProjectCursor(wrongShape)).toThrow(
      DomainException,
    );
  });

  it('날짜로 파싱할 수 없는 p 값은 INVALID_PAGE_ID로 거부한다', () => {
    const badDate = Buffer.from(
      JSON.stringify({ p: 'not-a-date', i: 'ok' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodePublicProjectCursor(badDate)).toThrow(DomainException);
  });
});
