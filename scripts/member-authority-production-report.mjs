#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const MODES = new Set(['status', 'ready-for-cutover']);
const BACKFILL_VERSION = '20260822-member-authority-v2';
const EXPECTED_MIGRATION_COUNT = 51;

async function main() {
  const [
    mode,
    tag,
    sha,
    outputPath,
    frontendImageId,
    backendImageId,
    aggregatePath,
    ledgerPath,
  ] = process.argv.slice(2);
  if (
    !mode ||
    !MODES.has(mode) ||
    !tag ||
    !sha ||
    !outputPath ||
    !frontendImageId ||
    !backendImageId ||
    !aggregatePath ||
    !ledgerPath ||
    process.argv.length !== 10
  ) {
    throw new TypeError('Invalid member authority production report arguments');
  }
  const [parsed, ledger] = await Promise.all(
    [aggregatePath, ledgerPath].map(async (path) =>
      JSON.parse(await readFile(path, 'utf8')),
    ),
  );
  const aggregate = parseAggregate(parsed);
  const prismaLedger = parseLedger(ledger);
  const ready =
    aggregate.memberKinds.UNRESOLVED_ASSIGNED === 0 &&
    aggregate.compatibilityOnlyAdminAuthorities === 0;
  const report = {
    version: parsed.version,
    mode,
    release: { tag, sha },
    images: {
      frontend: { imageId: frontendImageId },
      backend: { imageId: backendImageId },
    },
    prismaLedger,
    aggregate,
    readyForCutover: ready,
  };
  await writeFile(outputPath, `${JSON.stringify(report)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  if (mode === 'ready-for-cutover' && !ready) process.exitCode = 1;
}

function parseLedger(value) {
  if (
    !record(value) ||
    value.status !== 'ok' ||
    value.migrationCount !== EXPECTED_MIGRATION_COUNT ||
    Object.keys(value).length !== 2
  ) {
    throw new TypeError('Invalid Prisma migration ledger receipt');
  }
  return { status: 'ok', migrationCount: EXPECTED_MIGRATION_COUNT };
}

function parseAggregate(value) {
  if (
    !record(value) ||
    value.version !== BACKFILL_VERSION ||
    !record(value.aggregate)
  ) {
    throw new TypeError('Invalid aggregate report');
  }
  const aggregate = value.aggregate;
  return {
    users: count(aggregate.users),
    profiles: count(aggregate.profiles),
    requests: count(aggregate.requests),
    legacyRoles: countRecord(aggregate.legacyRoles, [
      'STUDENT',
      'STAFF',
      'ADMIN',
      'UNASSIGNED',
    ]),
    memberKinds: countRecord(aggregate.memberKinds, [
      'STUDENT',
      'STAFF',
      'UNRESOLVED_ASSIGNED',
    ]),
    selectedMemberKinds: countRecord(aggregate.selectedMemberKinds, [
      'STUDENT',
      'STAFF',
      'UNRESOLVED',
    ]),
    unassignedMemberKinds: countRecord(aggregate.unassignedMemberKinds, [
      'STUDENT',
      'STAFF',
      'UNRESOLVED',
    ]),
    backfillTargets: {
      memberKinds: countRecord(aggregate.backfillTargets?.memberKinds, [
        'STUDENT',
        'STAFF',
      ]),
      selectedMemberKinds: countRecord(
        aggregate.backfillTargets?.selectedMemberKinds,
        ['STUDENT', 'STAFF'],
      ),
    },
    requestStatuses: countRecord(aggregate.requestStatuses, [
      'PENDING',
      'APPROVED',
      'REJECTED',
      'REVOKED',
    ]),
    requestHistoryHash: hash(aggregate.requestHistoryHash),
    staffAccess: count(aggregate.staffAccess),
    adminAccess: count(aggregate.adminAccess),
    compatibilityOnlyAdminAuthorities: count(
      aggregate.compatibilityOnlyAdminAuthorities,
    ),
  };
}

function countRecord(value, keys) {
  if (!record(value)) throw new TypeError('Invalid aggregate count record');
  return Object.fromEntries(keys.map((key) => [key, count(value[key])]));
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid aggregate count');
  }
  return value;
}

function hash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError('Invalid aggregate hash');
  }
  return value;
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  const kind = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(
    `member-authority-production-report: failed kind=${kind}\n`,
  );
  process.exitCode = 1;
});
