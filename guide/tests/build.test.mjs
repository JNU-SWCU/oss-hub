import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const dist = new URL('../dist/', import.meta.url);
const root = readFileSync(new URL('index.html', dist), 'utf8');
const script = [...root.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find((source) => source.includes('rootDestination'));

function redirect(path, languages, language, saved, blocked = false) {
  const redirects = [];
  vm.runInNewContext(script, {
    URL,
    location: { href: `https://jnu-swcu.github.io${path}`, replace: (target) => redirects.push(target) },
    localStorage: { getItem: () => { if (blocked) throw new Error('unavailable'); return saved; } },
    navigator: { languages, language },
  });
  return redirects;
}

test('built inline bootstrap follows language priority without a browser', () => {
  assert.ok(script);
  assert.deepEqual(redirect('/oss-hub/', ['ko-KR'], 'ko-KR'), []);
  assert.deepEqual(redirect('/oss-hub/', ['en-US'], 'en-US'), ['/oss-hub/en/']);
  assert.deepEqual(redirect('/oss-hub/', ['ja-JP'], 'ja-JP'), ['/oss-hub/en/']);
  assert.deepEqual(redirect('/oss-hub/', ['en'], 'en', 'ko'), []);
  assert.deepEqual(redirect('/oss-hub/', ['ko'], 'ko', 'en'), ['/oss-hub/en/']);
  assert.deepEqual(redirect('/oss-hub/?ref=guide#main', ['en'], 'en'), ['/oss-hub/en/?ref=guide#main']);
  assert.deepEqual(redirect('/oss-hub/', ['en'], 'en', null, true), ['/oss-hub/en/']);
});

test('explicit homes do not contain the automatic redirect bootstrap', () => {
  for (const lang of ['ko', 'en']) {
    const html = readFileSync(new URL(`${lang}/index.html`, dist), 'utf8');
    assert.ok(!html.includes('const rootDestination'));
    assert.ok(html.includes(`lang="${lang}"`));
  }
});

test('both document logos use explicit same-language homes', () => {
  for (const [path, language] of [['start', 'ko'], ['en/start', 'en']]) {
    const html = readFileSync(new URL(`${path}/index.html`, dist), 'utf8');
    assert.match(html, new RegExp(`<a href="/oss-hub/${language}/" class="site-title`));
  }
});

test('every generated guide language link resolves to a generated page', () => {
  const files = readdirSync(dist, { recursive: true }).filter((file) => file.endsWith('.html'));
  const paths = new Set(files);
  let count = 0;
  for (const file of files) {
    const html = readFileSync(new URL(file, dist), 'utf8');
    for (const match of html.matchAll(/<a\b[^>]*data-guide-language="(?:ko|en)"[^>]*>/g)) {
      const href = match[0].match(/href="([^"]+)"/)?.[1];
      const relative = href.replace(/^\/oss-hub\//, '').replace(/\/$/, '');
      const target = relative ? `${relative}/index.html` : 'index.html';
      assert.ok(paths.has(target), `${file}: missing ${target}`);
      count++;
    }
  }
  assert.ok(count >= 164);
});
