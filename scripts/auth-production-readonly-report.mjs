#!/usr/bin/env node

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

try {
  await main();
} catch (error) {
  process.stderr.write(
    `[auth-production-readonly] ${error instanceof Error ? error.message : 'failed'}\n`,
  );
  process.exitCode = 1;
}
