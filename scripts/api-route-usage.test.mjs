import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  backendRoutes,
  frontendCalls,
  normalizePath,
  routeMatches,
} from './api-route-usage.mjs';

const board = { method: 'GET', path: 'programs/:programId/board/posts' };

test('literal API path matches the backend decorator route', () => {
  const routes = backendRoutes(`
    @Controller('programs/:programId/board')
    class BoardController { @Get('posts') list() {} }
  `);
  const calls = frontendCalls("apiClient('programs/example/board/posts')");
  assert.equal(routeMatches(routes[0], calls[0]), true);
});

test('template parameter matches independent backend parameter names, unlike naive comparison', () => {
  const [call] = frontendCalls('apiClient(`programs/${id}/board/posts`)');
  assert.notEqual(board.path, call.path);
  assert.equal(routeMatches(board, call), true);
});

test('query string is stripped before matching', () => {
  const [call] = frontendCalls(
    'apiClient(`programs/${id}/board/posts?page=${page}`)',
  );
  assert.equal(routeMatches(board, call), true);
  assert.equal(normalizePath('/api/v1/programs?search=test'), 'programs');
});

test('file clients, local path builders and method options are recognized', () => {
  const [call] = frontendCalls(`
    function path(id: string) { return \`programs/\${id}/board/posts\`; }
    apiFileClient(path(id), { method: 'POST' });
  `);
  assert.equal(routeMatches({ ...board, method: 'POST' }, call), true);
  assert.equal(routeMatches(board, call), false);
});

test('withQuery wrapper resolves literal, template and local builder paths', () => {
  const calls = frontendCalls(`
    import { apiClient, withQuery } from '@/lib/api-client';
    const postsBase = (id: string) => \`programs/\${id}/board/posts\`;
    apiClient(withQuery('users/access', new URLSearchParams(search)));
    apiClient(withQuery(\`users/\${id}/access/history\`, params), { signal });
    apiClient(withQuery(postsBase(id), search));
  `);
  assert.deepEqual(
    calls.map(({ method, path }) => [method, path]),
    [
      ['GET', 'users/access'],
      ['GET', 'users/:param/access/history'],
      ['GET', 'programs/:param/board/posts'],
    ],
  );
});

test('different static segments and path depths do not match', () => {
  const [call] = frontendCalls(
    "apiClient('programs/example/board/posts/extra')",
  );
  assert.equal(routeMatches(board, call), false);
  assert.equal(
    routeMatches(board, { ...call, path: 'programs/example/other/posts' }),
    false,
  );
});

test('conditional path prefixes and optional query suffixes retain both route alternatives', () => {
  const calls = frontendCalls(`
    const base = (preparation: boolean) => preparation ? 'application-preparations' : 'team-invitations/teams';
    apiClient(\`\${base(preparation)}/\${id}/sent\${query ? \`?\${query}\` : ''}\`);
  `);
  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      'application-preparations/:param/sent',
      'team-invitations/teams/:param/sent',
    ],
  );
});

test('forwarding wrappers retain the inner HTTP method and literal union path segments', () => {
  const calls = frontendCalls(`
    function patchPath(path: string, body: unknown) {
      return apiClient(path, { method: 'PATCH', body });
    }
    patchPath(\`programs/\${id}\`, body);
    function change(id: string, field: 'member-kind' | 'admin-access') {
      return apiClient(\`users/\${id}/\${field}\`, { method: 'PATCH' });
    }
  `);
  assert.deepEqual(
    calls.map(({ method, path }) => [method, path]),
    [
      ['PATCH', 'programs/:param'],
      ['PATCH', 'users/:param/member-kind'],
      ['PATCH', 'users/:param/admin-access'],
    ],
  );
});

test('server calls and imported aliases are recognized without treating unrelated literals as calls', () => {
  const calls = frontendCalls(`
    import { apiClient as request } from '@/lib/api-client';
    request('programs');
    serverApiClient('projects?year=2026', cache);
    landingJson(\`projects/\${id}\`);
    fetch('/api/v1/health');
    const unrelated = 'ranking';
  `);
  assert.deepEqual(
    calls.map(({ path }) => path),
    ['programs', 'projects', 'projects/:param', 'health'],
  );
});

test('unparsable input is skipped with a warning rather than crashing the CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'route-usage-'));
  try {
    const file = join(directory, 'broken.ts');
    writeFileSync(file, 'const broken = (');
    const result = spawnSync(
      process.execPath,
      [
        new URL('./api-route-usage.mjs', import.meta.url).pathname,
        '--json',
        '--frontend',
        file,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Skipping unparsable TypeScript/);
    assert.equal(JSON.parse(result.stdout).used.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
