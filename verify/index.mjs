import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkApi } from './api.mjs';
import { createCiApproval } from './approval.mjs';
import { checkFull } from './full.mjs';
import { detectSource, resolveScope } from './scope.mjs';
import { checkSecrets } from './secrets.mjs';
import { REPO_ROOT, formatFinding, isEntry } from './tools.mjs';
import { checkUrlIa } from './url-ia.mjs';

const CHECKS = {
  secrets: (context) => checkSecrets(context),
  'url-ia': (context) => checkUrlIa(context),
  api: (context) => checkApi(context),
  cwv: () => checkFull({}),
};

const REPORT_ONLY = new Set(['url-ia']);

function writeReport(reportDir, name, ranges, payload) {
  mkdirSync(reportDir, { recursive: true });
  const file = join(reportDir, `${name}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), ranges, ...payload }, null, 2)}\n`,
  );
  return file;
}

const COMMANDS = {
  frontend: ['secrets', 'url-ia'],
  backend: ['secrets', 'api'],
  full: ['secrets', 'url-ia', 'api', 'cwv'],
  'url-ia': ['url-ia'],
};

const USAGE =
  'usage: node verify/index.mjs <frontend|backend|full|scoped|scope|url-ia> [--pre-push]';

function scopedChecks(scope) {
  return [
    'secrets',
    ...(scope.frontend ? ['url-ia'] : []),
    ...(scope.backend ? ['api'] : []),
  ];
}

export async function main(
  argv,
  {
    cwd = REPO_ROOT,
    env = process.env,
    stdin,
    reportDir = join(REPO_ROOT, 'verify/reports'),
    checks: overrides = {},
  } = {},
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
    scope = await resolveScope({
      cwd,
      source,
      env,
      stdin: source === 'pre-push' ? (stdin ?? readFileSync(0, 'utf8')) : '',
      remote:
        source === 'pre-push'
          ? argv[argv.indexOf('--pre-push') + 1]
          : undefined,
    });
  } catch (error) {
    if (REPORT_ONLY.has(command)) {
      console.log(
        `NOTICE ${command}: scope could not be resolved (${error.message}); report only, the exit code is unaffected`,
      );
      return 0;
    }
    console.error(`ERROR scope (${source}): ${error.message}`);
    return 2;
  }
  if (command === 'scope') {
    console.log(JSON.stringify(scope, null, 2));
    return 0;
  }
  if (scope.ranges.length === 0) {
    console.log(
      'verify: nothing new to verify (deletions or commits already on the remote)',
    );
    return 0;
  }
  const checks = command === 'scoped' ? scopedChecks(scope) : COMMANDS[command];
  console.log(
    `verify ${command} (${source}): ${scope.ranges.map((range) => `${range.base.slice(0, 9)}..${range.head.slice(0, 9)}`).join(', ')}; checks: ${checks.join(', ')}`,
  );
  let failed = 0;
  let errored = 0;
  for (const name of checks) {
    if (REPORT_ONLY.has(name)) {
      try {
        const findings = await checkImpls[name]({ cwd, ranges: scope.ranges });
        for (const item of findings) console.log(formatFinding(item, 'REPORT'));
        const file = writeReport(reportDir, name, scope.ranges, { findings });
        console.log(
          `REPORT ${name}: ${findings.length} finding(s) -> ${file} (report only, does not affect the exit code)`,
        );
      } catch (error) {
        let file = '';
        try {
          file = writeReport(reportDir, name, scope.ranges, {
            error: error.message,
          });
        } catch (writeError) {
          file = `report not written: ${writeError.message}`;
        }
        console.log(
          `NOTICE ${name}: analysis failed (${error.message}); ${file}; report only, the exit code is unaffected`,
        );
      }
      continue;
    }
    try {
      const findings = await checkImpls[name]({
        cwd,
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
  if (errored > 0) return 2;
  return failed > 0 ? 1 : 0;
}

if (isEntry(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
