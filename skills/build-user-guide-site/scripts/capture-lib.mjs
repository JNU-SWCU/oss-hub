import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const BASE_URL = process.env.GUIDE_BASE_URL ?? 'http://localhost:3310';
export const SHOT_ROOT =
  process.env.GUIDE_SHOT_ROOT ?? join(ROOT, 'website/src/assets/shots');
export const MARK_MIN_PX = 20;
export const SHOT_PAD_PX = 12;

const PG_CONTAINER =
  process.env.GUIDE_PG_CONTAINER ?? 'oss-hub-guide-postgres-1';

const { chromium } = createRequire(join(ROOT, 'apps/frontend/package.json'))(
  '@playwright/test',
);
const { SignJWT } = createRequire(join(ROOT, 'apps/backend/package.json'))(
  'jose',
);
const sharp = createRequire(join(ROOT, 'website/package.json'))('sharp');

function loadSecret() {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error('SESSION_SECRET 환경 변수가 필요합니다.');
  return new Uint8Array(Buffer.from(raw, 'base64url'));
}

function sql(q) {
  return execFileSync(
    'docker',
    [
      'exec',
      PG_CONTAINER,
      'psql',
      '-U',
      'oss',
      '-d',
      'oss_hub',
      '-tAF',
      '|',
      '-c',
      q,
    ],
    { encoding: 'utf8' },
  ).trim();
}

export async function sessionToken(login) {
  const row = sql(
    `select "githubId","sessionVersion" from "User" where login='${login.replace(/'/g, '')}'`,
  );
  if (!row) throw new Error(`unknown login: ${login}`);
  const [githubId, sessionVersion] = row.split('|');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sessionVersion: Number(sessionVersion) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(githubId)
    .setIssuer('oss-hub')
    .setAudience('oss-hub-web')
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60 * 24)
    .sign(loadSecret());
}

const CLEAN_CSS = `
  nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], #__next-build-watcher { display: none !important; }
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
`;

let browserPromise;

