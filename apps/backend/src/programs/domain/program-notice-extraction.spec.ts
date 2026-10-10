import { extractProgramNotice } from './program-notice-extraction';
const url = new URL(
  'https://sojoong.kr/notice/notice-board/?uid=123&mod=document',
);
const image =
  'https://sojoong.kr/wp-content/uploads/kboard_attached/1/209901/poster.jpg';
function document(body: string): string {
  return `<html><head><meta property="og:image" content="https://sojoong.kr/wp-content/uploads/2099/01/site-logo.png"></head><body><nav>Page navigation</nav><div class="kboard-title"><h1> Synthetic &amp; Program </h1></div><div class="kboard-content"><div class="content-view">${body}</div></div><footer>Page footer</footer></body></html>`;
}

it('keeps source paragraph, heading, line break and inline entity boundaries', () => {
  const result = extractProgramNotice(
    document(
      '<h2>Overview</h2><p> First&nbsp; paragraph <strong>bold</strong>. </p><p>Second<br>line &amp; details.</p>',
    ),
    url,
  );
  expect(result.name).toBe('Synthetic & Program');
  expect(result.description).toBe(
    'Overview\nFirst paragraph bold.\nSecond\nline & details.',
  );
});

it('keeps author spacers and section headings as single blank lines while paragraphs stay compact', () => {
  const result = extractProgramNotice(
    document(
      '<p>Intro</p><p>Line two</p><h3>Schedule</h3><ul><li><p>Day one</p></li><li>Day two</li></ul><p>After list</p><p>&nbsp;</p><p>&nbsp;</p><p>Note</p><hr><p>Contact<br><br>Office</p>',
    ),
    url,
  );
  expect(result.description).toBe(
    'Intro\nLine two\n\nSchedule\n• Day one\n• Day two\nAfter list\n\nNote\n\nContact\n\nOffice',
  );
});

it('keeps ordered, unordered and nested list order without Markdown formatting', () => {
  const result = extractProgramNotice(
    document(
      '<ol start="3"><li>First<ul><li>Nested A</li><li>Nested B</li></ul></li><li>Second</li></ol>',
    ),
    url,
  );
  expect(result.description).toBe(
    '3. First\n  • Nested A\n  • Nested B\n4. Second',
  );
});

it('keeps table column labels associated with each row value', () => {
  const result = extractProgramNotice(
    document(
      '<table><tr><th>Day</th><th>Activity</th></tr><tr><td>One</td><td>Session A</td></tr><tr><td>Two</td><td>Session B</td></tr></table>',
    ),
    url,
  );
  expect(result.description).toBe(
    'Day: One · Activity: Session A\nDay: Two · Activity: Session B',
  );
});

it('keeps label/value table rows readable', () => {
  const result = extractProgramNotice(
    document(
      '<table><tr><th>Audience</th><td>Everyone</td></tr><tr><th>Schedule</th><td>Day one<br>Day two</td></tr></table>',
    ),
    url,
  );
  expect(result.description).toBe(
    'Audience: Everyone\nSchedule: Day one / Day two',
  );
});

it('keeps safe relative link targets as plain text and warns about registration instructions', () => {
  const result = extractProgramNotice(
    document(
      '<p>신청: <a href="/education_single/?post_id=42">등록 안내</a></p>',
    ),
    url,
  );
  expect(result.description).toBe(
    '신청: 등록 안내 (https://sojoong.kr/education_single/?post_id=42)',
  );
  expect(result.warnings).toContain('EXTERNAL_APPLICATION_LINK');
});

it('discards executable content and unsafe link targets, keeping text only', () => {
  const result = extractProgramNotice(
    document(
      '<script>alert(1)</script><style>body{color:red}</style><nav>Navigation</nav><iframe>hidden</iframe><p onclick="bad()">Safe <a href="javascript:alert(1)">label</a><img src="x" onerror="bad()"></p>',
    ),
    url,
  );
  expect(result.description).toBe('Safe label');
  expect(result.coverImages).toEqual([]);
});

it('extracts deduplicated body posters while excluding OG logo and unsupported images', () => {
  const result = extractProgramNotice(
    document(
      `<p>Text</p><img src="${image}"><img src="${image}"><img src="/wp-content/uploads/kboard_attached/1/209901/second.png"><img src="https://evil.example/poster.jpg">`,
    ),
    url,
  );
  expect(result.coverImages).toEqual([
    image,
    'https://sojoong.kr/wp-content/uploads/kboard_attached/1/209901/second.png',
  ]);
  expect(result.warnings).toContain('MULTIPLE_IMAGES');
});

it('supports an image-only notice without inventing a description', () => {
  const result = extractProgramNotice(
    document(`<p>&nbsp;</p><img src="${image}">`),
    url,
  );
  expect(result.description).toBe('');
  expect(result.coverImages).toEqual([image]);
});

it('does not invent section breaks from dates, URLs or punctuation', () => {
  const result = extractProgramNotice(
    document('<p>Day: 2099-01-01 13:40–17:00, version 1.2/3.</p>'),
    url,
  );
  expect(result.description).toBe(
    'Day: 2099-01-01 13:40–17:00, version 1.2/3.',
  );
});

