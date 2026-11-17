import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProgramNoticeFetchClient } from '../../test/program-notice-client.fixture';
const client = createProgramNoticeFetchClient();

const fixture = readFileSync(
  join(__dirname, 'fixtures/sojoong-notice-list.html'),
  'utf8',
);

it('returns the ten newest real list posts, sorting pinned posts together with normal posts', () => {
  const { items } = client.extractProgramNoticeList(fixture);
  expect(
    items.map((item) => new URL(item.url).searchParams.get('uid')),
  ).toEqual([
    '1078',
    '1063',
    '1062',
    '1060',
    '1059',
    '1058',
    '1055',
    '1048',
    '1047',
    '1046',
  ]);
  expect(items[0]).toEqual({
    url: 'https://sojoong.kr/notice/notice-board/?uid=1078&mod=document',
    title: '[공지] 제11회 SW프로그래밍 경진대회(호남·제주) 수상자 발표',
    postedAt: '2026-11-16',
    thumbnailUrl: null,
  });
});

it('decodes text and accepts only supported notice links and poster hosts', () => {
  const row = (href: string, image: string, date = '2026.11.17') =>
    `<tr><td><a href="${href}"><div class="custom-title"><script>bad()</script>Safe &amp; title</div></a><span class="kboard-date">${date}</span><img src="${image}" onerror="bad()"></td></tr>`;
  const { items } = client.extractProgramNoticeList(
    `<div class="kboard-list"><table>${[
      row(
        '/notice/notice-board/?uid=1&amp;mod=document',
        '/wp-content/uploads/2026/11/poster.jpg',
      ),
      row('https://evil.example/?uid=2', 'https://evil.example/poster.jpg'),
      row('/notice/notice-board/?uid=3&amp;mod=document', 'javascript:bad()'),
      row('/notice/notice-board/?uid=4&amp;mod=document', '', '2026.99.99'),
    ].join('')}</table></div>`,
  );
  expect(
    items.map(({ title, thumbnailUrl }) => ({ title, thumbnailUrl })),
  ).toEqual([
    { title: 'Safe & title', thumbnailUrl: null },
    {
      title: 'Safe & title',
      thumbnailUrl: 'https://sojoong.kr/wp-content/uploads/2026/11/poster.jpg',
    },
  ]);
});

it('fails explicitly on unsupported list structure', () => {
  expect(() =>
    client.extractProgramNoticeList('<html>changed structure</html>'),
  ).toThrow();
});
