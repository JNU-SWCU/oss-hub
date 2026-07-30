// env 계약 검사 entry.
// compose/.env.example/runtime-config 세 선언 목록과 Docker 정규화 모델을 검사한다.
// 일반 apps/*/src의 process.env 접근 금지는 ESLint가 소유한다.
// 기존 세 번째 positional `scanRoot`는 호환성을 위해 유지하며,
// 이제 canonical runtime-config 파일을 찾는 contract root를 뜻한다.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSyntheticEnvFile,
  evaluateEnvContract,
  extractRequiredComposeKeys,
} from './check-env-example-coverage-lib.mjs';

const DEFAULT_COMPOSE = 'compose.yml';
const DEFAULT_ENV_EXAMPLE = '.env.example';
const COMMAND_TIMEOUT_MS = 60_000;
const RUNTIME_CONFIG_RELATIVE_PATH =
  'apps/backend/src/runtime-config/runtime-config.ts';

/**
 * @param {string[]} argv
 */
export function parseArguments(argv) {
  let requireDocker = false;
  const positional = [];

  for (const arg of argv) {
    if (arg === '--require-docker') {
      requireDocker = true;
    } else if (arg === '--help' || arg === '-h') {
      return {
        help: true,
        requireDocker: false,
        composeFile: '',
        envExample: '',
        scanRoot: '',
      };
    } else {
      positional.push(arg);
    }
  }

  return {
    help: false,
    requireDocker,
    composeFile: positional[0] || DEFAULT_COMPOSE,
    envExample: positional[1] || DEFAULT_ENV_EXAMPLE,
    scanRoot: positional[2] || '',
  };
}

/**
 * @param {string} composeFile
 * @param {string[]} requiredKeys
 * @param {{ requireDocker: boolean }} options
 * @returns {{ config: object|null, skipped: boolean, skipReason: string|null }}
 */
export function loadComposeConfig(composeFile, requiredKeys, options) {
  const dockerRequired =
    options.requireDocker ||
    process.env.CI === 'true' ||
    process.env.OSS_HUB_ENV_CONTRACT_REQUIRE_DOCKER === '1';

  if (!commandExists('docker')) {
    const reason = 'docker not found on PATH';

    if (dockerRequired) {
      throw new Error(
        `env example contract: ${reason}; service-mapping and compose-config checks require docker in CI (or pass --require-docker)`,
      );
    }

    return { config: null, skipped: true, skipReason: reason };
  }

  const composeDir = path.resolve(path.dirname(composeFile));
  const composeBase = path.basename(composeFile);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-contract-'));
  const envPath = path.join(tmpDir, 'synthetic.env');

  try {
    fs.writeFileSync(envPath, buildSyntheticEnvFile(requiredKeys), 'utf8');

    const stdout = execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        envPath,
        '-f',
        composeBase,
        'config',
        '--format',
        'json',
      ],
      {
        cwd: composeDir,
        encoding: 'utf8',
        timeout: COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    return {
      config: JSON.parse(stdout),
      skipped: false,
      skipReason: null,
    };
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String(/** @type {{ stderr?: Buffer|string }} */ (error).stderr ?? '')
        : '';
    const detail =
      stderr.trim() || (error instanceof Error ? error.message : String(error));

    throw new Error(
      `env example contract: docker compose config failed with synthetic env\n${detail}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * @param {ReturnType<typeof parseArguments>} args
 * @param {{
 *   repoRoot?: string,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream
 * }} [io]
 */
export function runCheck(args, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const repoRoot =
    io.repoRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  if (args.help) {
    stdout.write(
      'usage: node scripts/check-env-example-coverage.mjs [compose.yml] [.env.example] [contract_root] [--require-docker]\n',
    );
    return 0;
  }

  const composeFile = path.resolve(args.composeFile);
  const envExample = path.resolve(args.envExample);
  const contractRoot = path.resolve(args.scanRoot || repoRoot);
  const runtimeConfig = path.join(contractRoot, RUNTIME_CONFIG_RELATIVE_PATH);

  for (const filePath of [composeFile, envExample, runtimeConfig]) {
    if (!fs.existsSync(filePath)) {
      stderr.write(`env example contract: file not found: ${filePath}\n`);
      return 1;
    }
  }

  const composeText = fs.readFileSync(composeFile, 'utf8');
  const envExampleText = fs.readFileSync(envExample, 'utf8');
  const runtimeConfigText = fs.readFileSync(runtimeConfig, 'utf8');
  const requiredKeys = extractRequiredComposeKeys(composeText);

  let composeConfig = null;
  let composeConfigSkipped = false;

  try {
    const loaded = loadComposeConfig(composeFile, requiredKeys, {
      requireDocker: args.requireDocker,
    });
    composeConfig = loaded.config;
    composeConfigSkipped = loaded.skipped;

    if (loaded.skipped) {
      stderr.write(
        `env example contract: skipping checks [service-mapping, compose-config]: ${loaded.skipReason}\n`,
      );
      stderr.write(
        'env example contract: declaration and runtime-loader checks still run; install docker to enable full contract verification\n',
      );
    }
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const result = evaluateEnvContract({
    composeText,
    envExampleText,
    runtimeConfigText,
    composeConfig,
    options: { composeConfigSkipped },
  });

  if (!result.ok) {
    for (const message of result.errors) {
      stderr.write(`${message}\n`);
    }
    return 1;
  }

  stdout.write(
    'env example contract: ok (compose/runtime keys documented, manifest matches loader, backend keys service-mapped; ESLint owns source env reads)\n',
  );
  return 0;
}

function commandExists(name) {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  process.exitCode = runCheck(parseArguments(process.argv.slice(2)));
}

const entryPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === entryPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
