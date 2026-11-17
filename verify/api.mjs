import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_BASELINE_PATH,
  API_GLOBAL_PREFIX,
  OASDIFF,
  OPENAPI_DUMP_COMMAND,
  VerifyError,
  finding,
  git,
  requireTool,
  run,
  showAtRevision,
} from './tools.mjs';

const OASDIFF_SOURCE =
  'https://github.com/oasdiff/oasdiff/blob/main/docs/BREAKING-CHANGES.md';
const TRAILER = 'API-Break-Approved';
const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
];
const CONTROLLER_GLOB = /^apps\/backend\/src\/.+\.controller\.ts$/;
const MIN_BREAKING_LEVEL = 2;

function parseSpec(text, label) {
  let spec;
  try {
    spec = JSON.parse(text);
  } catch (error) {
    throw new VerifyError(`${label} is not valid JSON: ${error.message}`);
  }
  if (
    typeof spec?.openapi !== 'string' ||
    spec.paths === null ||
    typeof spec.paths !== 'object' ||
    Object.keys(spec.paths).length === 0
  ) {
    throw new VerifyError(
      `${label} is not an OpenAPI document with at least one path`,
    );
  }
  return spec;
}

async function runDumpCommand(cwd, outFile) {
  const [command, ...args] = OPENAPI_DUMP_COMMAND.map((part) =>
    part === '{out}' ? outFile : part,
  );
  const result = await run(command, args, { cwd, timeoutMs: 600_000 });
  if (result.code !== 0) {
    throw new VerifyError(
      `OpenAPI dump failed (exit ${result.code}): ${OPENAPI_DUMP_COMMAND.join(' ')}\n${(result.stdout + result.stderr).trim()}`,
    );
  }
}

function joinRoute(...parts) {
  const path = parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith(':') ? `{${segment.slice(1)}}` : segment,
    )
    .join('/');
  return `/${path}`;
}

