import { createCipheriv, randomBytes } from 'node:crypto';
import { DomainException } from '../platform/error-code.error';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { PublicProjectCursorSecretError } from './public-project-cursor.error';
import { PublicProjectsService } from './public-projects.service';
import { RepositoryUrlService } from '../github/repository-url.service';

const publicProjectsService = new PublicProjectsService(
  undefined as never,
  undefined as never,
  undefined as never,
  { SESSION_SECRET: 'synthetic-session-secret-synthetic-session-secret' },
  new RepositoryUrlService(),
);

const SESSION_SECRET = Buffer.from(
  'synthetic-public-project-cursor-secret-0001',
).toString('base64url');
const KEY = publicProjectsService.resolvePublicProjectCursorKey(
  loadRuntimeConfig({ SESSION_SECRET }),
);

describe('public-project-cursor', () => {
  it('encode한 커서를 그대로 decode하면 publishedAt/id가 왕복 보존된다', () => {
    const publishedAt = new Date('2026-07-20T00:00:00.000Z');

    const pageId = publicProjectsService.encodePublicProjectCursor(
      { publishedAt, id: 'synthetic-repository-id' },
      KEY,
    );
    const decoded = publicProjectsService.decodePublicProjectCursor(
      pageId,
      KEY,
    );

    expect(decoded.publishedAt).toEqual(publishedAt);
    expect(decoded.id).toBe('synthetic-repository-id');
  });

  it('base64url이 아닌 문자열은 INVALID_PAGE_ID로 거부한다', () => {
    expect(() =>
      publicProjectsService.decodePublicProjectCursor('!!!not-base64!!!', KEY),
    ).toThrow(DomainException);
    try {
      publicProjectsService.decodePublicProjectCursor('!!!not-base64!!!', KEY);
    } catch (error) {
      expect((error as DomainException).errorCode.code).toBe('PPJ_003');
      expect((error as DomainException).errorCode.status).toBe(400);
    }
  });

  it('JSON으로 파싱되지 않는 페이로드는 INVALID_PAGE_ID로 거부한다', () => {
    const notJson = Buffer.from('not-json', 'utf8').toString('base64url');

    expect(() =>
      publicProjectsService.decodePublicProjectCursor(notJson, KEY),
    ).toThrow(DomainException);
  });

  it('필드 타입이 어긋난 페이로드(p/i가 문자열이 아님)는 INVALID_PAGE_ID로 거부한다', () => {
    const wrongShape = encodeForTest(JSON.stringify({ p: 12345, i: 'ok' }));

    expect(() =>
      publicProjectsService.decodePublicProjectCursor(wrongShape, KEY),
    ).toThrow(DomainException);
  });

  it('날짜로 파싱할 수 없는 p 값은 INVALID_PAGE_ID로 거부한다', () => {
    const badDate = encodeForTest(JSON.stringify({ p: 'not-a-date', i: 'ok' }));

    expect(() =>
      publicProjectsService.decodePublicProjectCursor(badDate, KEY),
    ).toThrow(DomainException);
  });

  describe('QA40 — 토큰 불투명성', () => {
    const HIDDEN_INTERNAL_ID = 'seed:hidden-repository-internal-cuid';
    const HIDDEN_PUBLISHED_AT = new Date('2026-07-21T09:30:00.000Z');
    const pageId = publicProjectsService.encodePublicProjectCursor(
      { publishedAt: HIDDEN_PUBLISHED_AT, id: HIDDEN_INTERNAL_ID },
      KEY,
    );

    it('base64url로 풀어도 내부 Repository.id도 공개 시각도 평문으로 나오지 않는다', () => {
      const raw = Buffer.from(pageId, 'base64url');

      expect(raw.toString('utf8')).not.toContain(HIDDEN_INTERNAL_ID);
      expect(raw.toString('utf8')).not.toContain(
        HIDDEN_PUBLISHED_AT.toISOString(),
      );
      expect(raw.toString('latin1')).not.toContain(HIDDEN_INTERNAL_ID);
      expect(() => {
        JSON.parse(raw.toString('utf8'));
      }).toThrow();
    });

    it('키를 모르면 복호할 수 없다 — 다른 SESSION_SECRET으로는 INVALID_PAGE_ID다', () => {
      const otherKey = publicProjectsService.resolvePublicProjectCursorKey(
        loadRuntimeConfig({
          SESSION_SECRET: Buffer.from(
            'synthetic-public-project-cursor-secret-0002',
          ).toString('base64url'),
        }),
      );

      expect(() =>
        publicProjectsService.decodePublicProjectCursor(pageId, otherKey),
      ).toThrow(DomainException);
    });

    it('한 바이트라도 조작하면 인증 태그가 깨져 INVALID_PAGE_ID다', () => {
      const raw = Buffer.from(pageId, 'base64url');
      raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1);

      expect(() =>
        publicProjectsService.decodePublicProjectCursor(
          raw.toString('base64url'),
          KEY,
        ),
      ).toThrow(DomainException);
    });

    it('버전 바이트를 바꿔치기해도 거부한다', () => {
      const raw = Buffer.from(pageId, 'base64url');
      raw.writeUInt8(2, 0);

      expect(() =>
        publicProjectsService.decodePublicProjectCursor(
          raw.toString('base64url'),
          KEY,
        ),
      ).toThrow(DomainException);
    });

    it('내부 id 길이가 달라도 토큰 길이는 64바이트 블록 단위로만 변한다(길이 채널 축소)', () => {
      const short = publicProjectsService.encodePublicProjectCursor(
        { publishedAt: HIDDEN_PUBLISHED_AT, id: 'a' },
        KEY,
      );
      const long = publicProjectsService.encodePublicProjectCursor(
        { publishedAt: HIDDEN_PUBLISHED_AT, id: 'a'.repeat(20) },
        KEY,
      );

      expect(Buffer.from(short, 'base64url').length).toBe(
        Buffer.from(long, 'base64url').length,
      );
    });

    it('매번 다른 IV를 써서 같은 커서라도 토큰이 반복되지 않는다', () => {
      const first = publicProjectsService.encodePublicProjectCursor(
        { publishedAt: HIDDEN_PUBLISHED_AT, id: HIDDEN_INTERNAL_ID },
        KEY,
      );
      const second = publicProjectsService.encodePublicProjectCursor(
        { publishedAt: HIDDEN_PUBLISHED_AT, id: HIDDEN_INTERNAL_ID },
        KEY,
      );

      expect(first).not.toBe(second);
      expect(
        publicProjectsService.decodePublicProjectCursor(first, KEY),
      ).toEqual(publicProjectsService.decodePublicProjectCursor(second, KEY));
    });
  });

  describe('QA40 — 키 해석은 fail-closed다', () => {
    it.each([
      ['미설정', {}],
      ['빈 문자열', { SESSION_SECRET: '' }],
      ['공백만', { SESSION_SECRET: '   ' }],
    ])('SESSION_SECRET이 %s이면 커서를 만들지 않는다', (_label, env) => {
      expect(() =>
        publicProjectsService.resolvePublicProjectCursorKey(
          loadRuntimeConfig(env),
        ),
      ).toThrow(PublicProjectCursorSecretError);
    });

    it('32바이트보다 짧은 SESSION_SECRET은 거부한다', () => {
      expect(() =>
        publicProjectsService.resolvePublicProjectCursorKey(
          loadRuntimeConfig({
            SESSION_SECRET: Buffer.from('too-short').toString('base64url'),
          }),
        ),
      ).toThrow(PublicProjectCursorSecretError);
    });
  });
});

function encodeForTest(json: string): string {
  const padded = json.padEnd(Math.ceil(json.length / 64) * 64, ' ');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(Buffer.from([1]));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(padded, 'utf8')),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([1]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString('base64url');
}
