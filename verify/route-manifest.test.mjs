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
      `export default function Layout({children}) { return <>{children}<a href="/island">Island</a></> }`,
  });
  const head = repo.commit('introduce an isolated cycle and a screen alias', {
    [app + '(other)/island/page.tsx']:
      `import {View as Alias} from '../../view'; export default function Island() { return <Alias/> }`,
    [app + 'detached/page.tsx']:
      `export default function Detached() { return <a href="/island">Island</a> }`,
    [app + '(catalog)/items/[id]/layout.tsx']:
      `export default function Layout({children}) {return <>{children}<a href="/related">Related</a></>}`,
    [app + 'related/page.tsx']: page,
  });
  const compare = async (base, head) =>
    (await checkRouteManifest({ cwd: repo.dir, ranges: [{ base, head }] })).map(
      (f) => f.message,
    );
  assert.deepEqual(await compare(base, head), [
    'duplicate /island and /items/[id]',
    'unreachable /detached',
    'unreachable /island',
  ]);
  const unchanged = repo.commit('same issues', {
    'apps/frontend/readme.md': 'docs',
  });
  assert.deepEqual(await compare(head, unchanged), []);
  const fix = repo.commit('link island', {
    [app + 'page.tsx']:
      `export default function Page(){return <a href="/island"/>}`,
  });
  assert.deepEqual(await compare(head, fix), []);
  const recurrence = repo.commit('remove entry', { [app + 'page.tsx']: page });
  assert.deepEqual(await compare(fix, recurrence), ['unreachable /island']);
});
