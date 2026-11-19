import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRouteManifest } from './route-manifest.mjs';
import { tempRepo } from './test-support.mjs';

test('new unreachable pages and shared screens block; existing ones do not', async (t) => {
  const repo = tempRepo(t);
  const app = 'apps/frontend/src/app/';
  const page = 'export default function Page() { return <main/> }';
  const base = repo.commit('reachable app', {
    'apps/frontend/tsconfig.json':
      '{"compilerOptions":{"moduleResolution":"bundler"}}',
    'apps/frontend/next.config.mjs': `export default { async redirects() { return [
      { source: '/old/:id', destination: '/items/:id?tab=detail', permanent: true }
    ] } }`,
    [app + 'layout.tsx']:
      `export default function Layout({children}) { return <>{children}<a href="/old/one">Item</a></> }`,
    [app + 'page.tsx']:
      `const icon = {'/detached':'star'}; function Badge({href}) {return <i/>}
      export default function Home(){return <main title={icon['/detached']}><Badge href="/detached"/></main>}`,
    [app + '(catalog)/items/[id]/page.tsx']:
      `import { View } from '../../../view'; export default function Item() { return <View/> }`,
    [app + 'view.tsx']: `export function View() { return <article/> }`,
    [app + '_private/page.tsx']: page,
    [app + '(other)/layout.tsx']:
      `export default function Layout({children}) { return <>{children}<a href="/island/one">Island</a></> }`,
  });
  const head = repo.commit('introduce an isolated cycle and a screen alias', {
    [app + '(other)/island/[id]/page.tsx']:
      `import {View as Alias} from '../../../view'; export default function Island() { return <Alias/> }`,
    [app + 'detached/page.tsx']:
      `export default function Detached() { return <a href="/island/one">Island</a> }`,
    [app + '(catalog)/items/[id]/layout.tsx']:
      `export default function Layout({children}) {return <>{children}<a href="/related">Related</a></>}`,
    [app + 'related/page.tsx']: page,
  });
  const compare = async (base, head) =>
    (await checkRouteManifest({ cwd: repo.dir, ranges: [{ base, head }] })).map(
      (f) => f.message,
    );
  assert.deepEqual(await compare(base, head), [
    'duplicate /island/[id] and /items/[id]',
    'unreachable /detached',
    'unreachable /island/[id]',
  ]);
  const unchanged = repo.commit('same issues', {
    'apps/frontend/readme.md': 'docs',
  });
  assert.deepEqual(await compare(head, unchanged), []);
  const fix = repo.commit('link island', {
    [app + 'page.tsx']:
      `export default function Page(){return <a href="/island/one"/>}`,
  });
  assert.deepEqual(await compare(head, fix), []);
  const recurrence = repo.commit('remove entry', { [app + 'page.tsx']: page });
  assert.deepEqual(await compare(fix, recurrence), [
    'unreachable /island/[id]',
  ]);
});

test('external entry needs an exact route reference, not merely a source module', async (t) => {
  const repo = tempRepo(t);
  const app = 'apps/frontend/src/app/';
  const page = 'export default function Page(){return <main/>}';
  const source = 'apps/backend/src/mail.ts';
  const base = repo.commit('home', { [app + 'page.tsx']: page });
  const add = repo.commit('stale attribution', {
    [app + 'welcome/page.tsx']: page,
    [app + 'welcome/route-entry.json']: JSON.stringify({
      entry: 'email-link',
      source,
    }),
    [source]: `// '/welcome'\nexport const wrong='/welcome-back';`,
  });
  const compare = async (head) =>
    (await checkRouteManifest({ cwd: repo.dir, ranges: [{ base, head }] })).map(
      (f) => f.message,
    );
  assert.deepEqual(await compare(add), [
    `invalid entry /welcome: declared source ${source} does not reference the page`,
    'unreachable /welcome',
  ]);
  const fixed = repo.commit('produce link with imported helper', {
    'apps/backend/src/paths.ts':
      'export function path(segment:string){return `/${segment}`}',
    [source]: `import {path} from './paths'; export const link=path('welcome');`,
  });
  assert.deepEqual(await compare(fixed), []);
});

