#!/usr/bin/env node
// check-auth-release-image.sh 의 판정·직렬화 경계.
import { readFile, writeFile } from 'node:fs/promises';

// 이 일곱 주체가 모두 관측돼야 매트릭스가 완전하다.
// 하나라도 빠지면 "돌긴 돌았는데 무엇을 증명했는지 모르는" 게이트가 된다.
const REQUIRED_PRINCIPALS = [
  'STUDENT',
  'STAFF',
  'STUDENT_ADMIN',
  'STAFF_ADMIN',
  'REVOKED_STAFF',
  'DEACTIVATED',
  'UNASSIGNED',
];

async function main() {
  const [tag, sha, frontendImageId, backendImageId, matrixPath, evidencePath] =
    process.argv.slice(2);
  if (
    process.argv.length !== 8 ||
    !tag ||
    !sha ||
    !frontendImageId ||
    !backendImageId ||
    !matrixPath ||
    !evidencePath
  ) {
    throw new TypeError('Invalid auth release image report arguments');
  }

  const parsed = JSON.parse(await readFile(matrixPath, 'utf8'));
  if (parsed?.release?.tag !== tag || parsed?.release?.sha !== sha) {
    throw new TypeError('Matrix release identity does not match the candidate');
  }

  const results = parseResults(parsed.principals);
  const report = {
    mode: 'release-image',
    release: { tag, sha },
    images: {
      frontend: { imageId: frontendImageId },
      backend: { imageId: backendImageId },
    },
    principals: results,
  };

  const serialized = `${JSON.stringify(report)}\n`;
  if (evidencePath === '-') {
    process.stdout.write(serialized);
    return;
  }
  await writeFile(evidencePath, serialized, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

/**
 * 각 주체는 허용된 엔드포인트만 통과하고 나머지는 거부돼야 한다.
 * 관측이 하나라도 빠지거나 denied 가 비어 있으면 통과시키지 않는다 —
 * "아무것도 확인하지 않은 매트릭스"가 초록으로 보이는 것을 막는다.
 */
function parseResults(principals) {
  if (typeof principals !== 'object' || principals === null) {
    throw new TypeError('Matrix principals are missing');
  }
  const results = {};
  for (const principal of REQUIRED_PRINCIPALS) {
    const observed = principals[principal];
    if (typeof observed !== 'object' || observed === null) {
      throw new TypeError(`Matrix principal is missing: ${principal}`);
    }
    const allowed = requireStatuses(observed.allowed);
    const denied = requireStatuses(observed.denied);
    if (denied.length === 0) {
      throw new TypeError(`Matrix principal has no denial: ${principal}`);
    }
    for (const status of allowed) {
      if (status < 200 || status >= 300) {
        throw new TypeError(`Allowed route was not permitted: ${principal}`);
      }
    }
    for (const status of denied) {
      if (status !== 401 && status !== 403 && status !== 404) {
        throw new TypeError(`Denied route was not rejected: ${principal}`);
      }
    }
    results[principal] = { allowed: allowed.length, denied: denied.length };
  }
  return results;
}

function requireStatuses(statuses) {
  if (!Array.isArray(statuses)) {
    throw new TypeError('Matrix statuses must be an array');
  }
  return statuses.map((status) => {
    if (!Number.isSafeInteger(status)) {
      throw new TypeError('Matrix status must be an integer');
    }
    return status;
  });
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `[auth-release-image] ${error instanceof Error ? error.message : 'failed'}\n`,
  );
  process.exitCode = 1;
}