function decoratorPath(args) {
  const trimmed = args.trim();
  if (trimmed === '') return '';
  const literal = /^(['"`])([^'"`]*)\1$/.exec(trimmed);
  if (literal) return literal[2];
  const objectPath = /path\s*:\s*(['"`])([^'"`]*)\1/.exec(trimmed);
  if (objectPath) return objectPath[2];
  return null;
}

function memberDecorators(source, index) {
  const before = source.slice(0, index);
  const boundary = [...before.matchAll(/[{};]\s*\n/g)].reduce(
    (_, hit) => hit.index + hit[0].length,
    0,
  );
  const after = source.slice(index);
  const bodyStart = after.search(/\{\s*\n/);
  return source.slice(boundary, index + (bodyStart < 0 ? 0 : bodyStart));
}

function controllerOperations(file, source) {
  const operations = [];
  const unresolved = [];
  if (/@ApiExcludeController\(/.test(source)) return { operations, unresolved };
  const decorator =
    /@(Controller|Get|Post|Put|Patch|Delete|Head|Options|All)\(([^)]*)\)/g;
  let prefix = null;
  let match;
  while ((match = decorator.exec(source)) !== null) {
    const [whole, name, args] = match;
    const path = decoratorPath(args);
    const line = source.slice(0, match.index).split('\n').length;
    if (path === null) {
      unresolved.push(`${file}:${line} ${whole}`);
      continue;
    }
    if (name === 'Controller') {
      prefix = path;
      continue;
    }
    if (prefix === null) {
      unresolved.push(`${file}:${line} ${whole} outside a @Controller`);
      continue;
    }
    if (/@ApiExcludeEndpoint\(/.test(memberDecorators(source, match.index)))
      continue;
    operations.push({
      method: name === 'All' ? 'all' : name.toLowerCase(),
      path: joinRoute(API_GLOBAL_PREFIX, prefix, path),
      location: `${file}:${line}`,
    });
  }
  return { operations, unresolved };
}

function specOperations(spec) {
  const operations = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (item?.[method]) operations.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return operations;
}

export function reconcileRoutes(spec, controllers) {
  const inSpec = specOperations(spec);
  const declared = new Map();
  const unresolved = [];
  for (const { file, source } of controllers) {
    const result = controllerOperations(file, source);
    unresolved.push(...result.unresolved);
    for (const operation of result.operations) {
      const methods =
        operation.method === 'all' ? HTTP_METHODS : [operation.method];
      for (const method of methods) {
        declared.set(
          `${method.toUpperCase()} ${operation.path}`,
          operation.location,
        );
      }
    }
  }
  const findings = [];
  const missing = [...declared].filter(([key]) => !inSpec.has(key));
  const undeclared = [...inSpec].filter((key) => !declared.has(key));
  if (unresolved.length > 0) {
    findings.push(
      finding(
        'api-route-unresolved',
        `route decorators with non-literal paths cannot be reconciled:\n  ${unresolved.join('\n  ')}`,
        `${unresolved.length} decorator(s)`,
        '0',
        'verify/api.mjs (route/decorator reconciliation)',
      ),
    );
  }
  if (missing.length > 0 || undeclared.length > 0) {
    findings.push(
      finding(
        'api-route-reconciliation',
        [
          ...missing.map(
            ([key, location]) =>
              `declared in ${location} but missing from spec: ${key}`,
          ),
          ...undeclared.map((key) => `in spec but no decorator: ${key}`),
        ].join('\n  '),
        `${missing.length} missing, ${undeclared.length} undeclared`,
        '0 differences between @Controller routes and spec operations',
        'verify/api.mjs (route/decorator reconciliation)',
      ),
    );
  }
  return findings;
}

async function readControllers(cwd) {
  const listing = await git(cwd, ['ls-files', '-z', 'apps/backend/src']);
  return listing
    .split('\0')
    .filter((file) => CONTROLLER_GLOB.test(file))
    .map((file) => ({ file, source: readFileSync(join(cwd, file), 'utf8') }));
}

async function approvalTrailers(cwd, range) {
  const output = await git(cwd, [
    'log',
    `--format=%(trailers:key=${TRAILER},valueonly,separator=%x1f)%x1e`,
    `${range.base}..${range.head}`,
  ]);
  return output
    .split(/[\x1e\x1f\n]/)
    .map((value) => value.trim())
    .filter((value) => /^#\d+$/.test(value));
}

async function oasdiffBreaking(tool, baseFile, revisionFile, cwd) {
  const result = await run(
    tool.bin,
    [
      'breaking',
      baseFile,
      revisionFile,
      '--format',
      'json',
      '--allow-external-refs=false',
    ],
    { cwd, timeoutMs: 120_000 },
  );
  if (result.code !== 0) {
    throw new VerifyError(
      `oasdiff failed (exit ${result.code}): ${result.stderr.trim()}`,
    );
  }
  let changes;
  try {
    changes = JSON.parse(result.stdout);
  } catch {
    throw new VerifyError(
      `oasdiff output is not JSON: ${result.stdout.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(changes)) {
    throw new VerifyError('oasdiff output is not a JSON array');
  }
  return changes.filter((change) => Number(change.level) >= MIN_BREAKING_LEVEL);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export async function checkApi({
  cwd,
  ranges,
  dump = (outFile) => runDumpCommand(cwd, outFile),
  tool = OASDIFF,
}) {
  await requireTool(tool);
  const head = await git(cwd, ['rev-parse', 'HEAD']);
  for (const range of ranges) {
    if (range.head !== head) {
      throw new VerifyError(
        `the OpenAPI dump is built from the checked-out HEAD, but ${range.ref} is ${range.head.slice(0, 9)}; check out the branch you push`,
      );
    }
  }
  const dirty = await git(cwd, [
    'status',
    '--porcelain',
    '--',
    'apps/backend',
    'verify',
  ]);
  if (dirty) {
    throw new VerifyError(
      `uncommitted changes under apps/backend or verify would make the dump differ from the pushed commit:\n${dirty}`,
    );
  }

  const workDir = mkdtempSync(join(tmpdir(), 'verify-api-'));
  try {
    const freshFile = join(workDir, 'fresh.json');
    await dump(freshFile);
    let freshText;
    try {
      freshText = readFileSync(freshFile, 'utf8');
    } catch {
      throw new VerifyError(
        `OpenAPI dump wrote no file at ${freshFile} (command: ${OPENAPI_DUMP_COMMAND.join(' ')})`,
      );
    }
    const fresh = parseSpec(freshText, 'fresh OpenAPI dump');
    const findings = reconcileRoutes(fresh, await readControllers(cwd));

    const committedText = await showAtRevision(cwd, head, API_BASELINE_PATH);
    if (committedText === null) {
      throw new VerifyError(
        `${API_BASELINE_PATH} is not committed at HEAD; create it with: ${OPENAPI_DUMP_COMMAND.join(' ').replace('{out}', API_BASELINE_PATH)}`,
      );
    }
    const committed = parseSpec(committedText, `${API_BASELINE_PATH} at HEAD`);
    if (
      JSON.stringify(canonical(committed)) !== JSON.stringify(canonical(fresh))
    ) {
      findings.push(
        finding(
          'api-baseline-stale',
          `${API_BASELINE_PATH} does not match the fresh dump; regenerate it with: ${OPENAPI_DUMP_COMMAND.join(' ').replace('{out}', API_BASELINE_PATH)}`,
          'committed baseline != fresh dump',
          'committed baseline == fresh dump',
          'plan verification-loop "Baseline provenance"',
        ),
      );
    }

    for (const range of ranges) {
      const baseText = await showAtRevision(cwd, range.base, API_BASELINE_PATH);
      if (baseText === null) {
        throw new VerifyError(
          `${API_BASELINE_PATH} does not exist at trusted base ${range.base.slice(0, 9)}; refusing to compare against the working copy`,
        );
      }
      const baseFile = join(workDir, `base-${range.base}.json`);
      writeFileSync(
        baseFile,
        JSON.stringify(
          parseSpec(baseText, `${API_BASELINE_PATH} at ${range.base}`),
        ),
      );
      const breaking = await oasdiffBreaking(tool, baseFile, freshFile, cwd);
      if (breaking.length === 0) continue;
      const approvals = await approvalTrailers(cwd, range);
      const summary = breaking
        .map(
          (change) =>
            `${change.id}: ${change.operation ?? ''} ${change.path ?? ''} - ${change.text}`,
        )
        .join('\n  ');
      if (approvals.length > 0) {
        console.log(
          `NOTICE [api-breaking] approved by ${TRAILER}: ${approvals.join(', ')}\n  ${summary}`,
        );
        continue;
      }
      findings.push(
        finding(
          'api-breaking',
          `breaking API changes vs trusted base ${range.base.slice(0, 9)}:\n  ${summary}\n  intentional? add a commit trailer "${TRAILER}: #<issue>"`,
          `${breaking.length} breaking change(s) at level >= WARN`,
          '0 breaking changes without approval',
          OASDIFF_SOURCE,
        ),
      );
    }
    return findings;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
