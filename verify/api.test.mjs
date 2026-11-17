import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { checkApi, reconcileRoutes } from './api.mjs';
import { resolveRanges } from './scope.mjs';
import { eventFile, tempRepo, writeExecutable } from './test-support.mjs';
import { OASDIFF, VerifyError, requireTool } from './tools.mjs';

const CONTROLLER = 'apps/backend/src/items/items.controller.ts';
const BASELINE = 'verify/openapi.baseline.json';

function controllerSource({ withDetail = true } = {}) {
  return [
    "@Controller('items')",
    'export class ItemsController {',
    '  @Get()',
    '  list() {}',
    ...(withDetail ? ["  @Post(':id')", '  update() {}'] : []),
    '}',
    '',
  ].join('\n');
}

function baseSpec() {
  return {
    openapi: '3.0.0',
    info: { title: 'fixture', version: '1' },
    paths: {
      '/api/v1/items': {
        get: {
          operationId: 'list',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Item' },
                },
              },
            },
          },
        },
      },
      '/api/v1/items/{id}': {
        post: {
          operationId: 'update',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateItem' },
              },
            },
          },
          responses: { 204: { description: 'done' } },
        },
      },
    },
    components: {
      schemas: {
        Item: {
          type: 'object',
          required: ['id', 'name'],
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
        UpdateItem: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string' }, note: { type: 'string' } },
        },
      },
    },
  };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const dumpOf = (spec) => (outFile) => writeFileSync(outFile, json(spec));

function stubOasdiff(t) {
  return {
    ...OASDIFF,
    bin: writeExecutable(
      t,
      'oasdiff',
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const [command, base, revision] = process.argv.slice(2);',
        "if (command === '--version') { console.log('oasdiff version 1.38.0'); process.exit(0); }",
        'const same = JSON.stringify(JSON.parse(fs.readFileSync(base, "utf8"))) === JSON.stringify(JSON.parse(fs.readFileSync(revision, "utf8")));',
        "console.log(JSON.stringify(same ? [] : [{ id: 'stub-change', level: 3, text: 'specs differ', operation: 'GET', path: '/api/v1/items' }]));",
        '',
      ].join('\n'),
    ),
  };
}

async function realOasdiff() {
  try {
    await requireTool(OASDIFF);
    return OASDIFF;
  } catch {
    return null;
  }
}

function apiRepo(t, { baseline = true } = {}) {
  const repo = tempRepo(t);
  const base = repo.commit('base', {
    [CONTROLLER]: controllerSource(),
    ...(baseline ? { [BASELINE]: json(baseSpec()) } : {}),
  });
  repo.markRemoteMain(base);
  return { repo, base };
}

const inputs = {
  'pre-push': (t, base, head) => ({
    source: 'pre-push',
    stdin: `refs/heads/main ${head} refs/heads/main ${base}\n`,
  }),
  pull_request: (t, base, head) => ({
    source: 'ci',
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventFile(t, {
        pull_request: { base: { sha: base } },
      }),
      GITHUB_SHA: head,
    },
  }),
  push: (t, base, head) => ({
    source: 'ci',
    env: {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: eventFile(t, { before: base, after: head }),
      GITHUB_SHA: head,
    },
  }),
};

function withoutResponseName() {
  const spec = baseSpec();
  delete spec.components.schemas.Item.properties.name;
  spec.components.schemas.Item.required = ['id'];
  return spec;
}

