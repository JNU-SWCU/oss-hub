// env 계약 삼중 불변식 검사 entry.
// (1) 선언 — compose ${VAR:?} · 코드 소비 키 → .env.example
// (2) 주입 — 코드 소비 키 → 소유 서비스 environment (docker compose config 정규화 모델)
// (3) 소비 — apps/*/src 가 키를 읽음 (TypeScript AST)
//
// 사용법:
//   node scripts/check-env-example-coverage.mjs [compose.yml] [.env.example] [scan_root]
//
// CI 또는 --require-docker 에서는 docker 부재를 실패로 취급한다.
// 로컬에서 docker 가 없으면 (2)·compose config 검사를 건너뛰고
// 건너뛴 검사 이름과 이유를 stderr 에 명시한다(조용한 degrade 금지).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSyntheticEnvFile,
  collectCodeHits,
  evaluateEnvContract,
  extractRequiredComposeKeys,
  loadTypescript,
} from './check-env-example-coverage-lib.mjs';

const DEFAULT_COMPOSE = 'compose.yml';
const DEFAULT_ENV_EXAMPLE = '.env.example';
const COMMAND_TIMEOUT_MS = 60_000;

/**
 * @param {string[]} argv
 */
export function parseArguments(argv) {
  const args = [...argv];
  let requireDocker = false;
  const positional = [];
  for (const arg of args) {
    if (arg === '--require-docker') {
      requireDocker = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return {
        help: true,
        requireDocker: false,
        composeFile: '',
        envExample: '',
        scanRoot: '',
      };
    }
    positional.push(arg);
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
    return {
      config: null,
      skipped: true,
      skipReason: reason,
    };
  }

  const composeDir = path.resolve(path.dirname(composeFile));
  const composeBase = path.basename(composeFile);
  const syntheticEnv = buildSyntheticEnvFile(requiredKeys);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-contract-'));
  const envPath = path.join(tmpDir, 'synthetic.env');

  try {
    fs.writeFileSync(envPath, syntheticEnv, 'utf8');
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
 * @param {string} name
 */
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

/**
 * @param {ReturnType<typeof parseArguments>} args
 * @param {{ repoRoot?: string, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [io]
 * @returns {number} exit code
 */
export function runCheck(args, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const repoRoot =
    io.repoRoot ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  if (args.help) {
    stdout.write(
      'usage: node scripts/check-env-example-coverage.mjs [compose.yml] [.env.example] [scan_root] [--require-docker]\n',
    );
    return 0;
  }

  const composeFile = path.resolve(args.composeFile);
  const envExample = path.resolve(args.envExample);
  const scanRoot = path.resolve(args.scanRoot || repoRoot);

  if (!fs.existsSync(composeFile)) {
    stderr.write(`env example contract: file not found: ${composeFile}\n`);
    return 1;
  }
  if (!fs.existsSync(envExample)) {
    stderr.write(`env example contract: file not found: ${envExample}\n`);
    return 1;
  }

  const composeText = fs.readFileSync(composeFile, 'utf8');
  const envExampleText = fs.readFileSync(envExample, 'utf8');
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
        'env example contract: declaration checks still run; install docker to enable full contract verification\n',
      );
    }
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  let ts;
  try {
    ts = loadTypescript(repoRoot);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  let codeHits;
  try {
    codeHits = collectCodeHits(scanRoot, repoRoot, ts);
  } catch (error) {
    if (error && typeof error === 'object' && 'messages' in error) {
      for (const message of /** @type {string[]} */ (
        /** @type {{ messages: string[] }} */ (error).messages
      )) {
        stderr.write(`${message}\n`);
      }
    } else {
      stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return 1;
  }

  const result = evaluateEnvContract({
    composeText,
    envExampleText,
    composeConfig,
    codeHits,
    options: { composeConfigSkipped },
  });

  if (!result.ok) {
    for (const message of result.errors) {
      stderr.write(`${message}\n`);
    }
    return 1;
  }

  stdout.write(
    'env example contract: ok (compose keys documented, code keys declared and service-mapped, AUTH_INITIAL_ROLES mapped)\n',
  );
  return 0;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const code = runCheck(args);
  process.exitCode = code;
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
