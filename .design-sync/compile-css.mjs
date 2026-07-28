// design-sync: apps/frontend의 Tailwind v4(css-first) 스타일시트를 standalone CSS로 컴파일한다.
// styles.css는 @import 목록일 뿐 CSS를 컴파일하지 않으므로 cssEntry가 가리킬 산출물을 여기서 만든다.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const pkgDir = path.join(repo, 'apps/frontend');
const req = createRequire(path.join(pkgDir, 'package.json'));

async function load(name) {
  try {
    return req(name);
  } catch {
    const m = await import(pathToFileURL(req.resolve(name)).href);
    return m.default ?? m;
  }
}

const postcss = await load('postcss');
const tailwind = await load('@tailwindcss/postcss');

const from = path.join(repo, '.design-sync/css/ds-entry.css');
const outDir = path.join(pkgDir, '.ds-css');
const to = path.join(outDir, 'ds-compiled.css');

const css = await readFile(from, 'utf8');
const result = await postcss([tailwind({ optimize: true })]).process(css, {
  from,
  to,
});
await mkdir(outDir, { recursive: true });
await writeFile(to, result.css);
console.error(
  `compiled ${(result.css.length / 1024).toFixed(1)}KB -> ${path.relative(repo, to)}`,
);