for (const [name, input] of Object.entries(inputs)) {
  test(`${name}: one commit removing an API field and rewriting the baseline still fails without a trailer`, async (t) => {
    const { repo, base } = apiRepo(t);
    const changed = withoutResponseName();
    const head = repo.commit('feat: drop item name', {
      [BASELINE]: json(changed),
    });
    const ranges = await resolveRanges({
      cwd: repo.dir,
      ...input(t, base, head),
    });
    const findings = await checkApi({
      cwd: repo.dir,
      ranges,
      dump: dumpOf(changed),
      tool: stubOasdiff(t),
    });
    assert.deepEqual(
      findings.map((item) => item.rule),
      ['api-breaking'],
    );
  });

  test(`${name}: the same change passes with an API-Break-Approved trailer`, async (t) => {
    const { repo, base } = apiRepo(t);
    const changed = withoutResponseName();
    const head = repo.commit(
      'feat: drop item name\n\nAPI-Break-Approved: #1234',
      {
        [BASELINE]: json(changed),
      },
    );
    const ranges = await resolveRanges({
      cwd: repo.dir,
      ...input(t, base, head),
    });
    const findings = await checkApi({
      cwd: repo.dir,
      ranges,
      dump: dumpOf(changed),
      tool: stubOasdiff(t),
    });
    assert.deepEqual(findings, []);
  });
}

test('a trailer without an issue number does not approve a break', async (t) => {
  const { repo, base } = apiRepo(t);
  const changed = withoutResponseName();
  const head = repo.commit('feat: x\n\nAPI-Break-Approved: yes', {
    [BASELINE]: json(changed),
  });
  const findings = await checkApi({
    cwd: repo.dir,
    ranges: [{ base, head, ref: 'main' }],
    dump: dumpOf(changed),
    tool: stubOasdiff(t),
  });
  assert.deepEqual(
    findings.map((item) => item.rule),
    ['api-breaking'],
  );
});

test('an API change without a baseline update is reported as stale', async (t) => {
  const { repo, base } = apiRepo(t);
  const head = repo.commit('chore: unrelated', { 'docs/x.md': 'x\n' });
  const findings = await checkApi({
    cwd: repo.dir,
    ranges: [{ base, head, ref: 'main' }],
    dump: dumpOf(withoutResponseName()),
    tool: stubOasdiff(t),
  });
  assert.deepEqual(findings.map((item) => item.rule).sort(), [
    'api-baseline-stale',
    'api-breaking',
  ]);
});

test('fails closed when the trusted base has no baseline', async (t) => {
  const { repo, base } = apiRepo(t, { baseline: false });
  const head = repo.commit('add baseline', { [BASELINE]: json(baseSpec()) });
  await assert.rejects(
    checkApi({
      cwd: repo.dir,
      ranges: [{ base, head, ref: 'main' }],
      dump: dumpOf(baseSpec()),
      tool: stubOasdiff(t),
    }),
    /does not exist at trusted base/,
  );
});

test('an empty, missing or unparseable dump fails instead of passing', async (t) => {
  const { repo, base } = apiRepo(t);
  const head = repo.commit('noop', { 'docs/x.md': 'x\n' });
  const cases = [
    [() => {}, /wrote no file/],
    [(out) => writeFileSync(out, ''), /not valid JSON/],
    [(out) => writeFileSync(out, '{"openapi":'), /not valid JSON/],
    [
      (out) => writeFileSync(out, '{"openapi":"3.0.0","paths":{}}'),
      /at least one path/,
    ],
  ];
  for (const [dump, message] of cases) {
    await assert.rejects(
      checkApi({
        cwd: repo.dir,
        ranges: [{ base, head, ref: 'main' }],
        dump,
        tool: stubOasdiff(t),
      }),
      (error) => error instanceof VerifyError && message.test(error.message),
    );
  }
});

test('a missing or wrong-version oasdiff binary fails with install guidance', async (t) => {
  const { repo, base } = apiRepo(t);
  const ranges = [{ base, head: base, ref: 'main' }];
  await assert.rejects(
    checkApi({
      cwd: repo.dir,
      ranges,
      dump: dumpOf(baseSpec()),
      tool: { ...OASDIFF, bin: '/nonexistent/oasdiff' },
    }),
    /oasdiff 1\.38\.0 is required.*Install it/,
  );
  const wrong = writeExecutable(
    t,
    'oasdiff',
    '#!/bin/sh\necho "oasdiff version 1.9.0"\n',
  );
  await assert.rejects(
    checkApi({
      cwd: repo.dir,
      ranges,
      dump: dumpOf(baseSpec()),
      tool: { ...OASDIFF, bin: wrong },
    }),
    /found: oasdiff version 1\.9\.0/,
  );
});

