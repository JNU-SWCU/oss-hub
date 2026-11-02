import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BASE_URL,
  openAs,
  shot,
  visit,
  closeAll,
  leakCheck,
} from './capture-lib.mjs';

const [, , login, ...paths] = process.argv;
if (!login || !paths.length) {
  console.error('usage: node smoke.mjs <login|anon> <path>...');
  process.exit(2);
}
const dir =
  process.env.GUIDE_SMOKE_DIR ?? mkdtempSync(join(tmpdir(), 'guide-smoke-'));
console.log('out', dir);

const page = await openAs(login === 'anon' ? null : login);
for (const p of paths) {
  const name = (login + p).replace(/[^a-z0-9가-힣]+/gi, '_').slice(0, 90);
  try {
    await visit(page, p);
    const out = await shot(page, '.', name, {
      dir,
      fullPage: true,
      allowLeak: true,
    });
    const pr = await leakCheck(page);
    console.log(
      pr.length ? 'LEAK' : 'ok  ',
      p,
      page.url().replace(BASE_URL, ''),
      pr.join(' | '),
      out,
    );
  } catch (e) {
    console.log('ERR ', p, e.message.slice(0, 200));
  }
  page.__problems.length = 0;
}
await closeAll();
