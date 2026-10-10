import {
  parseProgramNoticeImageUrl,
  parseProgramNoticeUrl,
} from './program-notice-url';

const source = 'https://sojoong.kr/notice/notice-board/?uid=123&mod=document';

it('canonicalizes a supported notice query order', () => {
  expect(
    parseProgramNoticeUrl(
      'https://sojoong.kr/notice/notice-board/?mod=document&uid=123',
    ).href,
  ).toBe(source);
});

it.each([
  'http://sojoong.kr/notice/notice-board/?uid=123&mod=document',
  'https://sojoong.kr.evil.example/notice/notice-board/?uid=123&mod=document',
  'https://sojoong.kr@evil.example/notice/notice-board/?uid=123&mod=document',
  'https://user:@sojoong.kr/notice/notice-board/?uid=123&mod=document',
  'https://sojoong.kr:444/notice/notice-board/?uid=123&mod=document',
  'https://sojoong.kr./notice/notice-board/?uid=123&mod=document',
  'https://SOJOONG.kr/notice/notice-board/?uid=123&mod=document',
  'https://%73ojoong.kr/notice/notice-board/?uid=123&mod=document',
  'https://127.0.0.1/notice/notice-board/?uid=123&mod=document',
  'https://[::1]/notice/notice-board/?uid=123&mod=document',
  'https://sojoong.kr/notice/x/../notice-board/?uid=123&mod=document',
  source + '#fragment',
  source + '&uid=124',
  source + '&extra=1',
  source.replace('123', '0'),
  source.replace('123', '01'),
  source.replace('123', '-1'),
  source.replace('123', '1e2'),
  source.replace('uid', '%75id'),
  source.replace('/notice/', '\\notice/'),
  source + '\n',
  source.replace('sojoong', 'so\tjoong'),
])('rejects unsupported or ambiguous notice URL %s', (input) => {
  expect(() => parseProgramNoticeUrl(input)).toThrow();
});

it('resolves a relative poster from the supported notice body', () => {
  expect(
    parseProgramNoticeImageUrl(
      '/wp-content/uploads/kboard_attached/1/209901/poster.jpg',
      new URL(source),
    )?.href,
  ).toBe(
    'https://sojoong.kr/wp-content/uploads/kboard_attached/1/209901/poster.jpg',
  );
});

it.each([
  'http://sojoong.kr/wp-content/uploads/kboard_attached/1/poster.jpg',
  'https://sojoong.kr/logo.jpg',
  'https://sojoong.kr/wp-content/uploads/kboard_attached/1/poster.svg',
  'https://sojoong.kr/wp-content/uploads/kboard_attached/1/poster.jpg?x=1',
  'https://sojoong.kr/wp-content/uploads/kboard_attached/1/poster.jpg#x',
  'https://sojoong.kr/wp-content/uploads/kboard_attached/../poster.jpg',
  'https://sojoong.kr/wp-content/uploads/kboard_attached/1/%2e%2e/poster.jpg',
  'https://evil.example/wp-content/uploads/kboard_attached/poster.jpg',
  'https://user:@sojoong.kr/wp-content/uploads/kboard_attached/poster.jpg',
  'data:image/png;base64,AAAA',
])('rejects an unsafe or unsupported poster %s', (input) => {
  expect(parseProgramNoticeImageUrl(input)).toBeNull();
});

it('supports normal WordPress body poster uploads', () => {
  expect(
    parseProgramNoticeImageUrl(
      'https://sojoong.kr/wp-content/uploads/2030/01/poster.jpg',
    )?.href,
  ).toBe('https://sojoong.kr/wp-content/uploads/2030/01/poster.jpg');
});

it('canonicalizes UTF-8 poster filenames without losing Korean or spaces', () => {
  expect(
    parseProgramNoticeImageUrl(
      'https://sojoong.kr/wp-content/uploads/2030/01/%ED%95%A9%EC%84%B1%20%ED%8F%AC%EC%8A%A4%ED%84%B0.jpg',
    )?.href,
  ).toBe(
    'https://sojoong.kr/wp-content/uploads/2030/01/%ED%95%A9%EC%84%B1%20%ED%8F%AC%EC%8A%A4%ED%84%B0.jpg',
  );
});

it('rejects a raw non-ASCII poster name whose canonical form exceeds the cover column', () => {
  expect(
    parseProgramNoticeImageUrl(
      `https://sojoong.kr/wp-content/uploads/2030/01/${'가'.repeat(300)}.jpg`,
    ),
  ).toBeNull();
});

it.each([
  'https://sojoong.kr/notice/notice-board/../notice-board/?uid=123&mod=document',
  source + '#',
])(
  'rejects paths or fragments normalized away by the URL parser: %s',
  (input) => {
    expect(() => parseProgramNoticeUrl(input)).toThrow();
  },
);

it.each(['%2f', '%5c', '%00', '%0a', '%252e%252e', '%ZZ', '..', '.'])(
  'rejects encoded poster path ambiguity %s',
  (segment) => {
    expect(
      parseProgramNoticeImageUrl(
        `https://sojoong.kr/wp-content/uploads/${segment}/poster.jpg`,
      ),
    ).toBeNull();
  },
);