it.each([
  '<html>changed layout</html>',
  document('<p> </p>'),
  document('<p>' + 'a'.repeat(10_001) + '</p>'),
])(
  'fails explicitly on missing structure, empty body or overlong content',
  (html) => {
    expect(() => extractProgramNotice(html, url)).toThrow();
  },
);

it('collapses excessive empty blocks while retaining paragraph breaks', () => {
  const result = extractProgramNotice(
    document('<p> One \r\n inline </p><p>&nbsp;</p><br><p> Two </p>'),
    url,
  );
  expect(result.description).toBe('One inline\n\nTwo');
});

it('collapses incidental spaces across inline elements without flattening paragraphs', () => {
  const result = extractProgramNotice(
    document('<p>One <b> two </b> three</p><p>Four</p>'),
    url,
  );
  expect(result.description).toBe('One two three\nFour');
});

it('retains header-only tables as source text', () => {
  const result = extractProgramNotice(
    document('<table><tr><th>Day</th><th>Activity</th></tr></table>'),
    url,
  );
  expect(result.description).toBe('Day · Activity');
});

it('keeps spanning tables as source rows instead of guessing column labels', () => {
  const result = extractProgramNotice(
    document(
      '<table><tr><th>Day</th><th colspan="2">Program</th></tr><tr><td rowspan="2">One</td><td>AM</td><td>Session A</td></tr><tr><td>PM</td><td>Session B</td></tr></table>',
    ),
    url,
  );
  expect(result.description).toBe(
    'Day · Program\nOne · AM · Session A\nPM · Session B',
  );
});

it('renders nested table rows once inside their cell without outer labels', () => {
  const result = extractProgramNotice(
    document(
      '<table><tr><th>Item</th><th>Detail</th></tr><tr><td>Fee</td><td><table><tr><td>Student</td><td>Free</td></tr><tr><td>Staff</td><td>Paid</td></tr></table></td></tr></table>',
    ),
    url,
  );
  expect(result.description).toBe(
    'Item · Detail\nFee · Student · Free / Staff · Paid',
  );
});

it('keeps caption and sectioned simple table labels while skipping hidden rows', () => {
  const result = extractProgramNotice(
    document(
      '<table><caption>Schedule</caption><thead><tr><th>Day</th><th>Activity</th></tr></thead><tbody><tr><td rowspan="1">One</td><td>Session A</td></tr><tr style="display:none"><td>Hidden</td><td>Row</td></tr></tbody></table>',
    ),
    url,
  );
  expect(result.description).toBe('Schedule\nDay: One · Activity: Session A');
});

it('resolves long line-break runs within the default test timeout', () => {
  const result = extractProgramNotice(
    document(`<p>a${' <br>'.repeat(49_000)}b</p>`),
    url,
  );
  expect(result.description).toBe('a\n\nb');
});

it('rejects deeply nested markup while parsing instead of after a quadratic parse', () => {
  let error: unknown;
  try {
    extractProgramNotice(document(`${'<ul><li>'.repeat(40_000)}x`), url);
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({
    errorCode: { code: 'PROGRAM_NOTICE_UNSUPPORTED_CONTENT' },
  });
});

it('does not pair row labels with values when the table has spanning cells', () => {
  const result = extractProgramNotice(
    document(
      '<table><tr><th rowspan="2">Schedule</th><td>Day one</td></tr><tr><th>Place</th><td>Hall</td></tr></table>',
    ),
    url,
  );
  expect(result.description).toBe('Schedule · Day one\nPlace · Hall');
});

it('does not indent a line because of source whitespace after a break or block', () => {
  const result = extractProgramNotice(
    document('<p>One<br> Two</p><div>Three</div> Four'),
    url,
  );
  expect(result.description).toBe('One\nTwo\nThree\nFour');
});

it('keeps visible text inside lists and skips hidden list items', () => {
  const result = extractProgramNotice(
    document(
      '<ul><p>Intro</p><li>Visible</li><li hidden>Hidden</li><li style="display:none">Also hidden</li></ul>',
    ),
    url,
  );
  expect(result.description).toBe('Intro\n• Visible');
});

it('keeps multi-line header cells on one line and skips blank header labels', () => {
  const result = extractProgramNotice(
    document(
      '<table><tr><th>Day<br>Part</th><th></th><th>Activity</th></tr><tr><td>One</td><td>AM</td><td>Session A</td></tr></table>',
    ),
    url,
  );
  expect(result.description).toBe('Day / Part: One · AM · Activity: Session A');
});

it('does not append link targets for image-only or same-page links', () => {
  const result = extractProgramNotice(
    document(
      `<p><a href="${image}"><img src="${image}"></a></p><p><a href="#top">맨 위로</a></p>`,
    ),
    url,
  );
  expect(result.description).toBe('맨 위로');
  expect(result.coverImages).toEqual([image]);
});

it('treats zero-width-space paragraphs as section spacers', () => {
  const result = extractProgramNotice(
    document('<p>One</p><p>&#8203;</p><p>Two</p>'),
    url,
  );
  expect(result.description).toBe('One\n\nTwo');
});

it('uses a lazy poster URL when the src is an unsupported placeholder', () => {
  const result = extractProgramNotice(
    document(`<img src="data:image/gif;base64,AAAA" data-src="${image}">`),
    url,
  );
  expect(result.coverImages).toEqual([image]);
});
