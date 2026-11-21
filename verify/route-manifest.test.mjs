import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRouteManifest } from './route-manifest.mjs';
import { tempRepo } from './test-support.mjs';

test('only new missing references and identical primary screens block', async (t) => {
  const repo = tempRepo(t);
  const app = 'apps/frontend/src/app/';
  const page = 'export default function Page(){return <main/>}';
  const base = repo.commit('home', { [app + 'page.tsx']: page });
  const paths = [
    'consent',
    'object',
    'tuple',
    'default',
    'legacy',
    'inbox',
    'orders',
    'messages',
    'file',
    '(public)/library/[id]',
    'orphan',
  ];
  const head = repo.commit('visible and unreferenced routes', {
    ...Object.fromEntries(
      paths.map((path) => [app + path + '/page.tsx', page]),
    ),
    'apps/backend/src/consent.ts': `export const policy={documentUrl:'/consent'}`,
    [app + 'menu.tsx']:
      `const items=[{href:'/object',nested:[{href:undefined}]}];
      export function Menu(){return <>{items.map(({href,nested:[{href:to='/default'}]})=><><a href={to}/><a href={href}/></>)}
      {[['Label','/tuple']].map(([label,url])=><a href={url}>{label}</a>)}<iframe src={policy.documentUrl}/></>}`,
    'apps/frontend/src/middleware.ts': `import {NextResponse} from 'next/server';
      export const config={matcher:'/legacy'}; export function middleware(req){const target=new URL('/inbox',req.url);return NextResponse.redirect(target)}`,
    'apps/frontend/next.config.mjs': `export default {async redirects(){return [{source:'/old',destination:'/orders',permanent:true}]}}`,
    'apps/backend/src/mail.ts': `const detail=(section,id)=>\`/\${section}/\${id}\`; export const mail=detail('library',42);
      export const logFile=readFileSync('/file'); export const inbox='/messages'`,
    [app + 'shared.tsx']:
      `export function Footer(){return <footer/>} export function Loading(){return <i/>} export function Screen(){return <article/>}`,
    ...Object.fromEntries(
      ['orders', 'messages'].map((name) => [
        app + name + '/page.tsx',
        `import {Footer,Loading} from '../shared'; export default function Page({ready}){if(!ready)return <Loading/>;return <main><h1>${name}</h1><Footer/></main>}`,
      ]),
    ),
    [app + 'alias-one/page.tsx']:
      `import {Screen} from '../shared';export default function Page(){return <Screen/>}`,
    [app + 'alias-two/page.tsx']:
      `import {Screen as Content} from '../shared';export default function Page(){return <Content/>}`,
    [app + 'aliases.ts']: `export const aliases=['/alias-one','/alias-two']`,
    [app + 'orphan.test.ts']: `expect('/orphan').toBe('/orphan')`,
    [app + '_private/page.tsx']: page,
  });
  const delta = (base, head) =>
    checkRouteManifest({ cwd: repo.dir, ranges: [{ base, head }] });
  const findings = await delta(base, head);
  assert.deepEqual(
    findings.map((f) => f.message),
    ['duplicate /alias-one and /alias-two', 'unreferenced /orphan'],
  );
  assert.equal(
    findings[1].threshold,
    'No code references this route. Link it from navigation, or reference the path where it is sent (email, API, redirect).',
  );
  const unchanged = repo.commit('same references', {
    'apps/frontend/notes.md': '/orphan',
  });
  assert.deepEqual(await delta(head, unchanged), []);
  const fixed = repo.commit('mail links to orphan', {
    'apps/backend/src/invite.ts': `export const href='/orphan'`,
  });
  assert.deepEqual(await delta(head, fixed), []);
  const again = repo.commit('remove last production reference', {
    'apps/backend/src/invite.ts': null,
  });
  assert.deepEqual(
    (await delta(fixed, again)).map((f) => f.message),
    ['unreferenced /orphan'],
  );
});
