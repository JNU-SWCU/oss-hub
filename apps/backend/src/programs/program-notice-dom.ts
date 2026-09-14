import {
  defaultTreeAdapter,
  type DefaultTreeAdapterMap,
  type TreeAdapter,
} from 'parse5';
import { DomainException } from '../common/error-code';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code';

type Node = DefaultTreeAdapterMap['node'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];
export type NoticeElement = DefaultTreeAdapterMap['element'];
const MAX_DEPTH = 100;
// parse5 rescans its open-element stack per token, so deep nesting is quadratic.
// Abort while parsing at the same depth elements() rejects instead of after the slow parse.
export const noticeTreeAdapter: TreeAdapter<DefaultTreeAdapterMap> = {
  ...defaultTreeAdapter,
  appendChild(parent, child) {
    assertShallow(parent);
    defaultTreeAdapter.appendChild(parent, child);
  },
  insertBefore(parent, child, reference) {
    assertShallow(parent);
    defaultTreeAdapter.insertBefore(parent, child, reference);
  },
};
function assertShallow(parent: ParentNode): void {
  let depth = 0;
  for (
    let node: ParentNode | null = parent;
    node;
    node = 'parentNode' in node ? node.parentNode : null
  )
    if (++depth > MAX_DEPTH)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
}
const OMIT_TAGS = new Set([
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
const BLOCK_TAGS = new Set([
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
// Source pages space each paragraph by about half a line and mark sections with empty
// paragraphs, so block boundaries become line breaks while empty blocks, <hr>, headings
// and <br><br> become one blank line. cleanText resolves these private-use markers.
const BREAK = String.fromCharCode(0xe001);
const BLANK = String.fromCharCode(0xe000);
// Markers, zero-width spaces and byte-order marks never survive from source text.
const IGNORED = new RegExp(
  `[${BREAK}${BLANK}${String.fromCharCode(0x200b, 0xfeff)}]`,
  'g',
);
// Maximal runs only: no token follows the quantifier, so long <br> runs stay linear.
const SPACING_RUN = new RegExp(`[ \n${BREAK}${BLANK}]+`, 'g');
export function attribute(node: NoticeElement, name: string): string {
  return node.attrs.find((attribute) => attribute.name === name)?.value ?? '';
}
export function elements(root: Node): NoticeElement[] {
  const found: NoticeElement[] = [];
  const pending = [{ node: root, depth: 0 }];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    if (entry.depth > MAX_DEPTH || found.length > 50_000)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
    if ('tagName' in entry.node) {
      if (isOmitted(entry.node)) continue;
      found.push(entry.node);
    }
    if ('childNodes' in entry.node) {
      for (const child of [...entry.node.childNodes].reverse())
        pending.push({ node: child, depth: entry.depth + 1 });
    }
  }
  return found;
}
export function hasClass(node: NoticeElement, name: string): boolean {
  return attribute(node, 'class').split(/\s+/).includes(name);
}
function isOmitted(node: NoticeElement): boolean {
  return (
    OMIT_TAGS.has(node.tagName) ||
    node.attrs.some((attr) => attr.name === 'hidden') ||
    attribute(node, 'aria-hidden') === 'true' ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
      attribute(node, 'style'),
    )
  );
}
export function cleanText(value: string): string {
  return (
    value
      .replace(SPACING_RUN, (run) => {
        if (!run.includes(BREAK) && !run.includes(BLANK)) return run;
        const indent = run.slice(
          Math.max(
            run.lastIndexOf('\n'),
            run.lastIndexOf(BREAK),
            run.lastIndexOf(BLANK),
          ) + 1,
        );
        return (
          (run.includes(BLANK) || run.split('\n').length > 2 ? '\n\n' : '\n') +
          indent
        );
      })
      .split('\n')
      // One leading space is source whitespace after a break; list indentation uses two or more.
      .map((line) =>
        line
          .trimEnd()
          .replace(/^ (?=\S)/, '')
          .replace(/(\S) +/g, '$1 '),
      )
      .join('\n')
      .replace(/\n[ ]*\n(?:[ ]*\n)+/g, '\n\n')
      .trim()
  );
}
export function noticeText(root: Node, source: URL, listDepth = 0): string {
  if ('value' in root)
    return root.value.replace(IGNORED, '').replace(/\s+/g, ' ');
  if (!('tagName' in root) || isOmitted(root)) return '';
  if (root.tagName === 'br') return '\n';
  if (root.tagName === 'hr') return BLANK;
  if (root.tagName === 'img') return '';
  if (root.tagName === 'ul' || root.tagName === 'ol')
    return renderList(root, source, listDepth);
  if (root.tagName === 'table')
    return `${BREAK}${renderTable(root, source)}${BREAK}`;
  const content = root.childNodes
    .map((child) => noticeText(child, source, listDepth))
    .join('');
  if (root.tagName === 'a') {
    const href = attribute(root, 'href');
    if (
      content.trim() &&
      href &&
      !href.startsWith('#') &&
      !/[\s\\]/.test(href) &&
      URL.canParse(href, source)
    ) {
      const target = new URL(href, source);
      if (
        ['https:', 'http:'].includes(target.protocol) &&
        !target.username &&
        !target.password &&
        content.trim() !== target.href
      )
        return `${content} (${target.href})`;
    }
  }
  if (!BLOCK_TAGS.has(root.tagName)) return content;
  const text = content.trim();
  if (!text) return BLANK;
  return `${/^h[1-6]$/.test(root.tagName) ? BLANK : ''}${BREAK}${text}${BREAK}`;
}
function renderList(root: NoticeElement, source: URL, depth: number): string {
  let number = /^\d{1,5}$/.test(attribute(root, 'start'))
    ? Number(attribute(root, 'start'))
    : 1;
  const content = root.childNodes
    .map((child) => {
      // Editors sometimes put paragraphs directly in a list; keep that text as its own line.
      if (!('tagName' in child) || child.tagName !== 'li')
        return cleanText(noticeText(child, source, depth));
      if (isOmitted(child)) return '';
      const marker = root.tagName === 'ol' ? `${number++}.` : '•';
      const text = cleanText(
        child.childNodes
          .map((node) => noticeText(node, source, depth + 1))
          .join(''),
      );
      return `${'  '.repeat(depth)}${marker} ${text}`;
    })
    .filter(Boolean)
    .join('\n');
  return depth ? `\n${content}\n` : `${BREAK}${content}${BREAK}`;
}
function renderTable(root: NoticeElement, source: URL): string {
  const children = visibleChildren(root);
  // parse5 always wraps table rows in thead/tbody/tfoot; nested table rows stay in their cell.
  const rows = children
    .filter((node) => ['thead', 'tbody', 'tfoot'].includes(node.tagName))
    .flatMap((section) =>
      visibleChildren(section).filter((node) => node.tagName === 'tr'),
    )
    .map((row) =>
      visibleChildren(row).filter((node) =>
        ['th', 'td'].includes(node.tagName),
      ),
    );
  // Spanning or nested cells shift column positions, so labels are not inferred.
  const labelled = !rows.flat().some(
    (cell) =>
      ['rowspan', 'colspan'].some((name) => {
        const span = Number.parseInt(attribute(cell, name), 10);
        return !Number.isNaN(span) && span !== 1;
      }) ||
      elements(cell).some((node) => node !== cell && node.tagName === 'table'),
  );
  const cellText = (cell: NoticeElement) =>
    cleanText(noticeText(cell, source)).replace(/\n+/g, ' / ');
  const first = rows[0];
  const headers =
    labelled &&
    first &&
    rows.length > 1 &&
    first.length > 1 &&
    first.every((cell) => cell.tagName === 'th')
      ? first.map(cellText)
      : null;
  const caption = children.find((node) => node.tagName === 'caption');
  return [
    caption ? cleanText(noticeText(caption, source)) : '',
    ...(headers ? rows.slice(1) : rows).map((row) => {
      const values = row.map(cellText);
      if (headers && headers.length === values.length)
        return values
          .map((value, index) =>
            headers[index] ? `${headers[index]}: ${value}` : value,
          )
          .join(' · ');
      if (
        labelled &&
        row.length === 2 &&
        row[0]?.tagName === 'th' &&
        row[1]?.tagName === 'td'
      )
        return values.join(': ');
      return values.join(' · ');
    }),
  ]
    .filter(Boolean)
    .join('\n');
}
function visibleChildren(node: NoticeElement): NoticeElement[] {
  return node.childNodes.filter(
    (child): child is NoticeElement => 'tagName' in child && !isOmitted(child),
  );
}
