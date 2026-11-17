import {
  PROGRAM_NOTICE_OMIT_TAGS,
  PROGRAM_NOTICE_BLOCK_TAGS,
} from './program-notice.config';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import {
  type DefaultTreeAdapterMap,
  type TreeAdapter,
  defaultTreeAdapter,
  parse,
} from 'parse5';

type Node = DefaultTreeAdapterMap['node'];

type ParentNode = DefaultTreeAdapterMap['parentNode'];

type NoticeElement = DefaultTreeAdapterMap['element'];

const MAX_DEPTH = 100;

const noticeTreeAdapter: TreeAdapter<DefaultTreeAdapterMap> = {
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

const BREAK = String.fromCharCode(0xe001);

const BLANK = String.fromCharCode(0xe000);

const IGNORED = new RegExp(
  `[${BREAK}${BLANK}${String.fromCharCode(0x200b, 0xfeff)}]`,
  'g',
);

const SPACING_RUN = new RegExp(`[ \n${BREAK}${BLANK}]+`, 'g');

@Injectable()
export class ProgramNoticeHtmlClient {
  document(html: string): NoticeElement[] {
    return this.elements(parse(html, { treeAdapter: noticeTreeAdapter }));
  }
  attribute(node: NoticeElement, name: string): string {
    return node.attrs.find((attribute) => attribute.name === name)?.value ?? '';
  }

  elements(root: Node): NoticeElement[] {
    const found: NoticeElement[] = [];
    const pending = [{ node: root, depth: 0 }];
    while (pending.length) {
      const entry = pending.pop();
      if (!entry) break;
      if (entry.depth > MAX_DEPTH || found.length > 50_000)
        throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
      if ('tagName' in entry.node) {
        if (this.isOmitted(entry.node)) continue;
        found.push(entry.node);
      }
      if ('childNodes' in entry.node) {
        for (const child of [...entry.node.childNodes].reverse())
          pending.push({ node: child, depth: entry.depth + 1 });
      }
    }
    return found;
  }

  hasClass(node: NoticeElement, name: string): boolean {
    return this.attribute(node, 'class').split(/\s+/).includes(name);
  }

  isOmitted(node: NoticeElement): boolean {
    return (
      PROGRAM_NOTICE_OMIT_TAGS.has(node.tagName) ||
      node.attrs.some((attr) => attr.name === 'hidden') ||
      this.attribute(node, 'aria-hidden') === 'true' ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        this.attribute(node, 'style'),
      )
    );
  }

  cleanText(value: string): string {
    return value
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

      .map((line) =>
        line
          .trimEnd()
          .replace(/^ (?=\S)/, '')
          .replace(/(\S) +/g, '$1 '),
      )
      .join('\n')
      .replace(/\n[ ]*\n(?:[ ]*\n)+/g, '\n\n')
      .trim();
  }

  noticeText(root: Node, source: URL, listDepth = 0): string {
    if ('value' in root)
      return root.value.replace(IGNORED, '').replace(/\s+/g, ' ');
    if (!('tagName' in root) || this.isOmitted(root)) return '';
    if (root.tagName === 'br') return '\n';
    if (root.tagName === 'hr') return BLANK;
    if (root.tagName === 'img') return '';
    if (root.tagName === 'ul' || root.tagName === 'ol')
      return this.renderList(root, source, listDepth);
    if (root.tagName === 'table')
      return `${BREAK}${this.renderTable(root, source)}${BREAK}`;
    const content = root.childNodes
      .map((child) => this.noticeText(child, source, listDepth))
      .join('');
    if (root.tagName === 'a') {
      const href = this.attribute(root, 'href');
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
    if (!PROGRAM_NOTICE_BLOCK_TAGS.has(root.tagName)) return content;
    const text = content.trim();
    if (!text) return BLANK;
    return `${/^h[1-6]$/.test(root.tagName) ? BLANK : ''}${BREAK}${text}${BREAK}`;
  }

  renderList(root: NoticeElement, source: URL, depth: number): string {
    let number = /^\d{1,5}$/.test(this.attribute(root, 'start'))
      ? Number(this.attribute(root, 'start'))
      : 1;
    const content = root.childNodes
      .map((child) => {
        if (!('tagName' in child) || child.tagName !== 'li')
          return this.cleanText(this.noticeText(child, source, depth));
        if (this.isOmitted(child)) return '';
        const marker = root.tagName === 'ol' ? `${number++}.` : '•';
        const text = this.cleanText(
          child.childNodes
            .map((node) => this.noticeText(node, source, depth + 1))
            .join(''),
        );
        return `${'  '.repeat(depth)}${marker} ${text}`;
      })
      .filter(Boolean)
      .join('\n');
    return depth ? `\n${content}\n` : `${BREAK}${content}${BREAK}`;
  }

  renderTable(root: NoticeElement, source: URL): string {
    const children = this.visibleChildren(root);

    const rows = children
      .filter((node) => ['thead', 'tbody', 'tfoot'].includes(node.tagName))
      .flatMap((section) =>
        this.visibleChildren(section).filter((node) => node.tagName === 'tr'),
      )
      .map((row) =>
        this.visibleChildren(row).filter((node) =>
          ['th', 'td'].includes(node.tagName),
        ),
      );

    const labelled = !rows.flat().some(
      (cell) =>
        ['rowspan', 'colspan'].some((name) => {
          const span = Number.parseInt(this.attribute(cell, name), 10);
          return !Number.isNaN(span) && span !== 1;
        }) ||
        this.elements(cell).some(
          (node) => node !== cell && node.tagName === 'table',
        ),
    );
    const cellText = (cell: NoticeElement) =>
      this.cleanText(this.noticeText(cell, source)).replace(/\n+/g, ' / ');
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
      caption ? this.cleanText(this.noticeText(caption, source)) : '',
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

  visibleChildren(node: NoticeElement): NoticeElement[] {
    return node.childNodes.filter(
      (child): child is NoticeElement =>
        'tagName' in child && !this.isOmitted(child),
    );
  }
}