export async function openAs(login, o = {}) {
  const { width = 1280, height = 800, dpr = 2, theme = 'light' } = o;
  browserPromise ??= chromium.launch({ channel: 'chrome' });
  const browser = await browserPromise;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  if (login) {
    await ctx.addCookies([
      {
        name: 'oss_session_dev',
        value: await sessionToken(login),
        domain: new URL(BASE_URL).hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  await ctx.addInitScript((t) => {
    try {
      document.documentElement.classList.toggle('dark', t === 'dark');
      localStorage.setItem('theme', t);
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  page.__problems = [];
  page.on('response', (r) => {
    if (r.status() >= 500) page.__problems.push(`${r.status()} ${r.url()}`);
  });
  return page;
}

export async function closeAll() {
  const pending = browserPromise;
  browserPromise = undefined;
  await pending?.then((b) => b.close()).catch(() => {});
}

export async function visit(page, path) {
  await page.goto(path.startsWith('http') ? path : BASE_URL + path, {
    waitUntil: 'load',
  });
  return settle(page);
}

export async function settle(page) {
  await page.addStyleTag({ content: CLEAN_CSS });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.addStyleTag({ content: CLEAN_CSS });
  const theme =
    (await page.evaluate(() => localStorage.getItem('theme'))) ?? 'light';
  await page.evaluate(
    (t) => document.documentElement.classList.toggle('dark', t === 'dark'),
    theme,
  );
}

const SAFE_EMAIL_TLD = /\.(invalid|example)$/i;
const BAD_WORDS = /seed-auth|seed-demo|synthetic|fixture|placeholder/i;

export async function leakCheck(page) {
  const text = await page.evaluate(() => {
    const parts = [document.body.innerText];
    document.querySelectorAll('[alt],[title],input,textarea').forEach((e) => {
      for (const a of ['alt', 'title', 'placeholder', 'value'])
        if (e.getAttribute?.(a)) parts.push(e.getAttribute(a));
    });
    return parts.join('\n');
  });
  const problems = [];
  for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
    if (!SAFE_EMAIL_TLD.test(m[1])) problems.push(`email: ${m[0]}`);
  }
  const bad = BAD_WORDS.exec(text);
  if (bad) problems.push(`word: ${bad[0]}`);
  const badge = await page.evaluate(() => {
    const el = document.querySelector('nextjs-portal');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return (
      getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0
    );
  });
  if (badge) problems.push('next dev badge visible');
  const toast = await page.locator('[data-sonner-toast]').count();
  if (toast) {
    const first = await page.locator('[data-sonner-toast]').first().innerText();
    problems.push(`toast visible (${toast}): ${first.slice(0, 80)}`);
  }
  if (page.__problems?.length)
    problems.push(...page.__problems.map((p) => `http: ${p}`));
  return problems;
}

const BLUR_PX = 8;
const MARK_COLOR = '#E5242A';

function toLocator(page, target) {
  return typeof target === 'string' ? page.locator(target) : target;
}

async function applyBlur(page, target) {
  const loc = toLocator(page, target);
  const n = await loc.count();
  if (!n) throw new Error(`blur target matched nothing: ${String(target)}`);
  await loc.evaluateAll(
    (els, px) =>
      els.forEach((e) => {
        if (!e.hasAttribute('data-guide-blur'))
          e.setAttribute('data-guide-blur', e.style.filter || '');
        e.style.setProperty('filter', `blur(${px}px)`, 'important');
      }),
    BLUR_PX,
  );
}

async function applyMarks(page, marks, mode, bounds) {
  const items = [];
  for (const m of marks) {
    const loc = toLocator(page, m.target);
    const n = await loc.count();
    if (!n) throw new Error(`mark target matched nothing: ${String(m.target)}`);
    const rects = await loc.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      }),
    );
    for (const r of rects) {
      if (r.w < MARK_MIN_PX || r.h < MARK_MIN_PX) {
        throw new Error(
          `mark target is ${Math.round(r.w)}x${Math.round(r.h)}px, under ${MARK_MIN_PX}px: ${String(m.target)}`,
        );
      }
      items.push({ ...r, label: m.label });
    }
  }
  await page.evaluate(
    ({ items, mode, bounds, color }) => {
      const off =
        mode === 'fixed' ? { x: scrollX, y: scrollY } : { x: 0, y: 0 };
      const mk = (css) => {
        const d = document.createElement('div');
        d.setAttribute('data-guide-mark', '');
        d.style.cssText = `position:${mode};pointer-events:none;box-sizing:border-box;${css}`;
        document.documentElement.appendChild(d);
        return d;
      };
      const M = 4;
      for (const it of items) {
        const x = it.x - off.x - M;
        const y = it.y - off.y - M;
        mk(
          `z-index:2147483646;left:${x}px;top:${y}px;width:${it.w + 2 * M}px;height:${it.h + 2 * M}px;` +
            `border:2.5px solid ${color};border-radius:6px;`,
        );
      }
      const D = 22;
      const placed = [];
      for (const it of items) {
        if (!it.label) continue;
        let bx = it.x - off.x + it.w + M - D / 2;
        let by = it.y - off.y - M - D / 2;
        const hit = () =>
          placed.some((p) => Math.abs(p.x - bx) < D && Math.abs(p.y - by) < D);
        for (let i = 0; i < 20 && hit(); i++) bx -= D + 2;
        bx = Math.min(Math.max(bx, bounds.x + 2), bounds.x + bounds.w - D - 2);
        by = Math.min(Math.max(by, bounds.y + 2), bounds.y + bounds.h - D - 2);
        placed.push({ x: bx, y: by });
        const b = mk(
          `z-index:2147483647;left:${bx}px;top:${by}px;width:${D}px;height:${D}px;border-radius:50%;` +
            `background:${color};color:#fff;font:700 13px/${D}px -apple-system,'Noto Sans KR',sans-serif;` +
            `text-align:center;box-shadow:0 0 0 1.5px #fff;`,
        );
        b.textContent = it.label;
      }
    },
    { items, mode, bounds, color: MARK_COLOR },
  );
}

export async function clipAround(page, targets, pad = SHOT_PAD_PX) {
  const boxes = [];
  for (const t of targets) {
    const b = await toLocator(page, t)
      .first()
      .evaluate((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      });
    boxes.push(b);
  }
  const doc = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  return {
    x,
    y,
    width: Math.min(doc.w, Math.max(...boxes.map((b) => b.x + b.w)) + pad) - x,
    height: Math.min(doc.h, Math.max(...boxes.map((b) => b.y + b.h)) + pad) - y,
  };
}

export async function shot(page, role, name, opts = {}) {
  await settle(page);
  const problems = await leakCheck(page);
  if (problems.length && !opts.allowLeak) {
    throw new Error(
      `leakCheck failed for ${role}/${name} @ ${page.url()}:\n  ` +
        problems.join('\n  '),
    );
  }
  const blur = opts.blur ?? [];
  const marks = (opts.marks ?? []).map((m) =>
    typeof m === 'string' || typeof m?.count === 'function' ? { target: m } : m,
  );
  let png;
  try {
    for (const t of blur) await applyBlur(page, t);
    const loc = opts.locator
      ? typeof opts.locator === 'string'
        ? page.locator(opts.locator).first()
        : opts.locator
      : null;
    if (loc) {
      await loc.evaluate((e) => {
        const d = e.closest('[role=dialog],[role=alertdialog]');
        if (!d) return;
        d.setAttribute('data-guide-dialog', '');
        let bg = 'rgba(0, 0, 0, 0)';
        for (const el of [document.body, document.documentElement]) {
          const c = getComputedStyle(el).backgroundColor;
          if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
            bg = c;
            break;
          }
        }
        if (bg === 'rgba(0, 0, 0, 0)')
          bg = document.documentElement.classList.contains('dark')
            ? '#0a0a0a'
            : '#ffffff';
        const s = document.createElement('style');
        s.setAttribute('data-guide-mark', '');
        s.textContent =
          `html,body{background:${bg} !important}` +
          `body *{visibility:hidden !important}` +
          `[data-guide-dialog],[data-guide-dialog] *{visibility:visible !important}`;
        document.documentElement.appendChild(s);
      });
    }
    if (loc) {
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return {
          x: r.x + scrollX,
          y: r.y + scrollY,
          width: r.width,
          height: r.height,
        };
      });
      const pad = SHOT_PAD_PX;
      const doc = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
      }));
      const x = Math.max(0, b.x - pad);
      const y = Math.max(0, b.y - pad);
      const clip = {
        x,
        y,
        width: Math.min(doc.w, b.x + b.width + pad) - x,
        height: Math.min(doc.h, b.y + b.height + pad) - y,
      };
      await applyMarks(page, marks, 'absolute', {
        x: clip.x,
        y: clip.y,
        w: clip.width,
        h: clip.height,
      });
      png = await page.screenshot({
        fullPage: true,
        clip,
        animations: 'disabled',
      });
    } else if (marks.length) {
      const doc = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
        vw: innerWidth,
        vh: innerHeight,
      }));
      let mode = 'fixed';
      let bounds = { x: 0, y: 0, w: doc.vw, h: doc.vh };
      if (opts.fullPage) {
        mode = 'absolute';
        bounds = { x: 0, y: 0, w: doc.w, h: doc.h };
      }
      if (opts.clip)
        bounds = {
          x: opts.clip.x,
          y: opts.clip.y,
          w: opts.clip.width,
          h: opts.clip.height,
        };
      await applyMarks(page, marks, mode, bounds);
      png = await page.screenshot({
        fullPage: !!opts.fullPage,
        clip: opts.clip,
        animations: 'disabled',
      });
    } else {
      png = await page.screenshot({
        fullPage: !!opts.fullPage,
        clip: opts.clip,
        animations: 'disabled',
      });
    }
  } finally {
    await page.evaluate(() => {
      document.querySelectorAll('[data-guide-mark]').forEach((e) => e.remove());
      document
        .querySelectorAll('[data-guide-dialog]')
        .forEach((e) => e.removeAttribute('data-guide-dialog'));
      document.querySelectorAll('[data-guide-blur]').forEach((e) => {
        e.style.filter = e.getAttribute('data-guide-blur') || '';
        e.removeAttribute('data-guide-blur');
      });
    });
  }
  const dir = join(opts.dir ?? SHOT_ROOT, role);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}.webp`);
  await sharp(png).webp({ quality: 82 }).toFile(out);
  return out;
}