test('refuses to dump when backend files are uncommitted or HEAD is not the pushed SHA', async (t) => {
  const { repo, base } = apiRepo(t);
  const head = repo.commit('noop', { 'docs/x.md': 'x\n' });
  repo.write('apps/backend/src/extra.ts', 'export {};\n');
  await assert.rejects(
    checkApi({
      cwd: repo.dir,
      ranges: [{ base, head, ref: 'main' }],
      dump: dumpOf(baseSpec()),
      tool: stubOasdiff(t),
    }),
    /uncommitted changes/,
  );
  await assert.rejects(
    checkApi({
      cwd: repo.dir,
      ranges: [{ base, head: base, ref: 'old' }],
      dump: dumpOf(baseSpec()),
      tool: stubOasdiff(t),
    }),
    /checked-out HEAD/,
  );
});

test('route reconciliation reports decorators missing from the spec and undeclared operations', () => {
  const spec = baseSpec();
  delete spec.paths['/api/v1/items/{id}'];
  spec.paths['/api/v1/ghost'] = { get: { responses: {} } };
  const findings = reconcileRoutes(spec, [
    { file: CONTROLLER, source: controllerSource() },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'api-route-reconciliation');
  assert.match(
    findings[0].message,
    /missing from spec: POST \/api\/v1\/items\/\{id\}/,
  );
  assert.match(findings[0].message, /no decorator: GET \/api\/v1\/ghost/);
  const excluded = reconcileRoutes(baseSpec(), [
    {
      file: CONTROLLER,
      source: controllerSource().replace(
        '  @Get()',
        '  @ApiExcludeEndpoint()\n  @Get()\n  hidden() {}\n  @Get()',
      ),
    },
  ]);
  assert.deepEqual(excluded, []);
  const unresolved = reconcileRoutes(baseSpec(), [
    {
      file: CONTROLLER,
      source: controllerSource().replace("@Post(':id')", '@Post(ROUTE)'),
    },
  ]);
  assert.deepEqual(
    unresolved.map((item) => item.rule),
    ['api-route-unresolved', 'api-route-reconciliation'],
  );
});

const shapeControls = [
  {
    name: 'API path removed',
    controller: controllerSource({ withDetail: false }),
    mutate: (spec) => delete spec.paths['/api/v1/items/{id}'],
    id: 'api-path-removed-without-deprecation',
  },
  {
    name: 'query param removed',
    mutate: (spec) => (spec.paths['/api/v1/items'].get.parameters = []),
    id: 'request-parameter-removed',
  },
  {
    name: 'response field changed',
    mutate: (spec) =>
      (spec.components.schemas.Item.properties.name = { type: 'integer' }),
    id: 'response-property-type-changed',
  },
  {
    name: 'request field removed',
    mutate: (spec) => delete spec.components.schemas.UpdateItem.properties.note,
    id: 'request-property-removed',
  },
];

for (const control of shapeControls) {
  test(`negative control with real oasdiff: ${control.name}`, async (t) => {
    const tool = await realOasdiff();
    if (!tool) {
      t.skip(`oasdiff ${OASDIFF.version} not installed (${OASDIFF.install})`);
      return;
    }
    const { repo, base } = apiRepo(t);
    const changed = baseSpec();
    control.mutate(changed);
    const head = repo.commit(`feat: ${control.name}`, {
      [BASELINE]: json(changed),
      ...(control.controller ? { [CONTROLLER]: control.controller } : {}),
    });
    const findings = await checkApi({
      cwd: repo.dir,
      ranges: [{ base, head, ref: 'main' }],
      dump: dumpOf(changed),
      tool,
    });
    assert.deepEqual(
      findings.map((item) => item.rule),
      ['api-breaking'],
    );
    assert.match(findings[0].message, new RegExp(control.id));
  });
}
