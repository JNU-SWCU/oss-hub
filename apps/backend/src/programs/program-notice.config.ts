export const PROGRAM_NOTICE_LIST_URL =
  'https://sojoong.kr/notice/notice-board/';

export const PROGRAM_NOTICE_OMIT_TAGS = new Set([
  'script',
  'style',
  'nav',
  'footer',
  'header',
  'aside',
  'form',
  'button',
  'input',
  'iframe',
  'object',
  'embed',
  'svg',
  'canvas',
  'noscript',
  'template',
]);

export const PROGRAM_NOTICE_BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'dl',
  'dt',
  'dd',
  'pre',
]);
