#!/usr/bin/env node
// check-auth-production-readonly.sh 의 판정·직렬화 경계.
// 셸은 관측을 모으고, 판정과 sanitize 는 여기서 한다.
import { readFile, writeFile } from 'node:fs/promises';

const MODES = new Set(['start', 'finish', 'postdeploy']);
const AGGREGATE_VERSION = '20260823-auth-production-readonly-v1';

async function main() {
  const [
    mode,
    tag,
    sha,
    outputPath,
    frontendImageId,
    backendImageId,
    aggregatePath,
    observedAt,
    minObservationSeconds,
    healthStatus,
    sessionStatus,
    protectedStatus,
    startPath,
  ] = process.argv.slice(2);

  if (process.argv.length !== 15 || !MODES.has(mode ?? '')) {
    throw new TypeError('Invalid auth production readonly report arguments');
  }
  for (const value of [
    tag,
    sha,
    outputPath,
    frontendImageId,
    backendImageId,
    aggregatePath,
    observedAt,
  ]) {
    if (!value) {
      throw new TypeError('Invalid auth production readonly report arguments');
    }
  }
  // finish 만 baseline 을 받는다. 나머지 모드에서 값이 오면 호출 계약이 깨진 것이다.
  if ((mode === 'finish') !== Boolean(startPath)) {
    throw new TypeError('Observation baseline is only valid for finish');
  }

  const routes = parseRoutes(healthStatus, sessionStatus, protectedStatus);
  const parsed = JSON.parse(await readFile(aggregatePath, 'utf8'));
  if (parsed?.version !== AGGREGATE_VERSION) {
    throw new TypeError('Unexpected auth production aggregate version');
  }
  const aggregate = parseAggregate(parsed.aggregate);
  const images = {
    frontend: { imageId: frontendImageId },
    backend: { imageId: backendImageId },
  };

  const observation =
    mode === 'finish'
      ? finishObservation(
          await readBaseline(startPath),
          { tag, sha, images, observedAt },
          Number(minObservationSeconds),
        )
      : { startedAt: observedAt, observedAt, elapsedSeconds: 0 };

  const report = {
    version: parsed.version,
    mode,
    release: { tag, sha },
    images,
    routes,
    aggregate,
    observation,
  };
  await writeFile(outputPath, `${JSON.stringify(report)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

async function readBaseline(startPath) {
  const baseline = JSON.parse(await readFile(startPath, 'utf8'));
  if (baseline?.mode !== 'start') {
    throw new TypeError('Observation baseline is not a start checkpoint');
  }
  return baseline;
}

/**
 * finish 는 "같은 이미지가 24시간 이상 계속 살아 있었다"만 증명한다.
 * tag/SHA 뿐 아니라 image ID 까지 비교해야 같은 태그로 다시 빌드된 이미지를
 * 연속 관측으로 오인하지 않는다.
 */
function finishObservation(baseline, current, minObservationSeconds) {
  if (
    !Number.isSafeInteger(minObservationSeconds) ||
    minObservationSeconds <= 0
  ) {
    throw new TypeError('Invalid observation window');
  }
  if (
    baseline.release?.tag !== current.tag ||
    baseline.release?.sha !== current.sha
  ) {
    throw new TypeError('Observation baseline release does not match');
  }
  if (
    baseline.images?.frontend?.imageId !== current.images.frontend.imageId ||
    baseline.images?.backend?.imageId !== current.images.backend.imageId
  ) {
    throw new TypeError('Observed images changed during the observation');
  }

  const startedAt = Date.parse(baseline.observation?.startedAt ?? '');
  const endedAt = Date.parse(current.observedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    throw new TypeError('Invalid observation timestamps');
  }
  const elapsedSeconds = Math.floor((endedAt - startedAt) / 1000);
  if (elapsedSeconds < minObservationSeconds) {
    throw new TypeError('Observation window is too short');
  }
  return {
    startedAt: baseline.observation.startedAt,
    observedAt: current.observedAt,
    elapsedSeconds,
  };
}

/**
 * 익명 관측이 route-manifest 3분류와 일치하는지 본다.
 * PROTECTED 가 401 이 아니면 기본 거부 경계가 무너진 것이므로 즉시 실패한다.
 */
function parseRoutes(healthStatus, sessionStatus, protectedStatus) {
  const routes = {
    public: Number(healthStatus),
    optionalSession: Number(sessionStatus),
    anonymousProtected: Number(protectedStatus),
  };
  if (
    routes.public !== 200 ||
    routes.optionalSession !== 200 ||
    routes.anonymousProtected !== 401
  ) {
    throw new TypeError('Route manifest parity check failed');
  }
  return routes;
}

/**
 * 집계만 통과시킨다 — 행 값이 담긴 필드는 애초에 report 로 옮기지 않는다.
 * 미해결 member kind 나 호환 전용 admin 권한이 남아 있으면 인증 경계가
 * 아직 canonical 상태가 아니므로 실패한다.
 */
function parseAggregate(aggregate) {
  const totalUsers = requireCount(aggregate?.totalUsers);
  const totalProfiles = requireCount(aggregate?.totalProfiles);
  const memberKinds = {
    STUDENT: requireCount(aggregate?.memberKinds?.STUDENT),
    STAFF: requireCount(aggregate?.memberKinds?.STAFF),
    NULL: requireCount(aggregate?.memberKinds?.NULL),
  };
  const staffAccessRequests = {
    PENDING: requireCount(aggregate?.staffAccessRequests?.PENDING),
    APPROVED: requireCount(aggregate?.staffAccessRequests?.APPROVED),
    REJECTED: requireCount(aggregate?.staffAccessRequests?.REJECTED),
    REVOKED: requireCount(aggregate?.staffAccessRequests?.REVOKED),
  };
  const blankNames = requireCount(aggregate?.blankNames);
  if (memberKinds.NULL !== 0 || blankNames !== 0) {
    throw new TypeError('Invalid canonical profile aggregate');
  }
  return {
    totalUsers,
    totalProfiles,
    memberKinds,
    usersWithStaffAccess: requireCount(aggregate?.usersWithStaffAccess),
    usersWithAdminAccess: requireCount(aggregate?.usersWithAdminAccess),
    staffAccessRequests,
    blankNames,
  };
}

function requireCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid aggregate count');
  }
  return value;
}

// 운영 게이트의 실패 사유는 한 줄로 낸다 — 스택 트레이스는 내부 경로를
// CI 로그에 흘리고 읽는 사람에게 아무 정보도 더 주지 않는다.
try {
  await main();
} catch (error) {
  process.stderr.write(
    `[auth-production-readonly] ${error instanceof Error ? error.message : 'failed'}\n`,
  );
  process.exitCode = 1;
}