test('navigation projects object and tuple bindings, nested aliases and defaults', async (t) => {
  const repo = tempRepo(t);
  const app = 'apps/frontend/src/app/';
  const page = 'export default function Page(){return <main/>}';
  const base = repo.commit('home', { [app + 'page.tsx']: page });
  const home = `const tuples:[string,string][]=[['Label','/tuple']];
    const rows:{href:string, child:[{url:string}],missing?:string}[]=[
    {href:'/object', child:[{url:'/nested'}]}];
    export default function Page(){return <>{tuples.map(([label, href])=><a href={href}>{label}</a>)}
    {rows.map(({href:renamed,child:[{url}],missing='/default'})=><><a href={renamed}/><a href={url}/><a href={missing}/></>)}</>}`;
  const routes = ['tuple', 'object', 'nested', 'default'];
  const head = repo.commit('menu', {
    [app + 'page.tsx']: home,
    ...Object.fromEntries(routes.map((p) => [app + p + '/page.tsx', page])),
  });
  const compare = async (head) =>
    (await checkRouteManifest({ cwd: repo.dir, ranges: [{ base, head }] })).map(
      (f) => f.message,
    );
  assert.deepEqual(await compare(head), []);
  assert.deepEqual(
    await compare(repo.commit('no menu', { [app + 'page.tsx']: page })),
    routes.sort().map((p) => 'unreachable /' + p),
  );
});

test('middleware redirect does not render the shadowed page or its links', async (t) => {
  const repo = tempRepo(t);
  const app = 'apps/frontend/src/app/';
  const base = repo.commit('home', {
    [app + 'page.tsx']:
      `export default function Page(){return <a href="/legacy"/>}`,
  });
  const head = repo.commit('shadowed link', {
    [app + 'legacy/page.tsx']:
      `export default function Legacy(){return <a href="/library"/>}`,
    [app + 'library/page.tsx']:
      `export default function Library(){return <main/>}`,
    [app + 'inbox/page.tsx']: `export default function Inbox(){return <main/>}`,
    'apps/frontend/src/middleware.js': `import {NextResponse} from 'next/server';export const config={matcher:'/legacy'};export function middleware(req){return NextResponse.redirect(new URL('/inbox',req.url))}`,
  });
  assert.deepEqual(
    (await checkRouteManifest({ cwd: repo.dir, ranges: [{ base, head }] })).map(
      (f) => f.message,
    ),
    ['unreachable /legacy', 'unreachable /library'],
  );
});

test('external contracts, equivalent menu bindings and middleware reach distinct pages', async (t) => {
  const repo = tempRepo(t);
  const app = 'apps/frontend/src/app/';
  const page = 'export default function Page(){return <main/>}';
  const base = repo.commit('home', { [app + 'page.tsx']: page });
  const sources = 'apps/backend/src/consent.ts';
  const contract = (source) => JSON.stringify({ entry: 'api-link', source });
  const home = `const links: {href:string}[] = [{href:'/library'}];
    const books = [{href:'/books'}] as const;
    export default function Home() {return <>{links.map(({href:to})=><a href={to}/>)}{books.map(item=><a href={item.href}/>)}<a href="/legacy"/></>}`;
  const head = repo.commit('four legitimate changes', {
    [app + 'page.tsx']: home,
    [app + 'library/page.tsx']:
      `import {Orders,Footer} from '../shared'; export default function Page(){return <Orders><Footer/></Orders>}`,
    [app + 'books/page.tsx']:
      `import {Messages,Footer} from '../shared'; export default function Page(){return <Messages><Footer/></Messages>}`,
    [app + 'shared.tsx']:
      `export function Orders({children}){return <><h1>Orders</h1>{children}</>} export function Messages({children}){return <><h1>Messages</h1>{children}</>} export function Footer(){return <footer/>} export function Loading(){return <i/>}`,
    'apps/frontend/src/middleware.js': `import {NextResponse} from 'next/server'; export const config={matcher:'/legacy'}; export function middleware(req){return NextResponse.redirect(new URL('/inbox',req.url))}`,
    [app + 'inbox/page.tsx']:
      `import {Loading} from '../shared'; export default function Page({ready}){if(!ready)return <Loading/>;return <h1>Inbox</h1>}`,
    [app + 'consent/page.tsx']:
      `import {Loading} from '../shared'; export default function Page({ready}){if(!ready)return <Loading/>;return <h1>Consent</h1>}`,
    [app + 'consent/route-entry.json']: contract(sources),
    [sources]: `export const documentUrl='/consent'`,
  });
  const compare = (base, head) =>
    checkRouteManifest({ cwd: repo.dir, ranges: [{ base, head }] });
  assert.deepEqual(await compare(base, head), []);
  const broken = repo.commit('remove the three entry mechanisms', {
    [app + 'page.tsx']: home.replace('<a href={to}/>', '<span/>'),
    'apps/frontend/src/middleware.js': null,
    [sources]: null,
  });
  const findings = await compare(head, broken);
  assert.deepEqual(
    findings.map((f) => f.message),
    [
      'invalid entry /consent: route-entry.json needs an entry kind and an existing apps/ source module',
      'unreachable /consent',
      'unreachable /inbox',
      'unreachable /library',
    ],
  );
  assert.match(
    findings.at(-1).threshold,
    /Link it from navigation, or declare its entry/,
  );
});
