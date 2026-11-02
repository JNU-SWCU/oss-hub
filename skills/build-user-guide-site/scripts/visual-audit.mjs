import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(join(ROOT, 'apps/frontend/package.json'))(
  '@playwright/test',
);

const ORIGIN = (process.argv[2] ?? 'https://jnu-swcu.github.io').replace(
  /\/$/,
  '',
);
const SITE_BASE = '/oss-hub';
const outFile =
  process.argv[3] ??
  join(mkdtempSync(join(tmpdir(), 'guide-audit-')), 'audit.json');

const VIEWPORTS = [
  [1440, 900, 'light'],
  [390, 844, 'light'],
  [1440, 900, 'dark'],
  [390, 844, 'dark'],
];

const xml = await (await fetch(`${ORIGIN}${SITE_BASE}/sitemap-0.xml`)).text();
const urls = [
  ...new Set(
    [...xml.matchAll(/<loc>([^<]*)/g)].map((m) =>
      m[1].replace(new RegExp(`${SITE_BASE}$`), `${SITE_BASE}/`),
    ),
  ),
];

const b = await chromium.launch({ channel: 'chrome' });
const res = [];
const links = new Map();

for (const [w, h, scheme] of VIEWPORTS) {
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    colorScheme: scheme,
  });
  for (const u of urls) {
    const p = await ctx.newPage();
    const errs = [];
    const bad = [];
    p.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text());
    });
    p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    p.on('response', (r) => {
      if (r.status() >= 400) bad.push(r.status() + ' ' + r.url());
    });
    await p.goto(u, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      scrollTo(0, 0);
    });
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const o = {};
      o.title = document.title;
      o.hscroll = document.documentElement.scrollWidth - innerWidth;
      o.brokenImg = [...document.images]
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => i.src);
      o.emptyAlt = [...document.images]
        .filter((i) => !i.alt || !i.alt.trim())
        .map((i) => i.src.slice(-60));
      o.overflowEls = [
        ...document.querySelectorAll('main table, main pre, main img'),
      ]
        .filter(
          (e) =>
            e.scrollWidth > e.clientWidth + 1 ||
            e.getBoundingClientRect().right > innerWidth + 1,
        )
        .map(
          (e) =>
            e.tagName +
            ':' +
            (e.className || '').toString().slice(0, 30) +
            ':' +
            e.scrollWidth +
            '>' +
            e.clientWidth,
        );
      const hs = [
        ...document.querySelectorAll(
          '.sl-markdown-content h1,.sl-markdown-content h2,.sl-markdown-content h3,.sl-markdown-content h4',
        ),
      ].map((h) => +h.tagName[1]);
      const skip = [];
      let prev = 1;
      for (const l of hs) {
        if (l > prev + 1) skip.push(prev + '->' + l);
        prev = l;
      }
      o.headSkip = skip;
      o.links = [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .filter((h) => h.startsWith(location.origin));
      o.ol = [...document.querySelectorAll('ol')].map(
        (ol) => ol.getAttribute('start') || '',
      );
      o.favicon = document.querySelector('link[rel~=icon]')?.href;
      return o;
    });
    Object.assign(r, { url: u, vp: `${w}-${scheme}`, errs, bad });
    res.push(r);
    for (const l of r.links) if (!links.has(l)) links.set(l, u);
    await p.close();
  }
  await ctx.close();
}
await b.close();

writeFileSync(outFile, JSON.stringify(res, null, 1));
console.log('out', outFile);
for (const r of res) {
  const f = [];
  if (r.hscroll > 0) f.push('HSCROLL ' + r.hscroll);
  if (r.brokenImg.length) f.push('BROKEN ' + r.brokenImg);
  if (r.emptyAlt.length) f.push('EMPTYALT ' + r.emptyAlt);
  if (r.overflowEls.length) f.push('OVF ' + r.overflowEls);
  if (r.headSkip.length) f.push('HEAD ' + r.headSkip);
  if (r.errs.length) f.push('ERR ' + r.errs);
  if (r.bad.length) f.push('BAD ' + r.bad);
  if (f.length) console.log(r.vp, r.url, f.join(' | '));
}
console.log('titles', [...new Set(res.map((r) => r.title))].join(' || '));

const broken = [];
for (const [l, from] of links) {
  const u = l.split('#')[0];
  const rr = await fetch(u, { redirect: 'follow' });
  if (rr.status >= 400) broken.push(rr.status + ' ' + l + ' <- ' + from);
  else if (l.includes('#')) {
    const t = await rr.text();
    const id = l.split('#')[1];
    if (id && !t.includes('id="' + decodeURIComponent(id) + '"'))
      broken.push('ANCHOR ' + l + ' <- ' + from);
  }
}
console.log('links', links.size, 'broken', broken);
