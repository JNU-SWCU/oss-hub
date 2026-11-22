import { readFileSync } from 'node:fs';
import { checkApi } from './api.mjs';
import { createCiApproval } from './approval.mjs';
import { checkFull } from './full.mjs';
import { checkQueryGates } from './query-gates.mjs';
import { detectSource, fullRanges, resolveScope } from './scope.mjs';
import { checkSecrets } from './secrets.mjs';
import {
  REPO_ROOT,
  formatFinding,
  interruptedExitCode,
  isEntry,
} from './tools.mjs';

const CHECKS = {
  secrets: (context) => checkSecrets(context),
  api: (context) => checkApi(context),
  'query-gates': (context) => checkQueryGates(context),
  'route-manifest': async (context) =>
    (await import('./route-manifest.mjs')).checkRouteManifest(context),
  cwv: () => checkFull({}),
};

const COMMANDS = {
  frontend: ['secrets', 'route-manifest'],
  backend: ['secrets', 'api', 'query-gates'],
  full: ['secrets', 'api', 'query-gates', 'route-manifest', 'cwv'],
};

const USAGE =
  'usage: node verify/index.mjs <frontend|backend|full|scoped|scope> [--pre-push]';

function scopedChecks(scope) {
  return [
    'secrets',
    ...(scope.api ? ['api'] : []),
    'query-gates',
    ...(scope.frontend ? ['route-manifest'] : []),
  ];
}

const SCOPE_GATED = { 'query-gates': 'queryGates' };

export async function main(
  argv,
  { cwd = REPO_ROOT, env = process.env, stdin, checks: overrides = {} } = {},
) {
  const checkImpls = { ...CHECKS, ...overrides };
  const [command] = argv;
  if (!COMMANDS[command] && command !== 'scoped' && command !== 'scope') {
    console.error(USAGE);
    return 2;
  }
  const source = detectSource(argv, env);
  let scope;
  try {
    scope =
      command === 'full'
        ? { ranges: await fullRanges(cwd) }
        : await resolveScope({
            cwd,
            source,
            env,
            stdin:
              source === 'pre-push' ? (stdin ?? readFileSync(0, 'utf8')) : '',
            remote:
              source === 'pre-push'
                ? argv[argv.indexOf('--pre-push') + 2]
                : undefined,
          });
  } catch (error) {
    console.error(`ERROR scope (${source}): ${error.message}`);
    return 2;
  }
  if (command === 'scope') {
    console.log(JSON.stringify(scope, null, 2));
    return 0;
  }
  if (command !== 'full' && scope.ranges.length === 0) {
    console.log(
      'verify: nothing new to verify (deletions or commits already on the remote)',
    );
    return 0;
  }
  const requested =
    command === 'scoped' ? scopedChecks(scope) : COMMANDS[command];
  const checks = requested.filter(
    (name) =>
      command === 'full' || !SCOPE_GATED[name] || scope[SCOPE_GATED[name]],
  );
  for (const name of requested.filter((item) => !checks.includes(item))) {
    console.log(
      `SKIP ${name}: backend integration is not selected for this range`,
    );
  }
  console.log(
    `verify ${command} (${source}): ${scope.ranges.map((range) => `${range.base.slice(0, 9)}..${range.head.slice(0, 9)}`).join(', ')}; checks: ${checks.join(', ')}`,
  );
  let failed = 0;
  let errored = 0;
  for (const name of checks) {
    if (interruptedExitCode()) break;
    try {
      const findings = await checkImpls[name]({
        cwd,
        source,
        ranges: scope.ranges,
        ...(source === 'ci'
          ? { approval: createCiApproval({ env, cwd }) }
          : {}),
      });
      for (const item of findings) console.error(formatFinding(item));
      console.log(
        `${findings.length === 0 ? 'PASS' : 'FAIL'} ${name}${findings.length ? ` (${findings.length})` : ''}`,
      );
      if (findings.length > 0) failed += 1;
    } catch (error) {
      console.error(`ERROR ${name}: ${error.message}`);
      errored += 1;
    }
  }
  const interrupted = interruptedExitCode();
  if (interrupted) {
    console.error('verify: interrupted; the remaining checks were not run');
    return interrupted;
  }
  if (errored > 0) return 2;
  return failed > 0 ? 1 : 0;
}

if (isEntry(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
